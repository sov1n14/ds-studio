/**
 * Unit tests for createPresetOverlay (preset-overlay.controller.js).
 *
 * StorageManager is a global populated by the real storage-manager.js chain
 * loaded in vitest.setup.js — we spy on its methods to avoid storage I/O
 * without replacing the module.
 *
 * Regression focus: onSelectChange must call reposition() as its final
 * statement so the overlay re-positions after the label text width changes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// Ensure the StorageManager global is populated before any test runs.
import '../../utils/storage-manager.js';

const { createPresetOverlay } = require('../../content/preset-overlay.controller.js');

// ── helpers ──────────────────────────────────────────────────────────────────

function makeCtx(overrides = {}) {
    return {
        getIsEnabled:               vi.fn(() => true),
        getCurrentChatUuid:         vi.fn(() => 'uuid-1234'),
        setCurrentChatUuid:         vi.fn(),
        getChatPresetMap:           vi.fn(() => ({})),
        setChatPresetMap:           vi.fn(),
        setPendingPresetId:         vi.fn(),
        updatePromptPrefixFromBinding: vi.fn(),
        isExtensionContextValid:    vi.fn(() => true),
        ...overrides,
    };
}

/**
 * Mount a minimal DOM target so reposition() guard clauses
 * (wrapperEl && targetEl) pass without crashing.
 */
function mountOverlay(overlay) {
    const target = document.createElement('div');
    document.body.appendChild(target);
    overlay.mountTo(target);
    return target;
}

function teardownOverlay(overlay, target) {
    if (overlay) overlay.unmount();
    if (target && target.parentNode) target.parentNode.removeChild(target);
}

// ── StorageManager spy helpers ────────────────────────────────────────────────

let smSpies = [];

function spyStorageManager() {
    const resolved = Promise.resolve({});
    smSpies = [
        vi.spyOn(StorageManager, 'bindChatToPreset').mockReturnValue(resolved),
        vi.spyOn(StorageManager, 'unbindChat').mockReturnValue(resolved),
        vi.spyOn(StorageManager, 'getChatPresetMap').mockResolvedValue({}),
        vi.spyOn(StorageManager, 'saveActivePresetId').mockReturnValue(resolved),
    ];
}

function restoreStorageManager() {
    smSpies.forEach(s => s.mockRestore());
    smSpies = [];
}

// ── Group A: regression — onSelectChange calls reposition ────────────────────

describe('onSelectChange — reposition regression', () => {
    let overlay, ctx, target;

    beforeEach(() => {
        spyStorageManager();
        ctx     = makeCtx();
        overlay = createPresetOverlay(ctx);
        target  = mountOverlay(overlay);
        // Replace reposition with a spy AFTER mount (mount itself calls reposition
        // via render path; we only care about calls from onSelectChange).
        overlay.reposition = vi.fn();
    });

    afterEach(() => {
        teardownOverlay(overlay, target);
        restoreStorageManager();
    });

    it('calls reposition after selecting a non-empty preset id (bind path)', () => {
        overlay.onSelectChange('preset-A');
        expect(overlay.reposition).toHaveBeenCalledTimes(1);
    });

    it('calls reposition after selecting empty string (unbind path)', () => {
        overlay.onSelectChange('');
        expect(overlay.reposition).toHaveBeenCalledTimes(1);
    });

    it('calls reposition when there is no currentChatUuid (pending path)', () => {
        ctx.getCurrentChatUuid.mockReturnValue(null);
        overlay.onSelectChange('preset-B');
        expect(overlay.reposition).toHaveBeenCalledTimes(1);
    });

    it('reposition is the LAST call — not skipped on any branch', () => {
        // Verify that reposition is invoked after updatePromptPrefixFromBinding
        // by checking call order via mock.invocationCallOrder
        ctx.getCurrentChatUuid.mockReturnValue('uuid-xyz');
        const updateOrder = [];
        ctx.updatePromptPrefixFromBinding.mockImplementation(() => {
            updateOrder.push('update');
        });
        overlay.reposition = vi.fn(() => {
            updateOrder.push('reposition');
        });

        overlay.onSelectChange('preset-C');

        expect(updateOrder).toEqual(['update', 'reposition']);
    });
});
