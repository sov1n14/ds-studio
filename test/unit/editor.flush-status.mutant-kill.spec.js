/**
 * The status the prompt group editor window reports for a flush request (DSS_FLUSH_EDITOR_WINDOW), read by the caller through the real request side.
 *
 * Requirement (docs/architecture/POPUP.md "Flush requests", docs/ARCHITECTURE.md DSS_FLUSH_EDITOR_WINDOW): the editor whose target matches `slot` saves pending edits and replies `{ status }`; `flushPendingEdits` returns `clean` when nothing is pending, and `saved` when the pending save succeeds. Only `duplicate` stops the caller, so `clean` and `saved` are never asserted by the close and navigation scenarios, which treat every other status alike; this spec asserts the exact status string.
 *
 * Real modules: popup/editor/editor.js and its parts, utils/editor-flush-channel.js (requestEditorFlush and the page listener), StorageManager and the in-memory chrome.storage (test/helpers/editor-window-harness.js). Double: chrome.runtime.sendMessage, routed to the editor page's own onMessage listeners (test/helpers/editor-window-flush-doubles.js connectRuntimeBus).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createEditorWindowHarness } from '../helpers/editor-window-harness.js';
import { createEditorWindowFlushDoubles } from '../helpers/editor-window-flush-doubles.js';

const PRESET_ID = 'flush-1';
const ORIGINAL = { id: PRESET_ID, name: 'flush original', content: 'ORIGINAL', createdAt: 1000, updatedAt: 1000 };
const SERVICE_WORKER_SENDER = { id: 'test-extension-id', url: 'chrome-extension://test-extension-id/background/service-worker.js' };
// The autosave debounce is 500 ms; 2000 ms of fake time lets a typed edit save and settle on its own.
const AUTOSAVE_SETTLE_MS = 2000;
// requestEditorFlush gives up after 1000 ms; 1500 ms covers any reply the editor sends in time.
const REPLY_BOUND_MS = 1500;

describe('editor flush request: reported status', () => {
    let h;
    let d;

    beforeEach(async () => {
        d = createEditorWindowFlushDoubles();
        h = createEditorWindowHarness();
        await h.openPresetEditor({ presets: [ORIGINAL], id: PRESET_ID });
        d.connectRuntimeBus(() => h.pageMessageListeners, SERVICE_WORKER_SENDER);
    });

    afterEach(() => {
        h.cleanup();
        d.restore();
    });

    /** Send a flush request for the preset slot through the real request side and return its settled status. */
    async function requestPresetFlush() {
        let reply = { isSettled: false };
        globalThis.DSSEditorFlushChannel.requestEditorFlush('preset').then((status) => { reply = { isSettled: true, status }; });
        await d.advanceUntil(() => reply.isSettled, REPLY_BOUND_MS);
        expect(reply.isSettled, 'requestEditorFlush settled').toBe(true);
        return reply.status;
    }

    it('reports clean for an editor just opened with no edit, and writes nothing', async () => {
        const status = await requestPresetFlush();

        expect(status, 'status for an editor with no pending edit').toBe('clean');
        expect(h.presetWriteCount(PRESET_ID), 'preset writes since the editor opened').toBe(0);
    });

    it('reports clean after a typed edit has already been saved by the autosave', async () => {
        h.type(h.el.textarea, 'AUTOSAVED');
        await d.advanceUntil(() => false, AUTOSAVE_SETTLE_MS);
        expect((await h.readPreset(PRESET_ID)).content, 'precondition: the autosave stored the edit').toBe('AUTOSAVED');
        const writesBefore = h.presetWriteCount(PRESET_ID);

        const status = await requestPresetFlush();

        expect(status, 'status once the autosave has saved the edit').toBe('clean');
        expect(h.presetWriteCount(PRESET_ID), 'preset writes caused by the flush request').toBe(writesBefore);
    });

    it('reports saved for a pending edit (typed, autosave not yet fired) that the flush writes', async () => {
        h.type(h.el.textarea, 'PENDING-CONTENT');
        h.type(h.el.nameInput, 'flush renamed');

        const status = await requestPresetFlush();

        expect(status, 'status for a pending edit saved by the flush').toBe('saved');
        const stored = await h.readPreset(PRESET_ID);
        expect(stored.content, 'stored preset content after the flush').toBe('PENDING-CONTENT');
        expect(stored.name, 'stored preset name after the flush').toBe('flush renamed');
    });
});
