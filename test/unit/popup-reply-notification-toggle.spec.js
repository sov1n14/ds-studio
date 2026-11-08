/**
 * Reply-notification toggle - popup Features card on/off button, optional notifications permission, live sync, master-switch gating, i18n (red phase: popup side not implemented yet).
 *
 * Requirement (user, verbatim): "(b) Configuration: add a toggle in Features in the same form as 聯網搜索 (not a checkbox, but an on/off button). (c) Permission check: when clicking to turn it on, check whether notification permission exists; if not, request notification permission."
 * Decisions: the notifications permission is optional, requested when the toggle turns on, and the toggle reverts on refusal; unit tests mock chrome.permissions.
 *
 * Contract this spec fixes:
 *   1. popup.html Features card holds radios input[name="replyNotificationToggle"] valued on / off, inside .websearch-options > label.segmented-option like the websearch pair, with a label data-i18n="replyNotificationLabel" in the same input-group; popup.html loads utils/notification-permission.js before popup.js.
 *   2. applySettingsToDom(dom, settings) checks the on radio for settings.replyNotification === true and the off radio otherwise; dom.replyNotificationRadios holds the two radios.
 *   3-6. createToggleManager(ctx).bindToggles(dom): selecting on asks DSSNotificationPermission.hasNotificationPermission(), then requestNotificationPermission() only when absent; granted -> StorageManager stores local isReplyNotificationEnabled true and shows the save status; refused / failed -> the off radio is checked again and nothing is stored.
 *   7. Selecting off stores false without any permission request.
 *   8. popup.live-sync.js mirrors a storage change of isReplyNotificationEnabled onto dom.replyNotificationRadios.
 *   9. applyMasterSwitchUI(false) disables both radios, true re-enables them.
 *   10. zh-TW and en define non-empty replyNotificationLabel, replyNotificationTitle, replyNotificationBody.
 *
 * Trust boundary: only chrome.permissions is mocked; the real utils/notification-permission.js wrapper (globalThis.DSSNotificationPermission) sits between the popup and the mock, loaded the way popup.html loads it. The wrapper is also passed in ctx as DSSNotificationPermission, the same way StorageManager is passed, so either access route works. Storage assertions read the raw stored key from the in-memory chrome.storage double, never a spy.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';
import { evalPopupScript, readProjectFile } from '../helpers/popup-script-loader.js';
import { parsePopupHtml, mountPopupHtml, buildApplyMasterSwitchUI } from '../helpers/popup-master-switch-harness.js';

const KEY = 'isReplyNotificationEnabled';
const RADIO_NAME = 'replyNotificationToggle';
const RADIO_SELECTOR = 'input[type="radio"][name="' + RADIO_NAME + '"]';
const NOTIFICATIONS_PERMISSION_SET = { permissions: ['notifications'] };

beforeAll(() => {
    evalPopupScript('utils/notification-permission.js');
    evalPopupScript('popup/popup.settings-view.js');
    evalPopupScript('popup/popup.toggles.js');
    evalPopupScript('popup/popup.live-sync.js');
    const exposed = [
        ['DSSNotificationPermission', 'requestNotificationPermission'],
        ['__DS_PopupSettingsView', 'applySettingsToDom'],
        ['__DS_PopupToggles', 'createToggleManager'],
        ['__DS_PopupLiveSync', 'createLiveSyncListener'],
    ];
    for (const [name, fn] of exposed) {
        if (typeof globalThis[name]?.[fn] !== 'function') throw new Error(fn + ' was not exposed on globalThis.' + name);
    }
});

// chrome.permissions is absent from test/setup/vitest.setup.js; each test installs its own double and afterEach restores the absent state.
let hadPermissions;
let originalPermissions;
const removeAfterTest = [];
beforeEach(() => {
    hadPermissions = 'permissions' in chrome;
    originalPermissions = chrome.permissions;
    vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
    removeAfterTest.splice(0).forEach((remove) => remove());
    if (hadPermissions) chrome.permissions = originalPermissions;
    else delete chrome.permissions;
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/** Installs a chrome.permissions double; contains / request are vi.fn implementations. */
function installPermissions({ contains, request }) {
    chrome.permissions = { contains: vi.fn(contains), request: vi.fn(request) };
    return chrome.permissions;
}

async function readLocal(key) {
    return (await chrome.storage.local.get(key))[key];
}

function findFeaturesCard(doc) {
    const title = [...doc.querySelectorAll('.card-title')].find((el) => el.textContent.trim() === 'Features');
    if (!title) throw new Error('could not locate the Features card in popup.html');
    return title.closest('.card');
}

/** Real popup DOM: every element with an id from popup.html keyed by id, plus both radio groups. */
function buildPopupDom() {
    mountPopupHtml();
    return buildMountedDom();
}

/** Same element map as buildPopupDom over the popup DOM already mounted in the document. */
function buildMountedDom() {
    const dom = {};
    document.querySelectorAll('[id]').forEach((el) => { dom[el.id] = el; });
    dom.websearchRadios = [...document.querySelectorAll('input[name="websearchToggle"]')];
    dom.replyNotificationRadios = [...document.querySelectorAll(RADIO_SELECTOR)];
    return dom;
}

/** The on / off radios of the reply-notification group; fails with a markup message when popup.html lacks them. */
function requireRadios(dom) {
    const radios = dom.replyNotificationRadios;
    const on = radios.find((r) => r.value === 'on');
    const off = radios.find((r) => r.value === 'off');
    expect(on, 'popup.html has no ' + RADIO_SELECTOR + ' with value "on"').toBeTruthy();
    expect(off, 'popup.html has no ' + RADIO_SELECTOR + ' with value "off"').toBeTruthy();
    return { on, off };
}

// ── 1. popup.html markup and loader ──

describe('popup.html - reply-notification on/off button in the Features card', () => {
    it('holds exactly two radios named replyNotificationToggle, valued on and off', () => {
        const card = findFeaturesCard(parsePopupHtml());
        const values = [...card.querySelectorAll(RADIO_SELECTOR)].map((r) => r.value).sort();
        expect(values, 'radios ' + RADIO_SELECTOR + ' in the Features card').toEqual(['off', 'on']);
    });

    it('renders each radio inside label.segmented-option within .websearch-options, the same form as the websearch pair', () => {
        const card = findFeaturesCard(parsePopupHtml());
        const radios = [...card.querySelectorAll(RADIO_SELECTOR)];
        expect(radios, 'reply-notification radios in the Features card').toHaveLength(2);
        for (const radio of radios) {
            const option = radio.parentElement;
            expect(option?.tagName, 'radio ' + radio.value + ' parent').toBe('LABEL');
            expect(option.classList.contains('segmented-option'), 'radio ' + radio.value + ' parent has class segmented-option').toBe(true);
            expect(option.parentElement?.classList.contains('websearch-options'), 'radio ' + radio.value + ' option sits in .websearch-options').toBe(true);
        }
        expect(radios[0].closest('.websearch-options'), 'both radios share one options container').toBe(radios[1].closest('.websearch-options'));
        const websearchRadio = card.querySelector('input[name="websearchToggle"]');
        expect(radios[0].closest('.websearch-options'), 'its own container, not the websearch one').not.toBe(websearchRadio?.closest('.websearch-options'));
    });

    it('labels the group with data-i18n="replyNotificationLabel" in the same input-group', () => {
        const card = findFeaturesCard(parsePopupHtml());
        const group = card.querySelector(RADIO_SELECTOR)?.closest('.input-group');
        expect(group, 'reply-notification radios inside an .input-group').toBeTruthy();
        expect(group.querySelector('[data-i18n="replyNotificationLabel"]'), 'label with data-i18n="replyNotificationLabel"').not.toBeNull();
    });

    it('loads utils/notification-permission.js before popup.js', () => {
        const srcs = [...readProjectFile('popup/popup.html').matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
        const wrapperIdx = srcs.indexOf('../utils/notification-permission.js');
        const popupIdx = srcs.indexOf('popup.js');
        expect(popupIdx, 'precondition: popup.html loads popup.js').toBeGreaterThan(-1);
        expect(wrapperIdx, 'popup.html has no <script src="../utils/notification-permission.js">').toBeGreaterThan(-1);
        expect(wrapperIdx, 'the wrapper must load before popup.js').toBeLessThan(popupIdx);
    });
});

// ── 10. i18n ──

describe('i18n - reply-notification keys', () => {
    it.each([
        ['zhTW', () => globalThis.__DS_I18N_Locales_zhTW],
        ['en', () => globalThis.__DS_I18N_Locales_en],
    ])('%s defines non-empty replyNotificationLabel, replyNotificationTitle and replyNotificationBody', (name, get) => {
        const dict = get();
        expect(dict, 'locale ' + name + ' not loaded').toBeTruthy();
        for (const key of ['replyNotificationLabel', 'replyNotificationTitle', 'replyNotificationBody']) {
            expect(typeof dict[key], name + '.' + key).toBe('string');
            expect(dict[key].trim().length, name + '.' + key).toBeGreaterThan(0);
        }
    });
});

// ── 2. applySettingsToDom ──

describe('applySettingsToDom - reflects the stored reply-notification value', () => {
    it.each([
        { stored: true, expected: 'on' },
        { stored: false, expected: 'off' },
        { stored: undefined, expected: 'off' },
    ])('stored $stored checks the $expected radio', async ({ stored, expected }) => {
        if (stored !== undefined) await StorageManager.saveReplyNotification(stored);
        const dom = buildPopupDom();
        const { on, off } = requireRadios(dom);
        on.checked = expected === 'off';
        off.checked = expected === 'on';

        globalThis.__DS_PopupSettingsView.applySettingsToDom(dom, await StorageManager.getSettings());

        expect({ on: on.checked, off: off.checked }).toEqual({ on: expected === 'on', off: expected === 'off' });
    });

    it('a settings object without the replyNotification field checks the off radio', async () => {
        const dom = buildPopupDom();
        const { on, off } = requireRadios(dom);
        on.checked = true;
        const settings = { ...(await StorageManager.getSettings()) };
        delete settings.replyNotification;

        globalThis.__DS_PopupSettingsView.applySettingsToDom(dom, settings);

        expect({ on: on.checked, off: off.checked }).toEqual({ on: false, off: true });
    });
});

// ── 3-7. Change handler and permission flow ──

/**
 * Real popup DOM with the toggle manager bound; `initial` is the radio checked before the user acts, and 'on' also seeds the stored value true.
 * showSaveStatus records the stored value at the moment it is called; localWrites records every value of the key written to chrome.storage.local after setup, so a transient write is visible even when a later write hides it.
 * `permissionRoute` says where the real permission wrapper is reachable when the manager is created: 'ctx+global' (ctx.DSSNotificationPermission and globalThis, as popup.js wires it), 'ctx' (globalThis lacks it), 'global' (ctx omits it) or 'none' (neither); afterEach restores the global.
 * `markupOrder` 'off-first' moves the off option before the on option in the mounted markup, so the radio list (document order, as popup.js builds it) starts with off.
 */
async function setupToggle({ initial, permissionRoute = 'ctx+global', markupOrder = 'as-shipped' }) {
    if (initial === 'on') await StorageManager.saveReplyNotification(true);
    if (markupOrder === 'off-first') {
        mountPopupHtml();
        const [onOption, offOption] = ['on', 'off'].map((v) => document.querySelector(RADIO_SELECTOR + '[value="' + v + '"]').parentElement);
        onOption.parentElement.insertBefore(offOption, onOption);
    }
    const dom = markupOrder === 'off-first' ? buildMountedDom() : buildPopupDom();
    const radios = requireRadios(dom);
    if (markupOrder === 'off-first') expect(dom.replyNotificationRadios.map((r) => r.value), 'precondition: the radio list starts with off').toEqual(['off', 'on']);
    radios[initial].checked = true;
    const wrapper = globalThis.DSSNotificationPermission;
    expect(wrapper?.hasNotificationPermission, 'precondition: the real permission wrapper is loaded').toBeTypeOf('function');
    if (permissionRoute === 'ctx' || permissionRoute === 'none') {
        delete globalThis.DSSNotificationPermission;
        removeAfterTest.push(() => { globalThis.DSSNotificationPermission = wrapper; });
    }
    const permissionInCtx = permissionRoute === 'ctx+global' || permissionRoute === 'ctx' ? { DSSNotificationPermission: wrapper } : {};
    const storedWhenSaveShown = [];
    const localWrites = [];
    const recordWrite = (changes, area) => { if (area === 'local' && KEY in changes) localWrites.push(changes[KEY].newValue); };
    chrome.storage.onChanged.addListener(recordWrite);
    removeAfterTest.push(() => chrome.storage.onChanged.removeListener(recordWrite));
    globalThis.__DS_PopupToggles.createToggleManager({
        StorageManager,
        ...permissionInCtx,
        refreshSyncStatus: vi.fn(async () => {}),
        showSaveStatus: () => storedWhenSaveShown.push(chrome.storage.local._data[KEY]),
        applyMasterSwitchUI: vi.fn(),
        getPresets: () => [],
        setPresets: () => {},
        getActivePresetId: () => '',
        setActivePresetId: () => {},
    }).bindToggles(dom);
    return { ...radios, storedWhenSaveShown, localWrites };
}

/** The user clicks a radio: the browser checks it (unchecking its sibling) and fires change; the storage chain and permission promises then settle in virtual time. */
async function userSelects(radio) {
    vi.useFakeTimers();
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
}

describe('turning on - permission already granted', () => {
    it('stores true, skips the request, keeps on checked and shows the save status after storing', async () => {
        const permissions = installPermissions({ contains: async () => true, request: async () => true });
        const { on, off, storedWhenSaveShown } = await setupToggle({ initial: 'off' });

        await userSelects(on);

        expect(await readLocal(KEY), 'local ' + KEY).toBe(true);
        expect(permissions.contains, 'the permission check happens at the trust boundary').toHaveBeenCalledWith(NOTIFICATIONS_PERMISSION_SET);
        expect(permissions.request, 'no request when the permission already exists').not.toHaveBeenCalled();
        expect({ on: on.checked, off: off.checked }).toEqual({ on: true, off: false });
        expect(storedWhenSaveShown, 'one save-status call, made after true was stored').toEqual([true]);
        expect(await readLocal(StorageManager.KEYS.WEBSEARCH_TOGGLE), 'the websearch setting is untouched').toBeUndefined();
    });
});

describe('turning on - permission absent', () => {
    it('requests the notifications permission and, when granted, stores true with on checked', async () => {
        const permissions = installPermissions({ contains: async () => false, request: async () => true });
        const { on, off, storedWhenSaveShown } = await setupToggle({ initial: 'off' });

        await userSelects(on);

        expect(permissions.request).toHaveBeenCalledWith(NOTIFICATIONS_PERMISSION_SET);
        expect(await readLocal(KEY), 'local ' + KEY).toBe(true);
        expect({ on: on.checked, off: off.checked }).toEqual({ on: true, off: false });
        expect(storedWhenSaveShown).toEqual([true]);
    });

    it('reverts to off and stores nothing when the user refuses the request', async () => {
        const permissions = installPermissions({ contains: async () => false, request: async () => false });
        const { on, off, storedWhenSaveShown, localWrites } = await setupToggle({ initial: 'off' });

        await userSelects(on);

        expect(permissions.request, 'precondition: the permission was requested').toHaveBeenCalledWith(NOTIFICATIONS_PERMISSION_SET);
        expect({ on: on.checked, off: off.checked }, 'the toggle reverts to off').toEqual({ on: false, off: true });
        expect([undefined, false], 'the stored value stays false or absent on refusal').toContain(await readLocal(KEY));
        expect(localWrites, 'true is never written, not even transiently').not.toContain(true);
        expect(storedWhenSaveShown, 'no save status when nothing was saved').toEqual([]);
    });
});

describe('turning on - permission API failures count as refusal', () => {
    it.each([
        ['contains rejects and request rejects', { contains: async () => { throw new Error('contains failed'); }, request: async () => { throw new Error('request failed'); } }],
        ['contains false and request throws synchronously', { contains: async () => false, request: () => { throw new Error('request threw'); } }],
        ['contains false and request rejects', { contains: async () => false, request: async () => { throw new Error('request failed'); } }],
    ])('%s: reverts to off and stores nothing', async (_label, impl) => {
        installPermissions(impl);
        const { on, off, storedWhenSaveShown, localWrites } = await setupToggle({ initial: 'off' });

        await userSelects(on);

        expect({ on: on.checked, off: off.checked }, 'the toggle reverts to off').toEqual({ on: false, off: true });
        expect([undefined, false], 'the stored value stays false or absent').toContain(await readLocal(KEY));
        expect(localWrites, 'true is never written, not even transiently').not.toContain(true);
        expect(storedWhenSaveShown, 'no save status when nothing was saved').toEqual([]);
    });
});

describe('turning off', () => {
    it('stores false without requesting any permission and shows the save status', async () => {
        const permissions = installPermissions({ contains: async () => true, request: async () => true });
        const { on, off, storedWhenSaveShown } = await setupToggle({ initial: 'on' });
        expect(await readLocal(KEY), 'precondition: stored true').toBe(true);

        await userSelects(off);

        expect(await readLocal(KEY), 'local ' + KEY).toBe(false);
        expect(permissions.request, 'turning off never requests a permission').not.toHaveBeenCalled();
        expect({ on: on.checked, off: off.checked }).toEqual({ on: false, off: true });
        expect(storedWhenSaveShown).toEqual([false]);
    });
});

describe('turning on - where the permission wrapper is reachable', () => {
    it('with no permission wrapper reachable (neither ctx nor globalThis), reverts to off, stores nothing and raises no error', async () => {
        const permissions = installPermissions({ contains: async () => true, request: async () => true });
        const rejections = [];
        const onRejection = (reason) => rejections.push(reason);
        process.on('unhandledRejection', onRejection);
        removeAfterTest.push(() => process.off('unhandledRejection', onRejection));
        const { on, off, storedWhenSaveShown, localWrites } = await setupToggle({ initial: 'off', permissionRoute: 'none' });

        await userSelects(on);
        await new Promise((resolve) => setImmediate(resolve));

        expect({ on: on.checked, off: off.checked }, 'a missing wrapper counts as no permission: the toggle reverts to off').toEqual({ on: false, off: true });
        expect(await readLocal(KEY), 'nothing is stored').toBeUndefined();
        expect(localWrites, 'true is never written, not even transiently').not.toContain(true);
        expect(storedWhenSaveShown, 'no save status when nothing was saved').toEqual([]);
        expect(rejections, 'the change handler does not reject').toEqual([]);
        expect(permissions.contains, 'without the wrapper the popup cannot reach the permission API').not.toHaveBeenCalled();
    });

    it.each([
        ['only ctx.DSSNotificationPermission (globalThis lacks it)', 'ctx'],
        ['only globalThis.DSSNotificationPermission (ctx omits it)', 'global'],
    ])('with %s, a granted permission stores true with on checked', async (_label, permissionRoute) => {
        installPermissions({ contains: async () => true, request: async () => true });
        const { on, off, storedWhenSaveShown } = await setupToggle({ initial: 'off', permissionRoute });

        await userSelects(on);

        expect(await readLocal(KEY), 'local ' + KEY).toBe(true);
        expect({ on: on.checked, off: off.checked }).toEqual({ on: true, off: false });
        expect(storedWhenSaveShown).toEqual([true]);
    });
});

describe('change events on a radio that is not checked', () => {
    it.each([
        { initial: 'off', target: 'on' },
        { initial: 'on', target: 'off' },
    ])('$initial checked, change fired on the unchecked $target radio: nothing is stored, no permission is checked, the radios stay as they were', async ({ initial, target }) => {
        const permissions = installPermissions({ contains: async () => true, request: async () => true });
        const radios = await setupToggle({ initial });
        const storedBefore = await readLocal(KEY);

        vi.useFakeTimers();
        radios[target].dispatchEvent(new Event('change', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(1000);
        vi.useRealTimers();

        expect(await readLocal(KEY), 'the stored value is unchanged').toBe(storedBefore);
        expect(radios.localWrites, 'no write of ' + KEY).toEqual([]);
        expect(radios.storedWhenSaveShown, 'no save status').toEqual([]);
        expect(permissions.contains, 'no permission check for an unchecked radio').not.toHaveBeenCalled();
        expect({ on: radios.on.checked, off: radios.off.checked }).toEqual({ on: initial === 'on', off: initial === 'off' });
    });
});

describe('turning on - refusal with the off option listed first in the markup', () => {
    it('reverts to off whatever order the markup lists the two options in', async () => {
        installPermissions({ contains: async () => false, request: async () => false });
        const { on, off, localWrites } = await setupToggle({ initial: 'off', markupOrder: 'off-first' });

        await userSelects(on);

        expect({ on: on.checked, off: off.checked }, 'the toggle reverts to off').toEqual({ on: false, off: true });
        expect(localWrites, 'true is never written').not.toContain(true);
    });
});

// ── 8. Live sync ──

describe('live sync - a storage change of isReplyNotificationEnabled updates the radios', () => {
    /** Starts the real live-sync listener over the real popup DOM and returns the raw onChanged callback it registered (pattern of popup-live-sync.spec.js). */
    function startLiveSync(dom) {
        let captured;
        vi.spyOn(chrome.storage.onChanged, 'addListener').mockImplementation((fn) => { captured = fn; });
        globalThis.__DS_PopupLiveSync.createLiveSyncListener({
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

    it.each([
        { from: 'off', newValue: true, expected: 'on' },
        { from: 'on', newValue: false, expected: 'off' },
        { from: 'on', newValue: undefined, expected: 'off' },
    ])('checked $from, newValue $newValue -> $expected checked; the websearch radios are untouched', ({ from, newValue, expected }) => {
        const dom = buildPopupDom();
        const { on, off } = requireRadios(dom);
        (from === 'on' ? on : off).checked = true;
        const websearchOff = dom.websearchRadios.find((r) => r.value === 'off');
        websearchOff.checked = true;
        const listener = startLiveSync(dom);

        listener({ [KEY]: { oldValue: from === 'on', newValue } }, 'local');

        expect({ on: on.checked, off: off.checked }).toEqual({ on: expected === 'on', off: expected === 'off' });
        expect(websearchOff.checked, 'websearch radios keep their state (no cross-wiring)').toBe(true);
    });

    it('a change when dom has no replyNotificationRadios list raises no error and still applies the keys handled after it', () => {
        const dom = buildPopupDom();
        delete dom.replyNotificationRadios;
        dom.showSystemTimeToggle.checked = false;
        const listener = startLiveSync(dom);

        expect(() => listener({
            [KEY]: { oldValue: false, newValue: true },
            [StorageManager.KEYS.SHOW_SYSTEM_TIME]: { oldValue: false, newValue: true },
        }, 'local')).not.toThrow();

        expect(dom.showSystemTimeToggle.checked, 'the show-system-time change in the same batch is applied').toBe(true);
    });
});

// ── 9. Master switch ──

describe('applyMasterSwitchUI - master switch gates the reply-notification radios', () => {
    it('isEnabled=false disables both radios like the websearch radios; isEnabled=true re-enables them', () => {
        mountPopupHtml();
        const radios = [...document.querySelectorAll(RADIO_SELECTOR)];
        const websearchRadios = [...document.querySelectorAll('input[name="websearchToggle"]')];
        expect(radios, 'popup.html must hold the two ' + RADIO_SELECTOR + ' radios').toHaveLength(2);
        const { applyMasterSwitchUI } = buildApplyMasterSwitchUI();

        applyMasterSwitchUI(false);
        expect(websearchRadios.map((r) => r.disabled), 'precondition: websearch radios disabled').toEqual([true, true]);
        expect(radios.map((r) => r.disabled), 'master off').toEqual([true, true]);

        applyMasterSwitchUI(true);
        expect(radios.map((r) => r.disabled), 'master on').toEqual([false, false]);
    });
});
