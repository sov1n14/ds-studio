/**
 * Popup Features card toggles - "Auto retry" (#autoRetryToggle, KEYS.AUTO_RETRY) and "Auto continue generating" (#autoContinueToggle, KEYS.AUTO_CONTINUE).
 *
 * Requirement contract (mirrors the existing hideThinking / preventAutoScroll toggle wiring):
 *   1. StorageManager.saveAutoRetry(bool) / saveAutoContinue(bool) persist; getSettings() exposes autoRetry / autoContinue, both false on a fresh install.
 *   2. popup.html Features card holds checkbox inputs #autoRetryToggle / #autoContinueToggle with labels data-i18n="autoRetryLabel" / "autoContinueLabel".
 *   3. applySettingsToDom(dom, settings) reflects the stored values onto the checkboxes.
 *   4. Changing a checkbox persists the new value (observed via getSettings(), not via a spy).
 *   5. applyMasterSwitchUI(false) disables both checkboxes; (true) re-enables them.
 *   6. Both locales define autoRetryLabel / autoContinueLabel as non-empty strings.
 *
 * popup.settings-view.js and popup.toggles.js are standalone classic-script factories, so they are eval()-loaded and run for real (pattern of popup-global-prompt-toggle.spec.js). applyMasterSwitchUI lives inside the popup.js DOMContentLoaded closure; it runs for real through test/helpers/popup-master-switch-harness.js. Live-sync coverage lives in popup-live-sync.spec.js.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';
import { evalPopupScript } from '../helpers/popup-script-loader.js';
import { parsePopupHtml, mountPopupHtml, buildApplyMasterSwitchUI } from '../helpers/popup-master-switch-harness.js';

const TOGGLES = [
    // [settings field, setter, element id, i18n key]
    ['autoRetry', 'saveAutoRetry', 'autoRetryToggle', 'autoRetryLabel'],
    ['autoContinue', 'saveAutoContinue', 'autoContinueToggle', 'autoContinueLabel'],
];

beforeAll(() => {
    evalPopupScript('popup/popup.settings-view.js');
    evalPopupScript('popup/popup.toggles.js');
    if (typeof window.__DS_PopupSettingsView?.applySettingsToDom !== 'function') {
        throw new Error('applySettingsToDom was not exposed on window.__DS_PopupSettingsView');
    }
    if (typeof window.__DS_PopupToggles?.createToggleManager !== 'function') {
        throw new Error('createToggleManager was not exposed on window.__DS_PopupToggles');
    }
});

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

function requireToggles(dom) {
    expect(dom.autoRetryToggle, '#autoRetryToggle missing from popup.html').toBeDefined();
    expect(dom.autoContinueToggle, '#autoContinueToggle missing from popup.html').toBeDefined();
}

// ── 1. StorageManager setters / getSettings ──

describe('StorageManager - autoRetry / autoContinue settings', () => {
    it('fresh install: getSettings() returns autoRetry=false and autoContinue=false', async () => {
        const settings = await StorageManager.getSettings();
        expect(settings.autoRetry).toBe(false);
        expect(settings.autoContinue).toBe(false);
    });

    it.each(TOGGLES)('%s: %s(true) persists and getSettings() returns true', async (field, setter) => {
        expect(typeof StorageManager[setter], `StorageManager.${setter} is not a function`).toBe('function');
        await StorageManager[setter](true);
        expect((await StorageManager.getSettings())[field]).toBe(true);
    });

    it.each(TOGGLES)('%s: %s(true) then (false) reads back false', async (field, setter) => {
        expect(typeof StorageManager[setter], `StorageManager.${setter} is not a function`).toBe('function');
        await StorageManager[setter](true);
        await StorageManager[setter](false);
        expect((await StorageManager.getSettings())[field]).toBe(false);
    });

    it('the two settings are independent (saving one leaves the other false)', async () => {
        expect(typeof StorageManager.saveAutoRetry, 'StorageManager.saveAutoRetry is not a function').toBe('function');
        await StorageManager.saveAutoRetry(true);
        const settings = await StorageManager.getSettings();
        expect(settings.autoRetry).toBe(true);
        expect(settings.autoContinue).toBe(false);
    });
});

// ── 2. popup.html markup ──

describe('popup.html - Features card markup', () => {
    it.each(TOGGLES)('%s: Features card holds checkbox with a data-i18n label', (_field, _setter, id, i18nKey) => {
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

// ── 3. applySettingsToDom ──

describe('applySettingsToDom - reflects stored values', () => {
    it.each([true, false])('sets both checkboxes to %s from settings', async (value) => {
        const dom = buildPopupDom();
        requireToggles(dom);
        dom.autoRetryToggle.checked = !value;
        dom.autoContinueToggle.checked = !value;

        const settings = { ...(await StorageManager.getSettings()), autoRetry: value, autoContinue: value };
        window.__DS_PopupSettingsView.applySettingsToDom(dom, settings);

        expect(dom.autoRetryToggle.checked).toBe(value);
        expect(dom.autoContinueToggle.checked).toBe(value);
    });

    it('sets each checkbox from its own field (no cross-wiring)', async () => {
        const dom = buildPopupDom();
        requireToggles(dom);
        const settings = { ...(await StorageManager.getSettings()), autoRetry: true, autoContinue: false };
        window.__DS_PopupSettingsView.applySettingsToDom(dom, settings);
        expect(dom.autoRetryToggle.checked).toBe(true);
        expect(dom.autoContinueToggle.checked).toBe(false);
    });
});

// ── 4. change handler persists ──

function buildToggleManager() {
    return window.__DS_PopupToggles.createToggleManager({
        StorageManager,
        refreshSyncStatus: vi.fn(async () => {}),
        showSaveStatus: vi.fn(),
        applyMasterSwitchUI: vi.fn(),
        getPresets: () => [],
        setPresets: () => {},
        getActivePresetId: () => '',
        setActivePresetId: () => {},
    });
}

// Storage chain settles on chained setTimeout(0) turns; drain it in virtual time (same helper as popup-global-prompt-toggle.spec.js).
async function fireChangeAndSettle(el) {
    vi.useFakeTimers();
    el.dispatchEvent(new Event('change'));
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
}

describe('popup.toggles.js - checkbox change persists the setting', () => {
    it.each(TOGGLES)('%s: checking persists true, unchecking persists false', async (field, _setter, id) => {
        const dom = buildPopupDom();
        expect(dom[id], `#${id} missing from popup.html`).toBeDefined();
        buildToggleManager().bindToggles(dom);

        dom[id].checked = true;
        await fireChangeAndSettle(dom[id]);
        expect((await StorageManager.getSettings())[field]).toBe(true);

        dom[id].checked = false;
        await fireChangeAndSettle(dom[id]);
        expect((await StorageManager.getSettings())[field]).toBe(false);
    });
});

// ── 5. applyMasterSwitchUI ──

describe('applyMasterSwitchUI - master switch disables both toggles', () => {
    it('isEnabled=false disables autoRetryToggle and autoContinueToggle (like hideThinkingToggle)', () => {
        const dom = buildPopupDom();
        requireToggles(dom);
        buildApplyMasterSwitchUI().applyMasterSwitchUI(false);
        expect(dom.hideThinkingToggle.disabled).toBe(true);
        expect(dom.autoRetryToggle.disabled).toBe(true);
        expect(dom.autoContinueToggle.disabled).toBe(true);
    });

    it('isEnabled=true re-enables them', () => {
        const dom = buildPopupDom();
        requireToggles(dom);
        dom.autoRetryToggle.disabled = true;
        dom.autoContinueToggle.disabled = true;
        buildApplyMasterSwitchUI().applyMasterSwitchUI(true);
        expect(dom.autoRetryToggle.disabled).toBe(false);
        expect(dom.autoContinueToggle.disabled).toBe(false);
    });
});

// ── 6. i18n ──

describe('i18n - label keys', () => {
    const LOCALES = [
        ['zhTW', () => globalThis.__DS_I18N_Locales_zhTW],
        ['en', () => globalThis.__DS_I18N_Locales_en],
    ];

    it.each(LOCALES)('%s defines non-empty autoRetryLabel and autoContinueLabel', (name, get) => {
        const dict = get();
        expect(dict, `locale ${name} not loaded`).toBeTruthy();
        for (const key of ['autoRetryLabel', 'autoContinueLabel']) {
            expect(typeof dict[key], `${name}.${key}`).toBe('string');
            expect(dict[key].trim().length, `${name}.${key}`).toBeGreaterThan(0);
        }
    });

    it('uses the agreed copy', () => {
        expect([
            globalThis.__DS_I18N_Locales_zhTW.autoRetryLabel,
            globalThis.__DS_I18N_Locales_zhTW.autoContinueLabel,
            globalThis.__DS_I18N_Locales_en.autoRetryLabel,
            globalThis.__DS_I18N_Locales_en.autoContinueLabel,
        ]).toEqual(['自動重試', '自動繼續生成', 'Auto retry', 'Auto continue generating']);
    });
});
