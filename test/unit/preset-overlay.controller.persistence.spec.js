/**
 * Unit tests for createPresetOverlay#onSelectChange persistence behaviour
 * (content/preset-overlay.controller.js) - backlog finding P8.
 *
 * Requirements encoded here (behaviour, not implementation):
 *  R1  Selecting a preset for a bound chat persists the binding through
 *      StorageManager's transactional chat-preset-map path, and publishes the
 *      new in-memory map through ctx.setChatPresetMap - the map object handed
 *      out by ctx.getChatPresetMap() is NOT mutated in place.
 *  R2  When the chat-preset-map persistence call rejects, the rejection is
 *      caught and surfaced on the '[DSS]' console.error boundary, and never
 *      escapes as an unhandled rejection.
 *  R3  Same for a rejecting saveActivePresetId.
 *  R4  When the bind dispatch rejects, the overlay's displayed selection rolls back to the value the STORED map holds for the chat (re-read from StorageManager), not to the option the user just clicked, and that stored map is published through ctx.setChatPresetMap.
 *
 * The StorageManager global is the real one (loaded by setup/vitest.setup.js);
 * its persistence methods are replaced with a behavioural fake that writes into
 * a plain backing object, so the assertions read STORED STATE rather than call
 * sequences. The client write entry points (bindChatToPreset / unbindChat) write
 * to the same backing store; a failing dispatch rejects with the real
 * StorageManager.errors.ChatMapDispatchError.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';

const { createPresetOverlay } = require('../../content/preset-overlay.controller.js');

const CHAT_UUID    = 'uuid-1234';
const OTHER_UUID   = 'uuid-other';
const OTHER_PRESET = 'preset-other';

function makeCtx(overrides = {}) {
    return {
        getIsEnabled:               vi.fn(() => true),
        getCurrentChatUuid:         vi.fn(() => CHAT_UUID),
        setCurrentChatUuid:         vi.fn(),
        getChatPresetMap:           vi.fn(() => ({})),
        setChatPresetMap:           vi.fn(),
        getPendingPresetId:         vi.fn(() => undefined),
        setPendingPresetId:         vi.fn(),
        updatePromptPrefixFromBinding: vi.fn(),
        isExtensionContextValid:    vi.fn(() => true),
        ...overrides,
    };
}

let smSpies = [];

function fakeStorageManager(store) {
    const reject   = (what) => Promise.reject(new StorageManager.errors.ChatMapDispatchError('[DSS] chat-map dispatch failed: ' + what));
    const writeMap = (next) => { store.map = { ...next }; return true; };

    smSpies = [
        vi.spyOn(StorageManager, 'bindChatToPreset').mockImplementation(async (uuid, presetId) => {
            if (store.failMap) return reject('bindChatToPreset');
            return writeMap({ ...store.map, [uuid]: presetId });
        }),
        vi.spyOn(StorageManager, 'unbindChat').mockImplementation(async (uuid) => {
            if (store.failMap) return reject('unbindChat');
            const next = { ...store.map };
            delete next[uuid];
            return writeMap(next);
        }),
        vi.spyOn(StorageManager, 'getChatPresetMap').mockImplementation(async () => ({ ...store.map })),
        vi.spyOn(StorageManager, 'saveActivePresetId').mockImplementation(async (id) => {
            if (store.failActive) return reject('saveActivePresetId');
            store.activePresetId = id;
            return true;
        }),
        vi.spyOn(StorageManager, 'getSettings').mockResolvedValue({ promptPresets: [], pinnedPresetId: '' }),
    ];
}

function restoreStorageManager() {
    smSpies.forEach(s => s.mockRestore());
    smSpies = [];
}

const flush = () => new Promise(resolve => setTimeout(resolve, 10));

describe('onSelectChange - chat-preset-map persistence (P8)', () => {
    let overlay, ctx, store, sharedMap;

    beforeEach(() => {
        store     = { map: { [OTHER_UUID]: OTHER_PRESET }, failMap: false, failActive: false };
        sharedMap = { [OTHER_UUID]: OTHER_PRESET };
        fakeStorageManager(store);
        ctx = makeCtx({ getChatPresetMap: vi.fn(() => sharedMap) });
        overlay = createPresetOverlay(ctx);
        overlay.reposition = vi.fn();
    });

    afterEach(() => {
        overlay.unmount();
        restoreStorageManager();
    });

    it('binding a preset writes the new binding to the stored map', async () => {
        overlay.onSelectChange('preset-A');
        await flush();

        expect(store.map).toEqual({ [OTHER_UUID]: OTHER_PRESET, [CHAT_UUID]: 'preset-A' });
    });

    it('binding a preset does NOT mutate the map object owned by ctx in place', async () => {
        overlay.onSelectChange('preset-A');
        await flush();

        expect(sharedMap, 'the map handed out by ctx.getChatPresetMap() must be left untouched; the update belongs to the transactional path')
            .toEqual({ [OTHER_UUID]: OTHER_PRESET });
    });

    it('binding a preset publishes the updated map through ctx.setChatPresetMap', async () => {
        overlay.onSelectChange('preset-A');
        await flush();

        const published = ctx.setChatPresetMap.mock.calls.at(-1)?.[0];
        expect(published, 'the updated map must be published through the ctx setter').toEqual({ [OTHER_UUID]: OTHER_PRESET, [CHAT_UUID]: 'preset-A' });
        expect(published, 'the published map must be a NEW object, not the same instance mutated in place').not.toBe(sharedMap);
    });

    it('selecting the empty option removes the binding from the stored map', async () => {
        store.map[CHAT_UUID] = 'preset-A';
        sharedMap[CHAT_UUID] = 'preset-A';

        overlay.onSelectChange('');
        await flush();

        expect(store.map).toEqual({ [OTHER_UUID]: OTHER_PRESET });
    });

    it('selecting the empty option does NOT mutate the map object owned by ctx in place', async () => {
        store.map[CHAT_UUID] = 'preset-A';
        sharedMap[CHAT_UUID] = 'preset-A';

        overlay.onSelectChange('');
        await flush();

        expect(sharedMap, 'the unbind must not delete the key from the shared in-memory object directly')
            .toEqual({ [OTHER_UUID]: OTHER_PRESET, [CHAT_UUID]: 'preset-A' });
        expect(ctx.setChatPresetMap).toHaveBeenCalledWith(
            expect.not.objectContaining({ [CHAT_UUID]: 'preset-A' })
        );
    });
});

describe('onSelectChange - persistence failure containment (P8)', () => {
    let overlay, ctx, store, errorSpy, unhandled, onUnhandled;

    beforeEach(() => {
        store = { map: { [OTHER_UUID]: OTHER_PRESET }, failMap: false, failActive: false };
        fakeStorageManager(store);
        ctx = makeCtx();
        overlay = createPresetOverlay(ctx);
        overlay.reposition = vi.fn();

        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        unhandled = [];
        onUnhandled = (reason) => unhandled.push(reason);
        process.on('unhandledRejection', onUnhandled);
    });

    afterEach(() => {
        process.off('unhandledRejection', onUnhandled);
        errorSpy.mockRestore();
        overlay.unmount();
        restoreStorageManager();
    });

    const dssErrors = () => errorSpy.mock.calls.filter(args => String(args[0]).includes('[DSS]'));

    it('reports a rejected chat-preset-map write on the [DSS] console.error boundary', async () => {
        store.failMap = true;

        overlay.onSelectChange('preset-A');
        await flush();

        expect(dssErrors().length, 'a rejected map persistence call must be caught and logged with the [DSS] prefix')
            .toBeGreaterThan(0);
    });

    it('a rejected chat-preset-map write never escapes as an unhandled rejection', async () => {
        store.failMap = true;

        overlay.onSelectChange('preset-A');
        await flush();

        expect(unhandled, 'the persistence promise must carry a .catch').toEqual([]);
    });

    it('reports a rejected saveActivePresetId on the [DSS] console.error boundary', async () => {
        store.failActive = true;

        overlay.onSelectChange('preset-A');
        await flush();

        expect(StorageManager.saveActivePresetId, 'guard against a vacuous pass: this branch must actually call saveActivePresetId')
            .toHaveBeenCalled();
        expect(dssErrors().length).toBeGreaterThan(0);
    });

    it('a rejected saveActivePresetId never escapes as an unhandled rejection', async () => {
        store.failActive = true;

        overlay.onSelectChange('preset-A');
        await flush();

        expect(StorageManager.saveActivePresetId).toHaveBeenCalled();
        expect(unhandled, 'the saveActivePresetId promise must carry a .catch').toEqual([]);
    });
});

describe('onSelectChange - rejected bind rolls the displayed selection back (R4)', () => {
    const PRESETS = [
        { id: 'preset-A', name: 'Alpha', content: 'a' },
        { id: 'preset-B', name: 'Bravo', content: 'b' },
        { id: 'preset-C', name: 'Charlie', content: 'c' },
    ];
    let overlay, ctx, store, target, errorSpy;

    const label = () => overlay.dropdown.label.textContent;
    const selectedValue = () => overlay.dropdown.menu.querySelector('[aria-selected="true"]')?.getAttribute('data-value') ?? null;
    const clickOption = (id) => overlay.dropdown.menu.querySelector(`.dss-preset-option[data-value="${id}"]`).click();

    beforeEach(() => {
        // Another context already rebound the chat to preset-A; this overlay still shows preset-C.
        store = { map: { [OTHER_UUID]: OTHER_PRESET, [CHAT_UUID]: 'preset-A' }, failMap: false, failActive: false };
        fakeStorageManager(store);
        ctx = makeCtx({ getChatPresetMap: vi.fn(() => ({ [OTHER_UUID]: OTHER_PRESET, [CHAT_UUID]: 'preset-C' })) });
        overlay = createPresetOverlay(ctx);
        overlay.reposition = vi.fn();
        target = document.createElement('div');
        document.body.appendChild(target);
        overlay.mountTo(target);
        overlay.render(PRESETS, 'preset-C');
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        errorSpy.mockRestore();
        overlay.unmount();
        target.remove();
        restoreStorageManager();
    });

    it('a rejected bind shows the stored map\'s preset for the chat again, not the clicked one', async () => {
        expect(label(), 'sanity: the overlay starts on its own (stale) selection').toBe('Charlie');
        store.failMap = true;

        clickOption('preset-B');
        expect(label(), 'sanity: the click is applied optimistically before the dispatch settles').toBe('Bravo');
        await flush();

        expect(store.map[CHAT_UUID], 'the rejected bind must not have changed the stored map').toBe('preset-A');
        expect(label(), 'displayed label must roll back to the stored binding').toBe('Alpha');
        expect(selectedValue(), 'aria-selected option must roll back to the stored binding').toBe('preset-A');
        expect(ctx.setChatPresetMap.mock.calls.at(-1)?.[0], 'the re-read stored map must be published to ctx').toEqual(store.map);
    });

    it('a successful bind keeps the clicked preset displayed (control for the rollback case)', async () => {
        clickOption('preset-B');
        await flush();

        expect(store.map[CHAT_UUID]).toBe('preset-B');
        expect(label()).toBe('Bravo');
        expect(selectedValue()).toBe('preset-B');
    });
});
