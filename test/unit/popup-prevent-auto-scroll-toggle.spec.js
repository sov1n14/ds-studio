/**
 * popup checkbox toggle - "Prevent Auto-Scroll" (preventAutoScrollToggle)
 *
 * Requirement contract under test (mirrors the existing hideThinkingToggle /
 * dsHideThinking toggle exactly):
 *   1. popup.html defines a checkbox #preventAutoScrollToggle inside the "UI
 *      Adjustments" card; popup.js holds a DOM ref for it.
 *   2. StorageManager.KEYS.PREVENT_AUTO_SCROLL === "dsPreventAutoScroll";
 *      settings.preventAutoScroll defaults to false.
 *   3. On popup load, preventAutoScrollToggle.checked reflects
 *      settings.preventAutoScroll.
 *   4. Changing the checkbox persists the new boolean via
 *      StorageManager.savePreventAutoScroll(value).
 *   5. preventAutoScrollToggle is disabled/enabled by the master switch,
 *      exactly like hideThinkingToggle (applyMasterSwitchUI subControls list).
 *
 * Testing strategy for popup.js (requirements 1/3/4/5):
 *   popup.js logic lives entirely inside a single DOMContentLoaded closure
 *   with heavy cross-module dependencies (Modal, Toast, dsI18n, preset and
 *   backup managers, editor-window and width-slider managers, custom-select,
 *   live sync...). No existing spec runs that closure end-to-end (popup.spec.js
 *   only covers popup.editor-window.js); the established convention for this
 *   file (see popup-live-sync.spec.js Group H) is static source-pattern
 *   assertions on the wiring text for load / change-handler wiring.
 *   applyMasterSwitchUI(), however, is a small standalone function with no
 *   external dependencies, so for requirement 5 we extract its real source
 *   and run it for real via new Function(...) against live DOM checkboxes -
 *   genuine runtime behavior, not a text match.
 *
 * This is a NEW focused spec file (not an extension of popup-live-sync.spec.js
 * or popup.spec.js) because neither existing file exercises popup.js initial
 * load / change-handler / master-switch wiring: popup-live-sync.spec.js is
 * scoped to createLiveSyncListener() (a different module) and popup.spec.js
 * is scoped to popup.editor-window.js. The live-sync requirement (6) is
 * covered separately by extending popup-live-sync.spec.js, per the directive.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import StorageManager from "../../utils/storage-manager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readPopupHtml() {
    return readFileSync(resolve(__dirname, "../../popup/popup.html"), "utf-8");
}

function readPopupJs() {
    return readFileSync(resolve(__dirname, "../../popup/popup.js"), "utf-8");
}

function readPopupSettingsViewJs() {
    return readFileSync(resolve(__dirname, "../../popup/popup.settings-view.js"), "utf-8");
}

function readPopupTogglesJs() {
    return readFileSync(resolve(__dirname, "../../popup/popup.toggles.js"), "utf-8");
}

// -----------------------------------------------------------------------------
// Requirement 2 - StorageManager settings key / bundle property / default
// -----------------------------------------------------------------------------

describe("StorageManager - preventAutoScroll setting", () => {
    it("exposes KEYS.PREVENT_AUTO_SCROLL as dsPreventAutoScroll", () => {
        expect(StorageManager.KEYS.PREVENT_AUTO_SCROLL).toBe("dsPreventAutoScroll");
    });

    it("defaults settings.preventAutoScroll to false", async () => {
        const settings = await StorageManager.getSettings();
        expect(settings.preventAutoScroll).toBe(false);
    });

    it("persists preventAutoScroll via StorageManager.savePreventAutoScroll()", async () => {
        await StorageManager.savePreventAutoScroll(true);
        const settings = await StorageManager.getSettings();
        expect(settings.preventAutoScroll).toBe(true);
    });
});

// -----------------------------------------------------------------------------
// Requirement 1 - popup.html markup
// -----------------------------------------------------------------------------

describe("popup.html - preventAutoScrollToggle checkbox markup", () => {
    it("defines a checkbox with id=preventAutoScrollToggle inside the Features card", () => {
        const html = readPopupHtml();
        const cardStart = html.indexOf("Features");
        const cardEnd = html.indexOf("<!-- Toast");
        expect(cardStart, "could not locate the Features card").toBeGreaterThan(-1);
        expect(cardEnd, "could not locate end-of-container marker").toBeGreaterThan(cardStart);

        const cardHtml = html.slice(cardStart, cardEnd);
        expect(cardHtml).toMatch(/<input\s+type="checkbox"\s+id="preventAutoScrollToggle"/);
    });
});

// -----------------------------------------------------------------------------
// Requirements 1 and 3 - popup.js DOM ref + initial load reflects settings
// -----------------------------------------------------------------------------

describe("popup - preventAutoScrollToggle DOM ref and load wiring", () => {
    let popupCode;
    let settingsViewCode;

    beforeAll(() => {
        popupCode = readPopupJs();
        settingsViewCode = readPopupSettingsViewJs();
    });

    it("declares a DOM reference for preventAutoScrollToggle", () => {
        expect(popupCode).toMatch(
            /const\s+preventAutoScrollToggle\s*=\s*document\.getElementById\(\s*['"]preventAutoScrollToggle['"]\s*\)/
        );
    });

    it("sets preventAutoScrollToggle.checked from settings.preventAutoScroll on load", () => {
        expect(settingsViewCode).toMatch(/preventAutoScrollToggle\.checked\s*=\s*settings\.preventAutoScroll\b/);
    });
});

// -----------------------------------------------------------------------------
// Requirement 4 - change handler persists via StorageManager.savePreventAutoScroll
// -----------------------------------------------------------------------------

describe("popup.toggles.js - preventAutoScrollToggle change handler persistence", () => {
    let togglesCode;

    beforeAll(() => {
        togglesCode = readPopupTogglesJs();
    });

    it("wires a change listener on preventAutoScrollToggle", () => {
        expect(togglesCode).toMatch(/preventAutoScrollToggle\.addEventListener\(\s*['"]change['"]/);
    });

    it("the change listener persists the new boolean via StorageManager.savePreventAutoScroll(checked value)", () => {
        const match = togglesCode.match(/preventAutoScrollToggle\.addEventListener\(\s*['"]change['"],[\s\S]{0,400}?\}\);/);
        expect(match, "no change listener block found for preventAutoScrollToggle").not.toBeNull();
        expect(match[0]).toMatch(/StorageManager\.savePreventAutoScroll\(\s*preventAutoScrollToggle\.checked/);
    });
});

// -----------------------------------------------------------------------------
// Requirement 5 - applyMasterSwitchUI disables/enables preventAutoScrollToggle
// exactly like hideThinkingToggle (real runtime behavior, not text matching)
// -----------------------------------------------------------------------------

function makeCheckbox(disabled) {
    const el = document.createElement("input");
    el.type = "checkbox";
    el.disabled = disabled || false;
    return el;
}

function makeRange() {
    const el = document.createElement("input");
    el.type = "range";
    return el;
}

function extractApplyMasterSwitchUI() {
    const code = readPopupJs();
    const match = code.match(/function applyMasterSwitchUI\(isEnabled\)\s*\{[\s\S]*?\n {4}\}/);
    if (!match) throw new Error("Could not locate applyMasterSwitchUI(isEnabled) in popup.js");
    return match[0];
}

const CLOSURE_VAR_NAMES = [
    "sidebarAutoHideToggle", "hideThinkingToggle", "showSystemTimeToggle",
    "chatWidthToggle", "chatWidthSlider", "inputWidthToggle", "inputWidthSlider",
    "preventAutoScrollToggle", "autoExpandMessagesToggle", "websearchRadios",
];

function buildApplyMasterSwitchUI(dom) {
    const fnSource = extractApplyMasterSwitchUI();
    const wrapperBody = fnSource + "\nreturn applyMasterSwitchUI;";
    const factory = new Function(...CLOSURE_VAR_NAMES, wrapperBody);
    return factory(...CLOSURE_VAR_NAMES.map((name) => dom[name]));
}

describe("applyMasterSwitchUI - preventAutoScrollToggle master-switch disable behavior", () => {
    it("disables preventAutoScrollToggle when isEnabled is false, same as hideThinkingToggle", () => {
        const dom = {
            sidebarAutoHideToggle: makeCheckbox(false),
            hideThinkingToggle: makeCheckbox(false),
            showSystemTimeToggle: makeCheckbox(false),
            chatWidthToggle: makeCheckbox(false),
            chatWidthSlider: makeRange(),
            inputWidthToggle: makeCheckbox(false),
            inputWidthSlider: makeRange(),
            preventAutoScrollToggle: makeCheckbox(false),
            websearchRadios: [],
        };
        const applyMasterSwitchUI = buildApplyMasterSwitchUI(dom);

        applyMasterSwitchUI(false);

        expect(dom.hideThinkingToggle.disabled).toBe(true);
        expect(dom.preventAutoScrollToggle.disabled).toBe(true);
    });

    it("re-enables preventAutoScrollToggle when isEnabled is true, same as hideThinkingToggle", () => {
        const dom = {
            sidebarAutoHideToggle: makeCheckbox(true),
            hideThinkingToggle: makeCheckbox(true),
            showSystemTimeToggle: makeCheckbox(true),
            chatWidthToggle: makeCheckbox(true),
            chatWidthSlider: makeRange(),
            inputWidthToggle: makeCheckbox(true),
            inputWidthSlider: makeRange(),
            preventAutoScrollToggle: makeCheckbox(true),
            websearchRadios: [],
        };
        const applyMasterSwitchUI = buildApplyMasterSwitchUI(dom);

        applyMasterSwitchUI(true);

        expect(dom.hideThinkingToggle.disabled).toBe(false);
        expect(dom.preventAutoScrollToggle.disabled).toBe(false);
    });
});
