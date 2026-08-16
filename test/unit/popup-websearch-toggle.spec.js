/**
 * popup radio group - "Web Search" (websearchToggle)
 *
 * Requirement contract under test (updated - 'default' option removed):
 *   1. popup.html defines a radio group named "websearchToggle" with ONLY two
 *      values 'on'/'off' inside the "UI Adjustments" card, in a new
 *      input-group placed after the preventAutoScrollToggle input-group;
 *      the group is labeled with data-i18n="websearchToggleLabel". The
 *      legacy 'default' radio and its i18n label key no longer exist.
 *   2. The 'on' radio is the pre-checked / default-selected option in the
 *      markup.
 *   3. popup.js holds a DOM ref websearchRadios = Array.from(...) over the
 *      websearchToggle radios.
 *   4. On popup load, the checked radio reflects settings.websearchToggle,
 *      falling back to 'on' when missing, and normalizing the legacy stored
 *      value 'default' to 'on' (backward compatibility).
 *   5. A change handler persists the selected value via
 *      StorageManager.saveWebsearchToggle(r.value), then runs
 *      refreshSyncStatus() and showSaveStatus(); the deselected radio is
 *      ignored (if (!r.checked) return;). Only 'on'/'off' can be persisted
 *      going forward, but this wiring itself is unchanged.
 *   6. The radios are gated by the master switch (applyMasterSwitchUI
 *      subControls), exactly like the other UI-adjustment controls. This
 *      behavior is UNCHANGED and its coverage is preserved as-is.
 *   7. popup.live-sync.js mirrors chrome.storage.onChanged updates for the
 *      websearchToggle key onto the radios' checked state, and must also
 *      normalize a legacy 'default' newValue to 'on', falling back to 'on'
 *      when newValue is missing.
 *
 * The storage-layer contract (KEYS.WEBSEARCH_TOGGLE = 'dsWebSearchToggle',
 * saveWebsearchToggle) is certified by storage-manager.websearch-toggle.spec.js
 * and is NOT re-asserted here.
 *
 * Testing strategy: static source-pattern assertions for markup/DOM-ref/
 * change-handler wiring (identical style to popup-prevent-auto-scroll-toggle.spec.js),
 * plus genuine runtime extraction via new Function(...) for (a) the existing
 * applyMasterSwitchUI behavior, (b) the NEW load-restore normalization block
 * in popup.js, and (c) the NEW live-sync normalization block in
 * popup.live-sync.js. The runtime extractions execute the real block against
 * real DOM radio elements / plain objects and assert on resulting .checked
 * values for a matrix of stored inputs - never on the internal statement
 * shape - so the test tolerates any implementation that produces the correct
 * outcome for 'on', 'off', missing, and legacy 'default' inputs.
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

function readPopupLiveSyncJs() {
    return readFileSync(resolve(__dirname, "../../popup/popup.live-sync.js"), "utf-8");
}

function readPopupTogglesJs() {
    return readFileSync(resolve(__dirname, "../../popup/popup.toggles.js"), "utf-8");
}

// -----------------------------------------------------------------------------
// Requirement 1/2 - popup.html markup
// -----------------------------------------------------------------------------

/** Matches a single <input> tag carrying both name="websearchToggle" and the given value, regardless of attribute order. */
function radioTagRegex(value) {
    return new RegExp(`<input\\b(?=[^>]*\\bname="websearchToggle")(?=[^>]*\\bvalue="${value}")[^>]*>`);
}

/** Matches a single <input> tag carrying name="websearchToggle", the given value, AND a bare "checked" attribute. */
function checkedRadioTagRegex(value) {
    return new RegExp(`<input\\b(?=[^>]*\\bname="websearchToggle")(?=[^>]*\\bvalue="${value}")(?=[^>]*\\bchecked\\b)[^>]*>`);
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

    it("defines radio inputs named websearchToggle with ONLY the values 'on' and 'off'", () => {
        const cardHtml = uiAdjustmentsCardHtml(readPopupHtml());

        for (const value of ["on", "off"]) {
            expect(cardHtml, `missing <input name="websearchToggle" value="${value}">`).toMatch(radioTagRegex(value));
        }
    });

    it("no longer defines a radio input with value=\"default\" anywhere in popup.html", () => {
        expect(readPopupHtml()).not.toMatch(radioTagRegex("default"));
    });

    it("pre-checks the 'on' radio in the markup", () => {
        const cardHtml = uiAdjustmentsCardHtml(readPopupHtml());
        expect(cardHtml, "the 'on' radio must carry the checked attribute in the markup").toMatch(checkedRadioTagRegex("on"));
    });

    it("labels the radio group with data-i18n=\"websearchToggleLabel\"", () => {
        expect(uiAdjustmentsCardHtml(readPopupHtml())).toMatch(/data-i18n="websearchToggleLabel"/);
    });

    it("no longer references the removed 'default' option's i18n key (websearchDefaultLabel) anywhere in popup.html", () => {
        expect(readPopupHtml()).not.toMatch(/websearchDefaultLabel/);
    });
});

// -----------------------------------------------------------------------------
// Requirement 3 - popup.js DOM ref
// -----------------------------------------------------------------------------

describe("popup.js - websearchRadios DOM ref", () => {
    it("declares the websearchRadios DOM ref via Array.from over the websearchToggle radios", () => {
        expect(readPopupJs()).toMatch(
            /const\s+websearchRadios\s*=\s*Array\.from\(\s*document\.querySelectorAll\(\s*['"]input\[name="websearchToggle"\]/
        );
    });
});

// -----------------------------------------------------------------------------
// Requirement 4 - load-restore normalization (genuine runtime behavior test)
// -----------------------------------------------------------------------------

function makeToggleRadio(value, isChecked) {
    const el = document.createElement("input");
    el.type = "radio";
    el.name = "websearchToggle";
    el.value = value;
    el.checked = isChecked || false;
    return el;
}

function buildLoadRestoreWebsearchRadios() {
    const code = readPopupJs();
    const match = code.match(/if \(websearchRadios\.length\) \{[\s\S]*?\n {4}\}/);
    expect(match, "could not locate the load-restore block in popup.js").not.toBeNull();
    const factory = new Function("websearchRadios", "settings", match[0]);
    return factory;
}

describe("popup.js - websearchToggle load-restore checked state", () => {
    it.each([
        { stored: "on", expectedChecked: "on" },
        { stored: "off", expectedChecked: "off" },
        { stored: undefined, expectedChecked: "on" },
        { stored: "default", expectedChecked: "on" },
    ])("stored websearchToggle=$stored results in the correct radio being checked", ({ stored, expectedChecked }) => {
        const onRadio = makeToggleRadio("on", false);
        const offRadio = makeToggleRadio("off", false);
        const websearchRadios = [onRadio, offRadio];
        const restore = buildLoadRestoreWebsearchRadios();

        restore(websearchRadios, { websearchToggle: stored });

        expect(onRadio.checked).toBe(expectedChecked === "on");
        expect(offRadio.checked).toBe(expectedChecked === "off");
    });
});

// -----------------------------------------------------------------------------
// Requirement 5 - change handler persists via StorageManager.saveWebsearchToggle
// -----------------------------------------------------------------------------

describe("popup.toggles.js - websearchToggle change handler persistence", () => {
    let togglesCode;

    beforeAll(() => {
        togglesCode = readPopupTogglesJs();
    });

    it("ignores the deselected radio in the change handler (if (!r.checked) return)", () => {
        expect(togglesCode).toMatch(/if\s*\(!r\.checked\)\s*return;/);
    });

    it("persists the selected value via StorageManager.saveWebsearchToggle(r.value)", () => {
        expect(togglesCode).toMatch(/StorageManager\.saveWebsearchToggle\(\s*r\.value\s*\)/);
    });

    it("runs refreshSyncStatus() and showSaveStatus() after persisting", () => {
        const match = togglesCode.match(/StorageManager\.saveWebsearchToggle\([\s\S]{0,300}?\}\);/);
        expect(match, "no saveWebsearchToggle call found inside a change-handler block in popup.js").not.toBeNull();
        expect(match[0]).toMatch(/refreshSyncStatus\(\)/);
        expect(match[0]).toMatch(/showSaveStatus\(\)/);
    });
});

// -----------------------------------------------------------------------------
// Requirement 6 - applyMasterSwitchUI disables/enables the websearch radios
// (real runtime behavior, not text matching) - UNCHANGED, preserved as-is.
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
            websearchRadios: [makeRadio(false), makeRadio(false)],
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
            websearchRadios: [makeRadio(true), makeRadio(true)],
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

// -----------------------------------------------------------------------------
// Requirement 7 - popup.live-sync.js normalizes legacy 'default' to 'on'
// (genuine runtime behavior test)
// -----------------------------------------------------------------------------

function buildLiveSyncWebsearchHandler() {
    const code = readPopupLiveSyncJs();
    const match = code.match(/if \(changes\[KEYS\.WEBSEARCH_TOGGLE\]\) \{[\s\S]*?\n {8}\}/);
    expect(match, "could not locate the WEBSEARCH_TOGGLE onChanged block in popup.live-sync.js").not.toBeNull();
    const factory = new Function("KEYS", "changes", "dom", match[0]);
    return factory;
}

describe("popup.live-sync.js - websearchToggle onChanged normalization", () => {
    it.each([
        { newValue: "on", expectedChecked: "on" },
        { newValue: "off", expectedChecked: "off" },
        { newValue: undefined, expectedChecked: "on" },
        { newValue: "default", expectedChecked: "on" },
    ])("onChanged newValue=$newValue results in the correct radio being checked", ({ newValue, expectedChecked }) => {
        const onRadio = makeToggleRadio("on", false);
        const offRadio = makeToggleRadio("off", false);
        const KEYS = { WEBSEARCH_TOGGLE: "dsWebSearchToggle" };
        const changes = { [KEYS.WEBSEARCH_TOGGLE]: { newValue } };
        const dom = { websearchRadios: [onRadio, offRadio] };
        const handler = buildLiveSyncWebsearchHandler();

        handler(KEYS, changes, dom);

        expect(onRadio.checked).toBe(expectedChecked === "on");
        expect(offRadio.checked).toBe(expectedChecked === "off");
    });
});
