/**
 * Auto-copy toggles - storage schema, popup Features card, optional clipboard permission gate, master-switch gating, live sync (red phase: the permission gate is not implemented yet).
 *
 * Requirement (user request + decisions): two Features toggles, "auto-copy reply content" and "auto-copy code block content". D-05 they are checkboxes; U6-05 both default off. Decided design:
 *   1. Storage keys "isAutoCopyReplyEnabled" / "isAutoCopyCodeEnabled" are StorageManager.KEYS values, default false in DEFAULTS, synced settings (written to chrome.storage.sync as well as local), with setters following saveAutoOpenSidebar, exposed by getSettings() and restorable from a backup like the other synced toggles.
 *   2. popup.html Features card holds checkboxes #autoCopyReplyToggle / #autoCopyCodeToggle, labelled data-i18n="autoCopyReplyLabel" / "autoCopyCodeLabel", both keys defined in zh-TW and en; their position in the card (D-27) is asserted by popup-card-order.spec.js.
 *   3. Changing a checkbox saves its key; applyMasterSwitchUI(false) disables both; a storage change of a key updates its checkbox (live sync).
 *   4. U6-14: clipboardWrite and offscreen are both optional permissions, requested together when either checkbox turns on; refusal reverts the checkbox (same flow as the reply-notification toggle). Checking asks contains first and requests only when absent; granted -> the key is saved true; refused or failed -> the box is unchecked and true is never stored. Unchecking saves false without touching chrome.permissions.
 *
 * Names this spec fixes because the design leaves them to the setter / getSettings conventions: setters saveAutoCopyReply / saveAutoCopyCode (after saveAutoOpenSidebar for "isAutoOpenSidebarEnabled"), getSettings() / backup fields autoCopyReply / autoCopyCode (after autoOpenSidebar).
 *
 * Patterns: real popup.html DOM, eval()-loaded popup factories, real applyMasterSwitchUI through popup-master-switch-harness.js (as popup-auto-click-toggles.spec.js); storage assertions read the raw stored key or getSettings(), never a spy.
 * Trust boundary: only chrome.permissions and chrome.storage are faked; the real utils/clipboard-permission.js wrapper (globalThis.DSSClipboardPermission) sits between the popup and the chrome.permissions double, loaded the way popup-reply-notification-toggle.spec.js loads its wrapper, and is also passed in ctx as DSSClipboardPermission so either access route works.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';
import { evalPopupScript, readProjectFile } from '../helpers/popup-script-loader.js';
import { parsePopupHtml, mountPopupHtml, buildApplyMasterSwitchUI } from '../helpers/popup-master-switch-harness.js';

const TOGGLES = [
    // [storage key, setter, getSettings / backup field, element id, i18n key]
    ['isAutoCopyReplyEnabled', 'saveAutoCopyReply', 'autoCopyReply', 'autoCopyReplyToggle', 'autoCopyReplyLabel'],
    ['isAutoCopyCodeEnabled', 'saveAutoCopyCode', 'autoCopyCode', 'autoCopyCodeToggle', 'autoCopyCodeLabel'],
];
const KEYS_ONLY = TOGGLES.map(([key]) => [key]);
const otherOf = (key) => TOGGLES.find(([k]) => k !== key);
const CLIPBOARD_PERMISSIONS = ['clipboardWrite', 'offscreen'];

beforeAll(() => {
    evalPopupScript('utils/clipboard-permission.js');
    evalPopupScript('popup/popup.settings-view.js');
    evalPopupScript('popup/popup.toggles.js');
    evalPopupScript('popup/popup.live-sync.js');
    for (const [name, fn] of [['DSSClipboardPermission', 'requestClipboardPermission'], ['__DS_PopupSettingsView', 'applySettingsToDom'], ['__DS_PopupToggles', 'createToggleManager'], ['__DS_PopupLiveSync', 'createLiveSyncListener']]) {
        if (typeof window[name]?.[fn] !== 'function') throw new Error(`${fn} was not exposed on window.${name}`);
    }
});

async function readRawKey(area, key) {
    return (await chrome.storage[area].get(key))[key];
}

function requireSetter(setter) {
    expect(typeof StorageManager[setter], `StorageManager.${setter} is not a function`).toBe('function');
    return StorageManager[setter].bind(StorageManager);
}

function findFeaturesCard(doc) {
    const title = [...doc.querySelectorAll('.card-title')].find((el) => el.textContent.trim() === 'Features');
    if (!title) throw new Error('could not locate the Features card in popup.html');
    return title.closest('.card');
}

/** Real popup DOM: every element with an id from popup.html, keyed by id, plus the websearch radio group. */
function buildPopupDom() {
    mountPopupHtml();
    const dom = {};
    document.querySelectorAll('[id]').forEach((el) => { dom[el.id] = el; });
    dom.websearchRadios = [...document.querySelectorAll('input[name="websearchToggle"]')];
    return dom;
}

function requireCheckbox(dom, id) {
    expect(dom[id], `#${id} missing from popup.html`).toBeDefined();
    return dom[id];
}

// ── 1. Storage schema, setters, getSettings, restore ──

describe('storage - schema and defaults (U6-05)', () => {
    it.each(KEYS_ONLY)('"%s" is a StorageManager.KEYS value and defaults to false', (key) => {
        expect(Object.values(StorageManager.KEYS), `no KEYS entry has the value ${key}`).toContain(key);
        expect(StorageManager.DEFAULTS).toHaveProperty(key, false);
    });

    // vitest.setup.js evaluates storage-manager.keys.js before any test runs, so the assertion above never observes a change to the DEFAULTS literals under mutation testing; this one evaluates the file inside the test.
    it.each(KEYS_ONLY)('"%s" defaults to false in a freshly evaluated utils/storage-manager.keys.js', (key) => {
        const root = {};
        new Function('globalThis', 'module', readProjectFile('utils/storage-manager.keys.js'))(root, undefined);
        expect(root.__DS_StorageManager_keys?.DEFAULTS, 'keys bundle published on the given global').toBeTypeOf('object');
        expect(root.__DS_StorageManager_keys.DEFAULTS).toHaveProperty(key, false);
    });

    it('fresh install: getSettings() exposes autoCopyReply=false and autoCopyCode=false', async () => {
        const settings = await StorageManager.getSettings();
        expect(settings).toHaveProperty('autoCopyReply', false);
        expect(settings).toHaveProperty('autoCopyCode', false);
    });
});

describe('storage - setters persist to both sync and local (synced settings)', () => {
    it.each(TOGGLES)('%s: %s(true) then (false) stores each value in sync and local, and getSettings().%s follows', async (key, setter, field) => {
        const save = requireSetter(setter);
        for (const value of [true, false]) {
            await save(value);
            expect(await readRawKey('sync', key), `sync ${key} after ${setter}(${value})`).toBe(value);
            expect(await readRawKey('local', key), `local ${key} after ${setter}(${value})`).toBe(value);
            expect((await StorageManager.getSettings())[field], `getSettings().${field} after ${setter}(${value})`).toBe(value);
        }
    });

    it.each(TOGGLES)('%s: saving it leaves the other auto-copy setting false (independent keys)', async (key, setter, field) => {
        const save = requireSetter(setter);
        const [otherKey, , otherField] = otherOf(key);
        await save(true);
        const settings = await StorageManager.getSettings();
        expect(settings[field]).toBe(true);
        expect(settings[otherField], `${otherField} after saving ${field}`).toBe(false);
        expect(await readRawKey('local', otherKey), `raw ${otherKey}`).toBeUndefined();
    });
});

describe('storage - restoreSettings from a backup', () => {
    it.each(TOGGLES)('%s (setter %s, backup field %s): a backup with the field true restores true (stored key and getSettings())', async (key, _setter, field) => {
        await StorageManager.restoreSettings({ [field]: true }, false);
        expect(await readRawKey('local', key)).toBe(true);
        expect((await StorageManager.getSettings())[field]).toBe(true);
    });

    it.each(TOGGLES)('%s: an explicit false in the backup overwrites a current true', async (key, _setter, field) => {
        await StorageManager._set({ [key]: true });
        await StorageManager.restoreSettings({ [field]: false }, false);
        expect(await readRawKey('local', key)).toBe(false);
        expect((await StorageManager.getSettings())[field]).toBe(false);
    });

    it('a backup lacking the fields leaves current true values untouched', async () => {
        await StorageManager._set({ isAutoCopyReplyEnabled: true, isAutoCopyCodeEnabled: true });
        await StorageManager.restoreSettings({ hideThinking: true }, false);
        const settings = await StorageManager.getSettings();
        expect([settings.autoCopyReply, settings.autoCopyCode]).toEqual([true, true]);
    });

    it('mergePresetsOnly=true does not restore them', async () => {
        await StorageManager.restoreSettings({ autoCopyReply: true, autoCopyCode: true }, true);
        const settings = await StorageManager.getSettings();
        expect([settings.autoCopyReply, settings.autoCopyCode]).toEqual([false, false]);
    });
});

// ── 2. popup.html markup and i18n ──

describe('popup.html - Features card checkboxes (D-05)', () => {
    it.each(TOGGLES)('key %s (setter %s, field %s): the Features card holds checkbox #%s labelled data-i18n="%s"', (_key, _setter, _field, id, i18nKey) => {
        const card = findFeaturesCard(parsePopupHtml());
        const input = card.querySelector(`#${id}`);
        expect(input, `#${id} missing from the Features card`).not.toBeNull();
        expect(input.tagName).toBe('INPUT');
        expect(input.type).toBe('checkbox');
        const label = card.querySelector(`label[for="${id}"]`);
        expect(label, `label[for=${id}] missing from the Features card`).not.toBeNull();
        expect(label.getAttribute('data-i18n')).toBe(i18nKey);
    });

});

describe('i18n - label keys', () => {
    it.each([
        ['zhTW', () => globalThis.__DS_I18N_Locales_zhTW],
        ['en', () => globalThis.__DS_I18N_Locales_en],
    ])('%s defines non-empty, distinct autoCopyReplyLabel and autoCopyCodeLabel', (name, get) => {
        const dict = get();
        expect(dict, `locale ${name} not loaded`).toBeTruthy();
        for (const key of ['autoCopyReplyLabel', 'autoCopyCodeLabel']) {
            expect(typeof dict[key], `${name}.${key}`).toBe('string');
            expect(dict[key].trim().length, `${name}.${key}`).toBeGreaterThan(0);
        }
        expect(dict.autoCopyReplyLabel, `${name}: the two labels must differ`).not.toBe(dict.autoCopyCodeLabel);
    });
});

// ── 3. Popup behavior ──

describe('applySettingsToDom - reflects stored values', () => {
    it.each(TOGGLES)('%s: a value saved through %s shows on the checkbox, the other checkbox keeps its own value', async (key, setter, _field, id) => {
        const save = requireSetter(setter);
        const [, , , otherId] = otherOf(key);
        for (const value of [true, false]) {
            await save(value);
            const dom = buildPopupDom();
            const box = requireCheckbox(dom, id);
            const other = requireCheckbox(dom, otherId);
            box.checked = !value;
            other.checked = true;
            window.__DS_PopupSettingsView.applySettingsToDom(dom, await StorageManager.getSettings());
            expect(box.checked, `#${id} after saving ${value}`).toBe(value);
            expect(other.checked, `#${otherId} (never saved, default false)`).toBe(false);
        }
    });
});

// chrome.permissions is absent from test/setup/vitest.setup.js; each test that changes a checkbox installs its own double and afterEach restores the absent state.
let hadPermissions;
let originalPermissions;
const removeAfterTest = [];
beforeEach(() => {
    hadPermissions = 'permissions' in chrome;
    originalPermissions = chrome.permissions;
});
afterEach(() => {
    removeAfterTest.splice(0).forEach((remove) => remove());
    if (hadPermissions) chrome.permissions = originalPermissions;
    else delete chrome.permissions;
    vi.useRealTimers();
});

/** Installs a chrome.permissions double whose contains / request are vi.fn implementations; the recorded calls are the only permission evidence the spec asserts on. */
function installPermissions({ contains, request }) {
    chrome.permissions = { contains: vi.fn(contains), request: vi.fn(request) };
    return chrome.permissions;
}

const grantAll = () => installPermissions({ contains: async () => true, request: async () => true });

function buildToggleManager(overrides = {}) {
    return window.__DS_PopupToggles.createToggleManager({
        StorageManager,
        DSSClipboardPermission: globalThis.DSSClipboardPermission,
        refreshSyncStatus: vi.fn(async () => {}),
        showSaveStatus: vi.fn(),
        applyMasterSwitchUI: vi.fn(),
        getPresets: () => [],
        setPresets: () => {},
        getActivePresetId: () => '',
        setActivePresetId: () => {},
        ...overrides,
    });
}

// Storage chain settles on chained setTimeout(0) turns; drain it in virtual time (same helper as popup-auto-click-toggles.spec.js).
async function fireChangeAndSettle(el) {
    vi.useFakeTimers();
    el.dispatchEvent(new Event('change'));
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
}

/** Records every value of `key` written to chrome.storage (local and sync) from now on, so a transient true is visible even when a later write hides it. */
function recordWritesOf(key) {
    const writes = [];
    const listener = (changes, area) => { if (key in changes) writes.push(`${area}:${changes[key].newValue}`); };
    chrome.storage.onChanged.addListener(listener);
    removeAfterTest.push(() => chrome.storage.onChanged.removeListener(listener));
    return writes;
}

/** The user checks or unchecks the box: the browser flips it and fires change; storage and permission promises settle in virtual time. */
async function userSets(box, checked) {
    box.checked = checked;
    await fireChangeAndSettle(box);
}

describe('popup.toggles.js - checking a box with the clipboard permission already granted (U6-14)', () => {
    it.each(TOGGLES)('%s: the box stays checked, the key is saved true in local and sync, and no permission prompt is shown', async (key, _setter, _field, id) => {
        const permissions = grantAll();
        const dom = buildPopupDom();
        const box = requireCheckbox(dom, id);
        buildToggleManager().bindToggles(dom);

        await userSets(box, true);

        expect(permissions.contains, 'the popup checks the clipboard permission before saving').toHaveBeenCalledTimes(1);
        expect([...permissions.contains.mock.calls[0][0].permissions].sort(), 'contains is asked about clipboardWrite and offscreen together').toEqual(CLIPBOARD_PERMISSIONS);
        expect(permissions.request, 'no prompt when the permission already exists').not.toHaveBeenCalled();
        expect(box.checked, `#${id} stays checked`).toBe(true);
        expect(await readRawKey('local', key), `local ${key}`).toBe(true);
        expect(await readRawKey('sync', key), `sync ${key}`).toBe(true);
    });
});

describe('popup.toggles.js - checking a box with the clipboard permission absent and granted on request (U6-14)', () => {
    it.each(TOGGLES)('%s: request receives exactly clipboardWrite and offscreen, the box stays checked, the key is saved true', async (key, _setter, _field, id) => {
        const permissions = installPermissions({ contains: async () => false, request: async () => true });
        const dom = buildPopupDom();
        const box = requireCheckbox(dom, id);
        buildToggleManager().bindToggles(dom);

        await userSets(box, true);

        expect(permissions.request, 'one permission prompt').toHaveBeenCalledTimes(1);
        const [requested] = permissions.request.mock.calls[0];
        expect([...requested.permissions].sort(), 'both optional permissions are requested together').toEqual(CLIPBOARD_PERMISSIONS);
        expect(requested.origins ?? [], 'no host origins are requested').toEqual([]);
        expect(box.checked, `#${id} stays checked`).toBe(true);
        expect(await readRawKey('local', key), `local ${key}`).toBe(true);
        expect(await readRawKey('sync', key), `sync ${key}`).toBe(true);
    });
});

describe('popup.toggles.js - refusing or failing the clipboard permission reverts the box (U6-14)', () => {
    beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
    afterEach(() => vi.restoreAllMocks());

    const throwAsync = (msg) => async () => { throw new Error(msg); };
    const throwSync = (msg) => () => { throw new Error(msg); };
    const FAILURES = [
        ['the user refuses the request', { contains: async () => false, request: async () => false }],
        ['request resolves undefined', { contains: async () => false, request: async () => undefined }],
        ['contains rejects', { contains: throwAsync('contains failed'), request: throwAsync('request failed') }],
        ['contains throws synchronously', { contains: throwSync('contains threw'), request: throwSync('request threw') }],
        ['contains false and request rejects', { contains: async () => false, request: throwAsync('request failed') }],
        ['contains false and request throws synchronously', { contains: async () => false, request: throwSync('request threw') }],
    ];
    const CASES = TOGGLES.flatMap(([key, , , id]) => FAILURES.map(([label, impl]) => [key, label, id, impl]));

    it.each(CASES)('%s, %s: #%s becomes unchecked and true is never stored', async (key, _label, id, impl) => {
        installPermissions(impl);
        const dom = buildPopupDom();
        const box = requireCheckbox(dom, id);
        buildToggleManager().bindToggles(dom);
        const writes = recordWritesOf(key);

        await userSets(box, true);

        expect(box.checked, `#${id} reverts to unchecked`).toBe(false);
        expect([undefined, false], `local ${key} stays absent or false`).toContain(await readRawKey('local', key));
        expect([undefined, false], `sync ${key} stays absent or false`).toContain(await readRawKey('sync', key));
        expect(writes.filter((w) => w.endsWith(':true')), `true is never written to ${key}, not even transiently`).toEqual([]);
    });
});

describe('popup.toggles.js - unchecking a box (U6-14)', () => {
    it.each(TOGGLES)('%s (setter %s): unchecking saves false in local and sync without touching chrome.permissions', async (key, setter, _field, id) => {
        await requireSetter(setter)(true);
        const permissions = grantAll();
        const dom = buildPopupDom();
        const box = requireCheckbox(dom, id);
        box.checked = true;
        buildToggleManager().bindToggles(dom);

        await userSets(box, false);

        expect(await readRawKey('local', key), `local ${key}`).toBe(false);
        expect(await readRawKey('sync', key), `sync ${key}`).toBe(false);
        expect(box.checked, `#${id} stays unchecked`).toBe(false);
        expect(permissions.contains, 'unchecking never checks a permission').not.toHaveBeenCalled();
        expect(permissions.request, 'unchecking never requests a permission').not.toHaveBeenCalled();
    });
});

describe('applySettingsToDom - a dom lacking one auto-copy checkbox (missing fields are skipped)', () => {
    it.each(TOGGLES)('%s (setter %s, field %s): #%s is applied when the other auto-copy checkbox is absent', async (key, _setter, field, id) => {
        const [, , otherField, otherId] = otherOf(key);
        const dom = buildPopupDom();
        delete dom[otherId];
        const box = requireCheckbox(dom, id);
        box.checked = false;
        const settings = { ...(await StorageManager.getSettings()), [field]: true, [otherField]: true };

        expect(() => window.__DS_PopupSettingsView.applySettingsToDom(dom, settings)).not.toThrow();
        expect(box.checked, `#${id}`).toBe(true);
    });
});

describe('popup.toggles.js - checkbox change shows the save status after saving', () => {
    it.each(TOGGLES)('%s (setter %s, field %s): changing #%s shows the save status once, with the new value already stored', async (key, _setter, _field, id) => {
        grantAll();
        const dom = buildPopupDom();
        const box = requireCheckbox(dom, id);
        expect(chrome.storage.local._data, 'precondition: the in-memory storage double exposes its data').toBeTypeOf('object');
        const storedWhenShown = [];
        buildToggleManager({ showSaveStatus: () => storedWhenShown.push(chrome.storage.local._data[key]) }).bindToggles(dom);

        box.checked = true;
        await fireChangeAndSettle(box);

        expect(storedWhenShown, 'one save-status call, made after the value was stored').toEqual([true]);
    });
});

describe('applyMasterSwitchUI - master switch disables both checkboxes', () => {
    it('isEnabled=false disables both (like hideThinkingToggle); isEnabled=true re-enables them', () => {
        const dom = buildPopupDom();
        const boxes = TOGGLES.map(([, , , id]) => requireCheckbox(dom, id));
        const { applyMasterSwitchUI } = buildApplyMasterSwitchUI();

        applyMasterSwitchUI(false);
        expect(dom.hideThinkingToggle.disabled, 'precondition: an existing sub-control is disabled').toBe(true);
        expect(boxes.map((b) => b.disabled), 'master off').toEqual([true, true]);

        applyMasterSwitchUI(true);
        expect(boxes.map((b) => b.disabled), 'master on').toEqual([false, false]);
    });
});

describe('live sync - a storage change updates its checkbox', () => {
    afterEach(() => vi.restoreAllMocks());

    /** Starts the real live-sync listener over the real popup DOM and returns the raw onChanged callback it registered (pattern of popup-live-sync.spec.js). */
    function startLiveSync(dom) {
        let captured;
        vi.spyOn(chrome.storage.onChanged, 'addListener').mockImplementation((fn) => { captured = fn; });
        window.__DS_PopupLiveSync.createLiveSyncListener({
            StorageManager,
            dom,
            applyMasterSwitchUI: vi.fn(),
            updateEditPresetBtnState: vi.fn(),
            getPresets: () => [],
            setPresets: () => {},
            getActivePresetId: () => '',
            setActivePresetId: () => {},
            getChatPresetMap: () => ({}),
            setChatPresetMap: () => {},
            getCustomSelect: () => ({ render: vi.fn() }),
        }).start();
        expect(captured, 'precondition: live sync registered an onChanged listener').toBeTypeOf('function');
        return captured;
    }

    it.each(TOGGLES.flatMap((t) => [[...t, true], [...t, false]]))('key %s (setter %s, field %s): a storage change updates #%s (label %s) to %s, not the other checkbox', (key, _setter, _field, id, _i18n, value) => {
        const dom = buildPopupDom();
        const box = requireCheckbox(dom, id);
        const [, , , otherId] = otherOf(key);
        const other = requireCheckbox(dom, otherId);
        box.checked = !value;
        other.checked = !value;
        const listener = startLiveSync(dom);

        listener({ [key]: { oldValue: !value, newValue: value } }, 'sync');

        expect(box.checked, `#${id}`).toBe(value);
        expect(other.checked, `#${otherId} untouched (no cross-wiring)`).toBe(!value);
    });

    it.each(TOGGLES)('%s: removal of the key (newValue undefined) unchecks the checkbox', (key, _setter, _field, id) => {
        const dom = buildPopupDom();
        const box = requireCheckbox(dom, id);
        box.checked = true;
        const listener = startLiveSync(dom);

        listener({ [key]: { oldValue: true, newValue: undefined } }, 'local');

        expect(box.checked).toBe(false);
    });
});
