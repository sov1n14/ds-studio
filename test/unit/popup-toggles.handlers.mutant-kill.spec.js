/**
 * popup/popup.toggles.js - change handlers and global prompt render (Stryker mutant kills).
 *
 * Contract under test (popup feature toggles, docs and createToggleManager JSDoc):
 *   1. Changing any plain checkbox persists its new value (read back through StorageManager.getSettings()) and shows the save status once per change.
 *   2. The master switch persists isEnabled, disables or re-enables the sub-controls through applyMasterSwitchUI, and shows the save status.
 *   3. Selecting a websearch radio persists its value and shows the save status; the change event of the radio being deselected is ignored.
 *   4. Changing the global prompt toggle with no active preset persists the device-local flag and shows the save status.
 *   5. bindToggles tolerates a missing (optional) global prompt toggle; renderGlobalPromptToggle with no active preset always shows the device-local flag.
 *
 * The real popup/popup.html DOM, the real StorageManager over the in-memory chrome.storage of vitest.setup.js, and the real applyMasterSwitchUI (popup-master-switch-harness) are used; only showSaveStatus and refreshSyncStatus, the popup.js UI callbacks, are recorded.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';
import { evalPopupScript } from '../helpers/popup-script-loader.js';
import { mountPopupHtml, buildApplyMasterSwitchUI } from '../helpers/popup-master-switch-harness.js';

beforeAll(() => {
    evalPopupScript('popup/popup.toggles.js');
    if (typeof window.__DS_PopupToggles?.createToggleManager !== 'function') {
        throw new Error('createToggleManager was not exposed on window.__DS_PopupToggles');
    }
});

afterEach(() => {
    vi.useRealTimers();
});

/** Real popup DOM keyed by id, plus the websearch radio group (the shape popup.js hands to bindToggles). */
function buildPopupDom() {
    mountPopupHtml();
    const dom = {};
    document.querySelectorAll('[id]').forEach((el) => { dom[el.id] = el; });
    dom.websearchRadios = [...document.querySelectorAll('input[name="websearchToggle"]')];
    return dom;
}

/** ctx mirroring popup.js's wiring block; state accessors default to "no active preset". */
function buildManager(overrides = {}) {
    const ctx = {
        StorageManager,
        refreshSyncStatus: vi.fn(async () => {}),
        showSaveStatus: vi.fn(),
        applyMasterSwitchUI: vi.fn(),
        getPresets: () => [],
        setPresets: () => {},
        getActivePresetId: () => '',
        setActivePresetId: () => {},
        ...overrides,
    };
    return { manager: window.__DS_PopupToggles.createToggleManager(ctx), ctx };
}

/** StorageManager writes settle on chained setTimeout(0) turns; drain them in virtual time. */
async function fireChangeAndSettle(el) {
    vi.useFakeTimers();
    el.dispatchEvent(new Event('change'));
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
}

const readSetting = async (field) => (await StorageManager.getSettings())[field];

// [getSettings field, checkbox id]
const PLAIN_TOGGLES = [
    ['includeThinking', 'includeThinkingToggle'],
    ['includeReferences', 'includeReferencesToggle'],
    ['sidebarAutoHide', 'sidebarAutoHideToggle'],
    ['hideThinking', 'hideThinkingToggle'],
    ['isShowSystemTime', 'showSystemTimeToggle'],
    ['preventAutoScroll', 'preventAutoScrollToggle'],
    ['autoExpandMessages', 'autoExpandMessagesToggle'],
    ['autoRetry', 'autoRetryToggle'],
    ['autoContinue', 'autoContinueToggle'],
    ['autoOpenSidebar', 'autoOpenSidebarToggle'],
];

describe('plain checkbox change handlers', () => {
    it.each(PLAIN_TOGGLES)('%s: flipping #%s persists each new value and shows the save status once per change', async (field, id) => {
        const dom = buildPopupDom();
        expect(dom[id], `#${id} missing from popup.html`).toBeDefined();
        const { manager, ctx } = buildManager();
        manager.bindToggles(dom);
        const initial = Boolean(await readSetting(field));

        dom[id].checked = !initial;
        await fireChangeAndSettle(dom[id]);
        expect(await readSetting(field), `${field} after setting #${id} to ${!initial}`).toBe(!initial);
        expect(ctx.showSaveStatus, `save status after the first change of #${id}`).toHaveBeenCalledTimes(1);

        dom[id].checked = initial;
        await fireChangeAndSettle(dom[id]);
        expect(await readSetting(field), `${field} after setting #${id} back to ${initial}`).toBe(initial);
        expect(ctx.showSaveStatus, `save status after the second change of #${id}`).toHaveBeenCalledTimes(2);
    });
});

describe('master switch change handler', () => {
    it('unchecking #enableToggle persists isEnabled=false, disables the sub-controls and shows the save status; re-checking reverses it', async () => {
        const dom = buildPopupDom();
        const { applyMasterSwitchUI } = buildApplyMasterSwitchUI();
        const { manager, ctx } = buildManager({ applyMasterSwitchUI });
        manager.bindToggles(dom);
        const subControls = [dom.hideThinkingToggle, dom.sidebarAutoHideToggle, dom.preventAutoScrollToggle];
        expect(subControls.map((el) => el.disabled), 'sub-controls start enabled').toEqual([false, false, false]);

        dom.enableToggle.checked = false;
        await fireChangeAndSettle(dom.enableToggle);
        expect(await readSetting('isEnabled')).toBe(false);
        expect(subControls.map((el) => el.disabled), 'sub-controls after master off').toEqual([true, true, true]);
        expect(ctx.showSaveStatus).toHaveBeenCalledTimes(1);

        dom.enableToggle.checked = true;
        await fireChangeAndSettle(dom.enableToggle);
        expect(await readSetting('isEnabled')).toBe(true);
        expect(subControls.map((el) => el.disabled), 'sub-controls after master on').toEqual([false, false, false]);
        expect(ctx.showSaveStatus).toHaveBeenCalledTimes(2);
    });
});

describe('websearch radio change handlers', () => {
    it('selecting a radio persists its value and shows the save status; a change event on the deselected radio writes nothing', async () => {
        const dom = buildPopupDom();
        const [onRadio, offRadio] = ['on', 'off'].map((value) => dom.websearchRadios.find((r) => r.value === value));
        expect(onRadio && offRadio, 'websearch radios on/off missing from popup.html').toBeTruthy();
        const { manager, ctx } = buildManager();
        manager.bindToggles(dom);

        offRadio.checked = true;
        await fireChangeAndSettle(offRadio);
        expect(onRadio.checked, 'radio group semantics: selecting off deselects on').toBe(false);
        expect(await readSetting('websearchToggle')).toBe('off');
        expect(ctx.showSaveStatus).toHaveBeenCalledTimes(1);

        await fireChangeAndSettle(onRadio);
        expect(await readSetting('websearchToggle'), 'a change on the unchecked radio must not persist its value').toBe('off');
        expect(ctx.showSaveStatus, 'a change on the unchecked radio must not show the save status').toHaveBeenCalledTimes(1);

        onRadio.checked = true;
        await fireChangeAndSettle(onRadio);
        expect(await readSetting('websearchToggle')).toBe('on');
        expect(ctx.showSaveStatus).toHaveBeenCalledTimes(2);
    });
});

describe('global prompt toggle', () => {
    it('with no active preset, a change persists the device-local flag and shows the save status', async () => {
        const dom = buildPopupDom();
        const { manager, ctx } = buildManager();
        manager.bindToggles(dom);
        const initial = Boolean(await readSetting('globalPromptEnabled'));

        dom.globalPromptToggle.checked = !initial;
        await fireChangeAndSettle(dom.globalPromptToggle);
        expect(await readSetting('globalPromptEnabled')).toBe(!initial);
        expect(ctx.showSaveStatus).toHaveBeenCalledTimes(1);
    });

    it('bindToggles without a global prompt toggle still binds the other toggles', async () => {
        const dom = buildPopupDom();
        delete dom.globalPromptToggle;
        const { manager } = buildManager();
        expect(() => manager.bindToggles(dom)).not.toThrow();

        const initial = Boolean(await readSetting('hideThinking'));
        dom.hideThinkingToggle.checked = !initial;
        await fireChangeAndSettle(dom.hideThinkingToggle);
        expect(await readSetting('hideThinking')).toBe(!initial);
    });

    /** Renders onto a checked checkbox while the device-local flag is off; returns the resulting checked state. */
    async function renderWithLegacyFlagOff(overrides) {
        await StorageManager.saveGlobalPromptEnabled(false);
        expect(await readSetting('globalPromptEnabled'), 'precondition: device-local flag off').toBe(false);
        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.checked = true;
        const { manager } = buildManager(overrides);
        await manager.renderGlobalPromptToggle(toggle);
        return toggle.checked;
    }

    it.each([
        ['undefined active id, preset list holds an entry without an id', { getActivePresetId: () => undefined, getPresets: () => [{ name: 'no id', content: 'x', globalPromptEnabled: true }] }],
        ['empty active id, preset list holds an entry whose id is empty', { getActivePresetId: () => '', getPresets: () => [{ id: '', name: 'blank id', content: 'x', globalPromptEnabled: true }] }],
    ])('no active preset (%s): render shows the device-local flag, never a preset value', async (_label, overrides) => {
        expect(await renderWithLegacyFlagOff(overrides)).toBe(false);
    });
});
