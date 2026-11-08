/**
 * Scenario: Esc in the prompt-group editor window must not lose typed edits (bug I-06).
 *
 * Requirement (docs/FEATURES.md, Prompt Groups item 6): "Press `Esc` to close the editor window (unsaved content is auto-saved first)".
 * Expected behaviour (lead decisions, DECISIONS D-38):
 * - dirty edits: window.close() runs only after the edits are persisted, so storage already holds the typed name and content at that instant;
 * - the save rejects with DUPLICATE_NAME: the window stays open and the editor shows its duplicate-name error;
 * - the storage write rejects for another reason, or never settles: the window still closes after a bounded wait (ESC_SAVE_WAIT_MS, 1500 ms); these tests allow CLOSE_BOUND_MS (2000 ms);
 * - no edits: the window closes at once;
 * - an Esc that cancels an IME composition (isComposing) neither closes the window nor drops the edits;
 * - an Esc pressed again while the first Esc is still saving (including a held-key auto-repeat) closes the window once and writes the edit once;
 * - a pagehide backstop that fires while the Esc save is in flight does not write the same edit a second time;
 * - typed edits are auto-saved 500 ms after the last input.
 *
 * Real modules share real state (editor.js, StorageManager, in-memory chrome.storage); only chrome.storage and window.close are doubles. See test/helpers/editor-window-harness.js.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createEditorWindowHarness } from '../helpers/editor-window-harness.js';

const PRESET_ID = 'poc-1';
const ORIGINAL = { id: PRESET_ID, name: 'poc original', content: 'ORIGINAL', createdAt: 1000, updatedAt: 1000 };
const CLOSE_BOUND_MS = 2000;
const AUTOSAVE_DEBOUNCE_MS = 500;

describe('editor window: Esc saves typed edits before closing (I-06)', () => {
    let h;

    beforeEach(() => {
        h = createEditorWindowHarness();
    });

    afterEach(() => {
        h.cleanup();
    });

    /** Let one edit auto-save and return how many preset writes one save makes at the storage boundary, so write-count tests compare against an observed save instead of a storage-layout constant. */
    async function measureWritesForOneSave() {
        const before = h.presetWriteCount(PRESET_ID);
        h.type(h.el.textarea, 'BASELINE-CONTENT');
        await h.advanceUntil(() => false, 3000);
        const writes = h.presetWriteCount(PRESET_ID) - before;
        expect(writes, 'one auto-save writes the preset key at least once (baseline)').toBeGreaterThan(0);
        return writes;
    }

    it('control: typed edits reach storage through the editor autosave when Esc is not pressed (proves the harness persists edits)', async () => {
        await h.openPresetEditor({ presets: [ORIGINAL], id: PRESET_ID });
        h.type(h.el.textarea, 'NEW-CONTENT');
        h.type(h.el.nameInput, 'poc renamed');

        await h.advanceUntil(() => false, 3000);

        const stored = await h.readPreset(PRESET_ID);
        expect(stored, 'autosave persisted name').toMatchObject({ name: 'poc renamed', content: 'NEW-CONTENT' });
        expect(h.closeCallCount(), 'window.close without Esc').toBe(0);
    });

    it('autosave debounce: the save starts 500 ms after the last input, not at 499 ms, and its write follows', async () => {
        await h.openPresetEditor({ presets: [ORIGINAL], id: PRESET_ID });
        h.type(h.el.textarea, 'NEW-CONTENT');

        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 1);
        expect(h.presetWriteCount(PRESET_ID), `preset writes ${AUTOSAVE_DEBOUNCE_MS - 1} ms after the input`).toBe(0);
        expect(h.el.saveStatus.classList.contains('save-status--hidden'), `save status still hidden ${AUTOSAVE_DEBOUNCE_MS - 1} ms after the input (no save started)`).toBe(true);

        await vi.advanceTimersByTimeAsync(1);
        expect(h.el.saveStatus.textContent, `save status ${AUTOSAVE_DEBOUNCE_MS} ms after the input (save started)`).toBe('儲存中…');

        // The write itself lands after the save's storage reads, each a chained setTimeout(0) that fake timers count as 1 ms; WRITE_LATENCY_BOUND_MS stays below the 100 ms a mis-set debounce would shift it.
        const WRITE_LATENCY_BOUND_MS = 50;
        const hasWritten = await h.advanceUntil(() => h.presetWriteCount(PRESET_ID) > 0, WRITE_LATENCY_BOUND_MS);
        expect(hasWritten, `preset written within ${WRITE_LATENCY_BOUND_MS} ms after the save started`).toBe(true);
    });

    it('dirty edits: at the moment window.close() is called, storage already holds the typed name and content', async () => {
        await h.openPresetEditor({ presets: [ORIGINAL], id: PRESET_ID });
        h.type(h.el.textarea, 'NEW-CONTENT');
        h.type(h.el.nameInput, 'poc renamed');

        h.pressEscape();
        const isClosed = await h.advanceUntil(() => h.closeCallCount() > 0, CLOSE_BOUND_MS);
        expect(isClosed, `window.close() called within ${CLOSE_BOUND_MS} ms of Esc`).toBe(true);

        await h.advanceUntil(() => false, 3000);
        const storedAtClose = await h.readPreset(PRESET_ID, h.closeSnapshots[0]);
        expect(storedAtClose.name, 'preset name in storage when window.close() ran').toBe('poc renamed');
        expect(storedAtClose.content, 'preset content in storage when window.close() ran').toBe('NEW-CONTENT');
    });

    it('IME composition: Esc with isComposing keeps the window open and the edits; a later plain Esc saves them and closes', async () => {
        await h.openPresetEditor({ presets: [ORIGINAL], id: PRESET_ID });
        h.type(h.el.textarea, 'NEW-CONTENT');
        h.type(h.el.nameInput, 'poc renamed');

        h.pressEscape({ isComposing: true });
        await h.advanceUntil(() => h.closeCallCount() > 0, CLOSE_BOUND_MS);
        expect(h.closeCallCount(), 'window.close() calls after an Esc that cancels an IME composition').toBe(0);

        h.pressEscape();
        const isClosed = await h.advanceUntil(() => h.closeCallCount() > 0, CLOSE_BOUND_MS);
        expect(isClosed, `window.close() called within ${CLOSE_BOUND_MS} ms of the plain Esc`).toBe(true);
        expect(h.closeCallCount(), 'window.close() calls in total').toBe(1);
        const storedAtClose = await h.readPreset(PRESET_ID, h.closeSnapshots[0]);
        expect(storedAtClose, 'preset in storage when window.close() ran').toMatchObject({ name: 'poc renamed', content: 'NEW-CONTENT' });
    });

    it.each([
        ['a second Esc press', {}],
        ['a held-key auto-repeat (repeat: true)', { repeat: true }],
    ])('Esc again while the first Esc is saving (%s): window.close() runs once and the edit is written once', async (_label, secondPress) => {
        await h.openPresetEditor({ presets: [ORIGINAL], id: PRESET_ID });
        const writesForOneSave = await measureWritesForOneSave();
        const writesBefore = h.presetWriteCount(PRESET_ID);
        h.type(h.el.textarea, 'NEW-CONTENT');

        h.pressEscape();
        h.pressEscape(secondPress);
        await h.advanceUntil(() => false, CLOSE_BOUND_MS + 1000);

        expect(h.closeCallCount(), 'window.close() calls after two Esc presses').toBe(1);
        expect(h.presetWriteCount(PRESET_ID) - writesBefore, 'preset writes for the edit (one save)').toBe(writesForOneSave);
        const storedAtClose = await h.readPreset(PRESET_ID, h.closeSnapshots[0]);
        expect(storedAtClose.content, 'preset content in storage when window.close() ran').toBe('NEW-CONTENT');
    });

    it('pagehide while the Esc save is in flight: the edit is written once, not a second time in parallel', async () => {
        await h.openPresetEditor({ presets: [ORIGINAL], id: PRESET_ID });
        const writesForOneSave = await measureWritesForOneSave();
        const writesBefore = h.presetWriteCount(PRESET_ID);
        h.type(h.el.textarea, 'NEW-CONTENT');

        h.pressEscape();
        h.firePagehide();
        await h.advanceUntil(() => false, CLOSE_BOUND_MS + 1000);

        expect(h.closeCallCount(), 'window.close() calls').toBe(1);
        expect(h.presetWriteCount(PRESET_ID) - writesBefore, 'preset writes for the edit after Esc then pagehide (one save)').toBe(writesForOneSave);
        const stored = await h.readPreset(PRESET_ID);
        expect(stored.content, 'preset content in storage').toBe('NEW-CONTENT');
    });

    it('duplicate name: Esc keeps the window open and shows the duplicate-name error', async () => {
        const taken = { id: 'poc-2', name: 'taken', content: 'OTHER', createdAt: 1000, updatedAt: 1000 };
        await h.openPresetEditor({ presets: [ORIGINAL, taken], id: PRESET_ID });
        h.type(h.el.textarea, 'NEW-CONTENT');
        h.type(h.el.nameInput, 'taken');

        h.pressEscape();
        await h.advanceUntil(() => h.closeCallCount() > 0, CLOSE_BOUND_MS + 1000);

        expect(h.closeCallCount(), 'window.close() calls after Esc with a duplicate name').toBe(0);
        expect(h.el.saveStatus.textContent, 'save status text').toBe('「taken」已存在，請使用不同的名稱。');
        expect(h.el.saveStatus.classList.contains('save-status--error'), 'save status carries the error class').toBe(true);
    });

    it('storage write rejects (quota error): Esc still closes the window within 2000 ms, and storage at close still holds the old preset', async () => {
        await h.openPresetEditor({ presets: [ORIGINAL], id: PRESET_ID });
        h.failStorageWrites();
        h.type(h.el.textarea, 'NEW-CONTENT');
        h.type(h.el.nameInput, 'poc renamed');

        h.pressEscape();
        const isClosed = await h.advanceUntil(() => h.closeCallCount() > 0, CLOSE_BOUND_MS);

        expect(isClosed, `window.close() called within ${CLOSE_BOUND_MS} ms of Esc despite the failed write`).toBe(true);
        expect(h.presetWriteCount(PRESET_ID), 'preset writes attempted before the close (the rejected save)').toBeGreaterThan(0);
        const storedAtClose = await h.readPreset(PRESET_ID, h.closeSnapshots[0]);
        expect(storedAtClose, 'preset in storage when window.close() ran (the write was rejected)').toMatchObject({ name: 'poc original', content: 'ORIGINAL' });
    });

    it('storage write never settles: Esc still closes the window within 2000 ms', async () => {
        await h.openPresetEditor({ presets: [ORIGINAL], id: PRESET_ID });
        h.hangStorageWrites();
        h.type(h.el.textarea, 'NEW-CONTENT');
        h.type(h.el.nameInput, 'poc renamed');

        h.pressEscape();
        const isClosed = await h.advanceUntil(() => h.closeCallCount() > 0, CLOSE_BOUND_MS);

        expect(isClosed, `window.close() called within ${CLOSE_BOUND_MS} ms of Esc despite the hung write`).toBe(true);
    });

    it('no edits: Esc closes the window at once, without waiting on any timer', async () => {
        await h.openPresetEditor({ presets: [ORIGINAL], id: PRESET_ID });

        h.pressEscape();
        for (let i = 0; i < 10; i++) await Promise.resolve();

        expect(h.closeCallCount(), 'window.close() calls before any timer runs').toBe(1);
    });
});
