/**
 * popup radio group - "Web Search" (websearchToggle)
 *
 * Requirement contract under test:
 *   1. popup.html defines a radio group named "websearchToggle" (values
 *      'default'/'on'/'off') inside the "UI Adjustments" card, in a new
 *      input-group placed after the preventAutoScrollToggle input-group;
 *      the group is labeled with data-i18n="websearchToggleLabel".
 *   2. popup.js holds a DOM ref websearchRadios = Array.from(...) over the
 *      websearchToggle radios.
 *   3. On popup load, the checked radio reflects settings.websearchToggle
 *      with 'default' as the fallback (settings.websearchToggle ?? 'default').
 *   4. A change handler persists the selected value via
 *      StorageManager.saveWebsearchToggle(r.value), then runs
 *      refreshSyncStatus() and showSaveStatus(); the deselected radio is
 *      ignored (if (!r.checked) return;).
 *   5. The radios are gated by the master switch (applyMasterSwitchUI
 *      subControls), exactly like the other UI-adjustment controls.
 *
 * The storage-layer contract (KEYS.WEBSEARCH_TOGGLE = 'dsWebSearchToggle',
 * saveWebsearchToggle, 'default' default) is certified by
 * storage-manager.websearch-toggle.spec.js and is NOT re-asserted here.
 *
 * Testing strategy for popup.js (requirements 2/3/4/5): identical to
 * popup-prevent-auto-scroll-toggle.spec.js — static source-pattern assertions
 * on the wiring text for the DOM ref / load restore / change handler, and a
 * genuine runtime extraction of applyMasterSwitchUI via new Function(...)
 * against live DOM radio elements.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readPopupHtml() {
    return readFileSync(resolve(__dirname, "../../popup/popup.html"), "utf-8");
}

function readPopupJs() {
    return readFileSync(resolve(__dirname, "../../popup/popup.js"), "utf-8");
}

// -----------------------------------------------------------------------------
// Requirement 1 - popup.html markup
// -----------------------------------------------------------------------------

/** Matches a single <input> tag carrying both name="websearchToggle" and the given value, regardless of attribute order. */
function radioTagRegex(value) {
    return new RegExp(`<input\\b(?=[^>]*\\bname="websearchToggle")(?=[^>]*\\bvalue="${value}")[^>]*>`);
}

function uiAdjustmentsCardHtml(html) {
    const cardStart = html.indexOf("UI Adjustments");
    const cardEnd = html.indexOf("<!-- Toast");
    expect(cardStart, "could not locate the UI Adjustments card").toBeGreaterThan(-1);
    expect(cardEnd, "could not locate end-of-container marker").toBeGreaterThan(cardStart);
    return html.slice(cardStart, cardEnd);
}

describe("popup.html - websearchToggle radio group markup", () => {
    it("places the radio group inside the UI Adjustments card, after the preventAutoScrollToggle input-group", () => {
        const cardHtml = uiAdjustmentsCardHtml(readPopupHtml());

        const websearchIdx = cardHtml.indexOf('name="websearchToggle"');
        const preventIdx = cardHtml.indexOf('id="preventAutoScrollToggle"');
        expect(websearchIdx, "no websearchToggle radio group found in the UI Adjustments card").toBeGreaterThan(-1);
        expect(preventIdx, "could not locate preventAutoScrollToggle in the UI Adjustments card").toBeGreaterThan(-1);
        expect(websearchIdx, "websearchToggle radio group must come after the preventAutoScrollToggle input-group").toBeGreaterThan(preventIdx);
    });

    it("defines radio inputs named websearchToggle with values 'default', 'on' and 'off'", () => {
        const cardHtml = uiAdjustmentsCardHtml(readPopupHtml());

        for (const value of ["default", "on", "off"]) {
            expect(cardHtml, `missing <input name="websearchToggle" value="${value}">`).toMatch(radioTagRegex(value));
        }
    });

    it("labels the radio group with data-i18n=\"websearchToggleLabel\"", () => {
        expect(uiAdjustmentsCardHtml(readPopupHtml())).toMatch(/data-i18n="websearchToggleLabel"/);
    });
});

// -----------------------------------------------------------------------------
// Requirements 2 and 3 - popup.js DOM ref + initial load reflects settings
// -----------------------------------------------------------------------------

describe("popup.js - websearchRadios DOM ref and load wiring", () => {
    let popupCode;

    beforeAll(() => {
        popupCode = readPopupJs();
    });

    it("declares the websearchRadios DOM ref via Array.from over the websearchToggle radios", () => {
        expect(popupCode).toMatch(
            /const\s+websearchRadios\s*=\s*Array\.from\(\s*document\.querySelectorAll\(\s*['"]input\[name="websearchToggle"\]/
        );
    });

    it("restores the checked radio from settings.websearchToggle on load", () => {
        expect(popupCode).toMatch(/settings\.websearchToggle/);
        expect(popupCode).toMatch(/r\.checked\s*=\s*\(?r\.value\s*===\s*\(?settings\.websearchToggle/);
    });

    it("falls back to 'default' when settings.websearchToggle is undefined", () => {
        expect(popupCode).toMatch(/settings\.websearchToggle\s*\?\?\s*['"]default['"]/);
    });
});

// -----------------------------------------------------------------------------
// Requirement 4 - change handler persists via StorageManager.saveWebsearchToggle
// -----------------------------------------------------------------------------

describe("popup.js - websearchToggle change handler persistence", () => {
    let popupCode;

    beforeAll(() => {
        popupCode = readPopupJs();
    });

    it("ignores the deselected radio in the change handler (if (!r.checked) return)", () => {
        expect(popupCode).toMatch(/if\s*\(!r\.checked\)\s*return;/);
    });

    it("persists the selected value via StorageManager.saveWebsearchToggle(r.value)", () => {
        expect(popupCode).toMatch(/StorageManager\.saveWebsearchToggle\(\s*r\.value\s*\)/);
    });

    it("runs refreshSyncStatus() and showSaveStatus() after persisting", () => {
        const match = popupCode.match(/StorageManager\.saveWebsearchToggle\([\s\S]{0,300}?\}\);/);
        expect(match, "no saveWebsearchToggle call found inside a change-handler block in popup.js").not.toBeNull();
        expect(match[0]).toMatch(/refreshSyncStatus\(\)/);
        expect(match[0]).toMatch(/showSaveStatus\(\)/);
    });
});

// -----------------------------------------------------------------------------
// Requirement 5 - applyMasterSwitchUI disables/enables the websearch radios
// (real runtime behavior, not text matching)
// -----------------------------------------------------------------------------

function makeCheckbox(disabled) {
    const el = document.createElement("input");
    el.type = "checkbox";
    el.disabled = disabled || false;
    return el;
}

function makeRadio(disabled) {
    const el = document.createElement("input");
    el.type = "radio";
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
    "preventAutoScrollToggle", "websearchRadios",
];

function buildApplyMasterSwitchUI(dom) {
    const fnSource = extractApplyMasterSwitchUI();
    const wrapperBody = fnSource + "\nreturn applyMasterSwitchUI;";
    const factory = new Function(...CLOSURE_VAR_NAMES, wrapperBody);
    return factory(...CLOSURE_VAR_NAMES.map((name) => dom[name]));
}

describe("applyMasterSwitchUI - websearchToggle radios master-switch disable behavior", () => {
    it("disables the websearch radios when isEnabled is false, same as the other subControls", () => {
        const dom = {
            sidebarAutoHideToggle: makeCheckbox(false),
            hideThinkingToggle: makeCheckbox(false),
            showSystemTimeToggle: makeCheckbox(false),
            chatWidthToggle: makeCheckbox(false),
            chatWidthSlider: makeRange(),
            inputWidthToggle: makeCheckbox(false),
            inputWidthSlider: makeRange(),
            preventAutoScrollToggle: makeCheckbox(false),
            websearchRadios: [makeRadio(false), makeRadio(false), makeRadio(false)],
        };
        const applyMasterSwitchUI = buildApplyMasterSwitchUI(dom);

        applyMasterSwitchUI(false);

        expect(dom.hideThinkingToggle.disabled).toBe(true);
        expect(dom.preventAutoScrollToggle.disabled).toBe(true);
        for (const radio of dom.websearchRadios) {
            expect(radio.disabled).toBe(true);
        }
    });

    it("re-enables the websearch radios when isEnabled is true, same as the other subControls", () => {
        const dom = {
            sidebarAutoHideToggle: makeCheckbox(true),
            hideThinkingToggle: makeCheckbox(true),
            showSystemTimeToggle: makeCheckbox(true),
            chatWidthToggle: makeCheckbox(true),
            chatWidthSlider: makeRange(),
            inputWidthToggle: makeCheckbox(true),
            inputWidthSlider: makeRange(),
            preventAutoScrollToggle: makeCheckbox(true),
            websearchRadios: [makeRadio(true), makeRadio(true), makeRadio(true)],
        };
        const applyMasterSwitchUI = buildApplyMasterSwitchUI(dom);

        applyMasterSwitchUI(true);

        expect(dom.hideThinkingToggle.disabled).toBe(false);
        expect(dom.preventAutoScrollToggle.disabled).toBe(false);
        for (const radio of dom.websearchRadios) {
            expect(radio.disabled).toBe(false);
        }
    });
});
