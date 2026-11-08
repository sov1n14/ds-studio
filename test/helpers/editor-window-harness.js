/**
 * Harness for scenario tests that drive the real prompt-group editor window (popup/editor/editor.js) end to end.
 *
 * Real modules: editor.js and its editor.* parts (preloaded by test/setup/vitest.setup.js), StorageManager, DSSDebounce, DSSPresetDomain, the i18n apply helper. The only double is the trust boundary: the in-memory chrome.storage from test/fixtures/chrome-storage-mock.js, plus window.close, which a test environment cannot honour. DSSTabControl (a chrome.tabs wrapper) stays absent, a case the editor supports.
 *
 * Timers are faked from the moment editor.js loads, so the debounce and any bounded wait the editor uses run on test-controlled time, and leftover timers die in cleanup() instead of writing into the next test's storage.
 */
import { vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';
import '../../utils/debounce.js';
import '../../popup/popup.preset-domain.js';
import '../../popup/popup.i18n-apply.js';

globalThis.StorageManager = StorageManager;

// Body of popup/editor/editor.html (ids and initial classes copied verbatim).
const EDITOR_BODY_HTML = `
    <div class="editor-layout">
        <header class="editor-header">
            <h1 id="editorTitle" data-i18n="editorHeading">提示詞編輯器</h1>
            <input id="editorNameInput" class="editor-name-input is-hidden" type="text" autocomplete="off" spellcheck="false">
            <span id="editorSaveStatus" class="save-status save-status--hidden" data-i18n="savedInitial">已儲存</span>
        </header>
        <main class="editor-body">
            <textarea id="editorTextarea" class="editor-textarea"></textarea>
        </main>
    </div>`;

const STEP_MS = 50;

export function createEditorWindowHarness() {
    const originalLocation = globalThis.location;
    const listenerTargets = [...new Set([window, globalThis, document])];
    const addListenerSpies = [];
    const storageAreas = [chrome.storage.local, chrome.storage.sync];
    // One entry per window.close() call: a copy of both storage areas taken at that instant.
    const closeSnapshots = [];
    let closeSpies = [];
    // Call-through spies on each area's set(), created after seeding, so every write the editor makes is observable at the chrome.storage boundary.
    let writeSpies = [];

    const el = {
        get nameInput() { return document.getElementById('editorNameInput'); },
        get textarea() { return document.getElementById('editorTextarea'); },
        get saveStatus() { return document.getElementById('editorSaveStatus'); },
    };

    /** Advance fake time in small steps until predicate() holds or maxMs elapses; returns whether it held. */
    async function advanceUntil(predicate, maxMs) {
        for (let elapsed = 0; elapsed < maxMs; elapsed += STEP_MS) {
            if (predicate()) return true;
            await vi.advanceTimersByTimeAsync(STEP_MS);
        }
        return predicate();
    }

    /** Seed presets through the real StorageManager, then open the editor on `?target=preset&id=<id>` and wait for it to finish loading. */
    async function openPresetEditor({ presets, id }) {
        await StorageManager.initialize();
        await StorageManager.savePromptPresets(presets);
        writeSpies = storageAreas.map(area => vi.spyOn(area, 'set'));

        document.body.innerHTML = EDITOR_BODY_HTML;
        Object.defineProperty(globalThis, 'location', {
            value: { search: `?target=preset&id=${id}` },
            writable: true,
            configurable: true,
        });
        for (const target of listenerTargets) addListenerSpies.push({ target, spy: vi.spyOn(target, 'addEventListener') });
        closeSpies = [...new Set([window, globalThis])].map(target => vi.spyOn(target, 'close').mockImplementation(() => {
            closeSnapshots.push({
                local: structuredClone(chrome.storage.local._data),
                sync: structuredClone(chrome.storage.sync._data),
            });
        }));

        vi.useFakeTimers();
        vi.resetModules();
        await import('../../popup/editor/editor.js');
        document.dispatchEvent(new Event('DOMContentLoaded'));

        const isLoaded = await advanceUntil(() => el.nameInput && !el.nameInput.classList.contains('is-hidden'), 3000);
        if (!isLoaded) throw new Error('harness: editor never revealed #editorNameInput after DOMContentLoaded (setup failure, not the behaviour under test)');
        await vi.advanceTimersByTimeAsync(STEP_MS);
    }

    function type(field, value) {
        field.value = value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
    }

    /** A real Esc press targets the focused element and bubbles to document and window. isComposing marks an Esc that cancels an IME composition; repeat marks an auto-repeat from holding the key. */
    function pressEscape({ isComposing = false, repeat = false } = {}) {
        const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : el.nameInput;
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true, isComposing, repeat }));
    }

    /** Number of chrome.storage set() calls (any area) since the editor opened whose items include the given preset's key. */
    function presetWriteCount(id) {
        const key = `dsPreset_${id}`;
        return writeSpies.reduce((sum, spy) => sum + spy.mock.calls.filter(([items]) => items && Object.prototype.hasOwnProperty.call(items, key)).length, 0);
    }

    /** Fire the window's pagehide event, as the browser does when the window starts to close. */
    function firePagehide() {
        window.dispatchEvent(new Event('pagehide'));
    }

    function closeCallCount() {
        return closeSnapshots.length;
    }

    /** Read one preset back through StorageManager from the given storage contents (a close-time snapshot, or the live storage when omitted). */
    async function readPreset(id, snapshot) {
        if (snapshot) {
            chrome.storage.local._data = structuredClone(snapshot.local);
            chrome.storage.sync._data = structuredClone(snapshot.sync);
        }
        const pending = StorageManager.getSettings();
        await vi.advanceTimersByTimeAsync(200);
        const settings = await pending;
        return settings.promptPresets.find(p => p.id === id);
    }

    /** Make every storage write fail the way real chrome.storage reports a quota error. */
    function failStorageWrites() {
        storageAreas.forEach(area => area.setQuotaError(true));
    }

    /** Make every storage write hang forever (neither resolves, rejects, nor calls back). */
    function hangStorageWrites() {
        storageAreas.forEach(area => vi.spyOn(area, 'set').mockImplementation(() => new Promise(() => {})));
    }

    function cleanup() {
        vi.clearAllTimers();
        vi.useRealTimers();
        for (const { target, spy } of addListenerSpies) {
            spy.mock.calls.forEach(([type, fn, opts]) => target.removeEventListener(type, fn, opts));
            spy.mockRestore();
        }
        addListenerSpies.length = 0;
        closeSpies.forEach(spy => spy.mockRestore());
        writeSpies = [];
        storageAreas.forEach(area => {
            area.setQuotaError(false);
            if (vi.isMockFunction(area.set)) area.set.mockRestore();
        });
        Object.defineProperty(globalThis, 'location', { value: originalLocation, writable: true, configurable: true });
        document.body.innerHTML = '';
    }

    return { el, openPresetEditor, type, pressEscape, firePagehide, presetWriteCount, closeCallCount, closeSnapshots, advanceUntil, readPreset, failStorageWrites, hangStorageWrites, cleanup };
}
