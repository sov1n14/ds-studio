/**
 * Harness for scenario tests that drive the real prompt-group editor window (popup/editor/editor.js) end to end.
 *
 * Real modules: editor.js and its editor.* parts (preloaded by test/setup/vitest.setup.js), StorageManager, DSSDebounce, DSSPresetDomain, the i18n apply helper. The only double is the trust boundary: the in-memory chrome.storage from test/fixtures/chrome-storage-mock.js, plus window.close, which a test environment cannot honour. DSSTabControl (a chrome.tabs wrapper) stays absent, a case the editor supports.
 *
 * chrome.runtime.onMessage listeners that the editor page registers are captured in `pageMessageListeners` instead of joining the shared mock event, so a scenario can deliver runtime messages to this page alone (see test/helpers/editor-window-flush-doubles.js connectRuntimeBus).
 *
 * Scripts that popup/editor/editor.html declares beyond the ones known when this harness was written (EDITOR_SCRIPTS_KNOWN) are loaded before editor.js, in declaration order, so a new editor part or utils/ wrapper reaches the page the way the real window loads it. utils/tab-control.js stays deliberately absent.
 *
 * Timers are faked from the moment editor.js loads, so the debounce and any bounded wait the editor uses run on test-controlled time, and leftover timers die in cleanup() instead of writing into the next test's storage.
 */
import { vi } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
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

// Repo paths of the editor.html scripts this harness already provides (preloaded by test/setup/vitest.setup.js or imported above), plus utils/tab-control.js (deliberately absent) and editor.js (imported per test).
const EDITOR_SCRIPTS_KNOWN = new Set([
    'utils/logger.js', 'utils/debounce.js', 'utils/message-constants.js', 'utils/tab-control.js',
    'utils/storage-manager.keys.js', 'utils/storage-manager.rw.js', 'utils/storage-manager.sync.js', 'utils/storage-manager.sync.retry.js',
    'utils/storage-manager.restore.js', 'utils/storage-manager.tombstone.js', 'utils/storage-manager.preset-merge.js', 'utils/storage-manager.preset-recency.js',
    'utils/storage-manager.presets.js', 'utils/storage-manager.chatmap.diff.js', 'utils/storage-manager.chatmap.ops.js', 'utils/storage-manager.chatmap.js',
    'utils/storage-manager.chatmap.client.js', 'utils/storage-manager.local.js', 'utils/storage-manager.init.js', 'utils/storage-manager.setters.js',
    'utils/storage-manager.settings-read.js', 'utils/storage-manager.js',
    'utils/i18n.locales.zhTW.js', 'utils/i18n.locales.en.js', 'utils/i18n.locales.js', 'utils/i18n.js',
    'popup/popup.i18n-apply.js', 'popup/popup.preset-domain.js',
    'popup/editor/editor.parse.js', 'popup/editor/editor.render.js', 'popup/editor/editor.storage.js', 'popup/editor/editor.autosave.js', 'popup/editor/editor.js',
]);
const SCRIPT_LOADERS = import.meta.glob(['../../utils/*.js', '../../popup/*.js', '../../popup/editor/*.js']);
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Repo paths of editor.html scripts outside EDITOR_SCRIPTS_KNOWN, in declaration order. */
function newEditorScriptPaths() {
    const html = readFileSync(resolve(PROJECT_ROOT, 'popup/editor/editor.html'), 'utf-8');
    const srcs = [...html.matchAll(/<script +src="([^"]+)"/g)].map(m => m[1]);
    return srcs.map((s) => {
        const parts = ['popup', 'editor'];
        s.split('/').forEach((seg) => { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); });
        return parts.join('/');
    }).filter(p => !EDITOR_SCRIPTS_KNOWN.has(p));
}

async function importNewEditorScripts() {
    for (const repoPath of newEditorScriptPaths()) {
        const load = SCRIPT_LOADERS[`../../${repoPath}`];
        if (!load) throw new Error(`harness: popup/editor/editor.html declares ${repoPath}, which the harness glob cannot load (extend SCRIPT_LOADERS in test/helpers/editor-window-harness.js)`);
        await load();
    }
}

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
    // onMessage listeners the editor page registered, in registration order (see the file header).
    const pageMessageListeners = [];
    let messageListenerSpies = [];

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

        messageListenerSpies = [
            vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementation((fn) => { pageMessageListeners.push(fn); }),
            vi.spyOn(chrome.runtime.onMessage, 'removeListener').mockImplementation((fn) => {
                const idx = pageMessageListeners.indexOf(fn);
                if (idx !== -1) pageMessageListeners.splice(idx, 1);
            }),
        ];

        vi.useFakeTimers();
        vi.resetModules();
        await importNewEditorScripts();
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
        messageListenerSpies.forEach(spy => spy.mockRestore());
        messageListenerSpies = [];
        pageMessageListeners.length = 0;
        writeSpies = [];
        storageAreas.forEach(area => {
            area.setQuotaError(false);
            if (vi.isMockFunction(area.set)) area.set.mockRestore();
        });
        Object.defineProperty(globalThis, 'location', { value: originalLocation, writable: true, configurable: true });
        document.body.innerHTML = '';
    }

    return { el, pageMessageListeners, openPresetEditor, type, pressEscape, firePagehide, presetWriteCount, closeCallCount, closeSnapshots, advanceUntil, readPreset, failStorageWrites, hangStorageWrites, cleanup };
}
