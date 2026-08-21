import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { evalPopupScript } from '../helpers/popup-script-loader.js';

let createPinManager;

beforeAll(() => {
    evalPopupScript('popup/popup.pin-manager.js');
    createPinManager = globalThis.window.__DS_PopupPinManager.createPinManager;
});

// Unit tests for the pin-toggle logic (default-group feature). This module
// does not exist yet -- this is the red phase. ctx is a plain fake, not a
// mock of an implementation, since none exists to read.
describe('createPinManager', () => {
    let state;
    let ctx;

    beforeEach(() => {
        state = { pinnedId: '' };
        ctx = {
            StorageManager: {
                savePinnedPresetId: vi.fn(async (id) => { state.persisted = id; }),
            },
            getPinnedPresetId: vi.fn(() => state.pinnedId),
            setPinnedPresetId: vi.fn((id) => { state.pinnedId = id; }),
            onPinChanged: vi.fn(),
        };
    });

    describe('togglePin()', () => {
        it('pins an id when nothing is currently pinned', async () => {
            const { togglePin } = createPinManager(ctx);
            await togglePin('a');

            expect(ctx.getPinnedPresetId()).toBe('a');
            expect(state.persisted).toBe('a');
        });

        it('unpins (toggle-off) when the same id is already pinned', async () => {
            const { togglePin } = createPinManager(ctx);
            await togglePin('a');
            await togglePin('a');

            expect(ctx.getPinnedPresetId()).toBe('');
            expect(state.persisted).toBe('');
        });

        it('switches the pin to a new id, leaving only one id pinned', async () => {
            const { togglePin } = createPinManager(ctx);
            await togglePin('a');
            await togglePin('b');

            expect(ctx.getPinnedPresetId()).toBe('b');
            expect(ctx.getPinnedPresetId()).not.toBe('a');
            expect(state.persisted).toBe('b');
            // exactly one id pinned -- the pinned value is a single string, not a set
            expect(typeof ctx.getPinnedPresetId()).toBe('string');
        });

        it('guard clause: does nothing and does not throw when called with a falsy id', async () => {
            const { togglePin } = createPinManager(ctx);
            await expect(togglePin()).resolves.not.toThrow();
            await togglePin('');

            expect(ctx.StorageManager.savePinnedPresetId).not.toHaveBeenCalled();
            expect(ctx.getPinnedPresetId()).toBe('');
        });
    });

    describe('clearPinIfDeleted()', () => {
        it('clears the pin when the pinned id is in the deleted list', async () => {
            const { togglePin, clearPinIfDeleted } = createPinManager(ctx);
            await togglePin('a');

            await clearPinIfDeleted(['a']);

            expect(ctx.getPinnedPresetId()).toBe('');
            expect(state.persisted).toBe('');
        });

        it('leaves the pin untouched and writes nothing when the pinned id is not in the deleted list', async () => {
            const { togglePin, clearPinIfDeleted } = createPinManager(ctx);
            await togglePin('a');
            ctx.StorageManager.savePinnedPresetId.mockClear();

            await clearPinIfDeleted(['b', 'c']);

            expect(ctx.getPinnedPresetId()).toBe('a');
            expect(ctx.StorageManager.savePinnedPresetId).not.toHaveBeenCalled();
        });

        it('does nothing and does not throw when nothing is pinned and the deleted list is empty', async () => {
            const { clearPinIfDeleted } = createPinManager(ctx);

            await expect(clearPinIfDeleted([])).resolves.not.toThrow();
            expect(ctx.getPinnedPresetId()).toBe('');
            expect(ctx.StorageManager.savePinnedPresetId).not.toHaveBeenCalled();
        });
    });
});
