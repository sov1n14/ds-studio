/**
 * Shared harness for the permission-intent specs: the popup toggle asks for an optional permission, Chrome closes the popup when its prompt appears, and the service worker must finish turning the setting on once chrome.permissions.onAdded fires.
 *
 * Trust boundary: only chrome.permissions is faked (createPermissionWorld). chrome.storage is the suite's in-memory double (copy semantics, see test/fixtures/chrome-storage-mock.js), shared by the popup and the service-worker side exactly as one extension's contexts share it. The popup modules, the permission wrappers, StorageManager and background/permission-intent-routes.js are the real files.
 *
 * Loader: every file is evaluated with evalPopupScript (fs read + direct eval), the same mechanism that loads the existing utils/clipboard-permission.js and popup/popup.toggles.js in this harness, so a load failure of the routes module is a fault of that module, not of the loader. Scripts that popup.html or service-worker.js load and that are not in the snapshot lists below are evaluated too, so a helper file added by the fix is present in the realm the way its loader would provide it.
 */
import fs from 'fs';
import path from 'path';
import { vi, expect } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';
import { evalPopupScript, readProjectFile } from './popup-script-loader.js';
import { mountPopupHtml } from './popup-master-switch-harness.js';

export { StorageManager };
export const ROUTES_REL = 'background/permission-intent-routes.js';
const PROJECT_ROOT = path.resolve(__dirname, '../..');
export const CLIPBOARD = ['clipboardWrite', 'offscreen'];
export const NOTIFICATIONS = ['notifications'];

// Snapshot of the scripts the loaders declared before the fix; anything else they declare later is evaluated by the loaders below.
const KNOWN_POPUP_SCRIPTS = new Set([
    'utils/logger.js', 'utils/debounce.js', 'utils/message-constants.js', 'utils/tab-control.js', 'utils/window-control.js',
    'utils/notification-permission.js', 'utils/clipboard-permission.js', 'utils/i18n.locales.zhTW.js', 'utils/i18n.locales.en.js',
    'utils/i18n.locales.js', 'utils/i18n.js', 'popup/popup.i18n-apply.js', 'popup/preset-item-renderer.js', 'popup/custom-select.drag.js',
    'popup/custom-select.js', 'popup/popup.modal.js', 'popup/popup.toast.js', 'popup/popup.preset-domain.js', 'utils/chat-session-id.js',
    'popup/popup.preset-manager.js', 'popup/popup.pin-manager.js', 'popup/popup.backup-manager.js', 'popup/popup.settings-view.js',
    'popup/popup.live-sync.js', 'popup/popup.editor-window.js', 'popup/popup.width-sliders.js', 'popup/popup.markdown-export.js',
    'popup/popup.toggles.js', 'popup/popup.locale.js', 'popup/popup.js',
]);
const KNOWN_WORKER_SCRIPTS = new Set([
    'utils/logger.js', 'utils/deepseek-api.js', 'utils/temporary-chat-constants.js', 'background/pending-store.js', 'utils/message-constants.js',
    'background/service-worker-constants.js', 'background/settings-routes.js', 'background/pending-store-routes.js',
    'background/editor-window-routes.js', 'background/notification-routes.js', 'background/clipboard-routes.js', 'background/chat-map-routes.js',
    ROUTES_REL,
]);
// StorageManager parts are preloaded by test/setup/vitest.setup.js (storage-manager.loader-contract.spec.js keeps that list complete).
const isStorageManagerPart = (rel) => /^utils\/storage-manager[.\w-]*\.js$/.test(rel);

function popupHtmlScripts() {
    const srcs = [...readProjectFile('popup/popup.html').matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
    return srcs.map((src) => path.posix.normalize(path.posix.join('popup', src)));
}

function workerScripts() {
    const call = readProjectFile('background/service-worker.js').match(/importScripts\(([\s\S]*?)\);/);
    if (!call) throw new Error('could not locate the importScripts(...) call in background/service-worker.js');
    return [...call[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => path.posix.normalize(path.posix.join('background', m[1])));
}

const isNewScript = (known) => (rel) => !known.has(rel) && !isStorageManagerPart(rel);

/** Loads the popup side: the permission wrappers, any script popup.html gained, then the settings view and the toggle manager. */
export function loadPopupModules() {
    evalPopupScript('utils/clipboard-permission.js');
    evalPopupScript('utils/notification-permission.js');
    popupHtmlScripts().filter(isNewScript(KNOWN_POPUP_SCRIPTS)).forEach((rel) => evalPopupScript(rel));
    evalPopupScript('popup/popup.settings-view.js');
    evalPopupScript('popup/popup.toggles.js');
    if (typeof globalThis.__DS_PopupToggles?.createToggleManager !== 'function') throw new Error('popup/popup.toggles.js did not expose __DS_PopupToggles.createToggleManager');
}

/** Loads background/permission-intent-routes.js (after any script service-worker.js gained) and returns its published API. A missing file and a bad published API are distinct errors. */
export function loadPermissionIntentRoutes() {
    if (!fs.existsSync(path.join(PROJECT_ROOT, ROUTES_REL))) throw new Error(ROUTES_REL + ' does not exist');
    workerScripts().filter(isNewScript(KNOWN_WORKER_SCRIPTS)).forEach((rel) => evalPopupScript(rel));
    evalPopupScript(ROUTES_REL);
    const routes = globalThis.DSSPermissionIntentRoutes;
    if (typeof routes?.install !== 'function') throw new Error(ROUTES_REL + ' loaded but globalThis.DSSPermissionIntentRoutes.install is not a function');
    return routes;
}

function createEvent() {
    const listeners = [];
    return {
        listeners,
        addListener: (fn) => { listeners.push(fn); },
        removeListener: (fn) => { const i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); },
        hasListener: (fn) => listeners.includes(fn),
    };
}

const neverSettles = () => new Promise(() => {});

/**
 * Fake chrome.permissions shared by the popup and the service worker. `granted` is the set of optional permissions the browser has granted; contains / getAll answer from it. holdNextContains() keeps the answer of the next contains query in flight until the test releases it, so a test can act while a caller awaits that answer. request() defaults to a promise that never settles: Chrome closes the popup when its prompt appears, so nothing after the popup's await ever runs. grant() models the user pressing Allow: the permissions join `granted`, then onAdded fires with a structured copy of { permissions, origins: [] } without awaiting its listeners, as Chrome dispatches events.
 */
export function createPermissionWorld() {
    const granted = new Set();
    let requestImpl = neverSettles;
    let heldContains = null;
    const answerContains = (set) => {
        const answer = (set?.origins ?? []).length === 0 && (set?.permissions ?? []).every((p) => granted.has(p));
        if (!heldContains) return Promise.resolve(answer);
        const hold = heldContains;
        heldContains = null;
        hold.isReached = true;
        return hold.released.then(() => answer);
    };
    const onAdded = createEvent();
    const api = {
        contains: vi.fn((set) => answerContains(set)),
        request: vi.fn((set) => requestImpl(set)),
        getAll: vi.fn(async () => ({ permissions: [...granted], origins: [] })),
        remove: vi.fn(async (set) => { (set?.permissions ?? []).forEach((p) => granted.delete(p)); return true; }),
        onAdded,
        onRemoved: createEvent(),
    };
    return {
        api,
        onAddedListeners: onAdded.listeners,
        reset() { granted.clear(); requestImpl = neverSettles; heldContains = null; api.contains.mockClear(); api.request.mockClear(); },
        /** The next contains query answers from `granted` as of the query, but the answer is delivered only after release(); isReached turns true when that query arrives. Later queries answer at once. */
        holdNextContains() {
            let release;
            const released = new Promise((resolve) => { release = resolve; });
            heldContains = { isReached: false, released, release };
            return heldContains;
        },
        /** The permissions already exist before the user acts (no prompt, no event). */
        preGrant(permissions) { permissions.forEach((p) => granted.add(p)); },
        /** The prompt answers the popup's request with this value while the popup is still open. */
        answerRequestWith(value) { requestImpl = async () => value; },
        /** Requests from now on never settle (the popup closed when the prompt appeared). */
        closePopupOnPrompt() { requestImpl = neverSettles; },
        grant(permissions) {
            permissions.forEach((p) => granted.add(p));
            const details = structuredClone({ permissions, origins: [] });
            [...onAdded.listeners].forEach((fn) => fn(details));
        },
    };
}

/** Runs a synchronous trigger with fake timers active and drains every storage and permission chain it starts in virtual time. */
export async function settle(trigger) {
    vi.useFakeTimers();
    try {
        trigger();
        await vi.advanceTimersByTimeAsync(1000);
    } finally {
        vi.useRealTimers();
    }
}

/** Mounts the real popup.html, builds the element map popup.js builds and binds a real toggle manager to it. */
export function openPopup() {
    mountPopupHtml();
    const dom = {};
    document.querySelectorAll('[id]').forEach((el) => { dom[el.id] = el; });
    dom.websearchRadios = [...document.querySelectorAll('input[name="websearchToggle"]')];
    dom.replyNotificationRadios = [...document.querySelectorAll('input[type="radio"][name="replyNotificationToggle"]')];
    globalThis.__DS_PopupToggles.createToggleManager({
        StorageManager,
        DSSClipboardPermission: globalThis.DSSClipboardPermission,
        DSSNotificationPermission: globalThis.DSSNotificationPermission,
        refreshSyncStatus: vi.fn(async () => {}),
        showSaveStatus: vi.fn(),
        applyMasterSwitchUI: vi.fn(),
        getPresets: () => [],
        setPresets: () => {},
        getActivePresetId: () => '',
        setActivePresetId: () => {},
    }).bindToggles(dom);
    return dom;
}

/** The user opens the popup again after an earlier popup was closed: a fresh popup DOM and a fresh toggle manager (createToggleManager + bindToggles, the two calls popup.js makes) on the same chrome.storage and chrome.permissions; drains every storage and permission chain the initialisation starts before the user can act. */
export async function reopenPopup() {
    let dom;
    await settle(() => { dom = openPopup(); });
    return dom;
}

/** The user opens the popup again while the answer to the open-time cleanup's first chrome.permissions.contains query is still in flight: every other initialisation chain is drained, the cleanup waits on that answer, so the user can act before the cleanup decides. finishCleanup() delivers the answer and drains the rest of the cleanup. */
export async function openPopupWithCleanupHeld(world) {
    const hold = world.holdNextContains();
    let dom;
    await settle(() => { dom = openPopup(); });
    expect(hold.isReached, 'precondition: the open-time cleanup is waiting on a chrome.permissions.contains answer').toBe(true);
    return { dom, finishCleanup: () => settle(() => hold.release()) };
}

function setCheckbox(dom, id, isChecked) {
    const box = dom[id];
    expect(box, '#' + id + ' missing from popup.html').toBeTruthy();
    return settle(() => { box.checked = isChecked; box.dispatchEvent(new Event('change', { bubbles: true })); });
}

function selectReplyNotification(dom, value) {
    const radio = dom.replyNotificationRadios.find((r) => r.value === value);
    expect(radio, 'popup.html has no replyNotificationToggle radio valued "' + value + '"').toBeTruthy();
    return settle(() => { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); });
}

/** The three permission-gated settings: getSettings() field, the popup control, the permissions its prompt asks for, and the user's on / off gestures. */
export const TARGETS = [
    { field: 'autoCopyReply', control: '#autoCopyReplyToggle', permissions: CLIPBOARD, turnOn: (dom) => setCheckbox(dom, 'autoCopyReplyToggle', true), turnOff: (dom) => setCheckbox(dom, 'autoCopyReplyToggle', false) },
    { field: 'autoCopyCode', control: '#autoCopyCodeToggle', permissions: CLIPBOARD, turnOn: (dom) => setCheckbox(dom, 'autoCopyCodeToggle', true), turnOff: (dom) => setCheckbox(dom, 'autoCopyCodeToggle', false) },
    { field: 'replyNotification', control: 'replyNotificationToggle radio "on"', permissions: NOTIFICATIONS, turnOn: (dom) => selectReplyNotification(dom, 'on'), turnOff: (dom) => selectReplyNotification(dom, 'off') },
];
export const targetOf = (field) => TARGETS.find((t) => t.field === field);

/** The three settings as the real StorageManager reports them. */
export async function readGatedSettings() {
    const settings = await StorageManager.getSettings();
    return Object.fromEntries(TARGETS.map(({ field }) => [field, settings[field]]));
}
