/**
 * popup checkbox toggle - "Prevent Auto-Scroll" (preventAutoScrollToggle)
 *
 * Requirement contract under test (mirrors the existing hideThinkingToggle / dsHideThinking toggle exactly):
 *   1. popup.html defines a checkbox #preventAutoScrollToggle inside the "Features" card; popup.js holds a DOM ref for it.
 *   2. StorageManager.KEYS.PREVENT_AUTO_SCROLL === "dsPreventAutoScroll"; settings.preventAutoScroll defaults to false.
 *   3. On popup load, preventAutoScrollToggle.checked reflects settings.preventAutoScroll.
 *   4. Changing the checkbox persists the new boolean via StorageManager.savePreventAutoScroll(value).
 *   5. preventAutoScrollToggle is disabled/enabled by the master switch, exactly like hideThinkingToggle (applyMasterSwitchUI subControls list).
 *
 * Testing strategy for popup.js (requirements 1/3/4/5):
 *   popup.js logic lives entirely inside a single DOMContentLoaded closure with heavy cross-module dependencies (Modal, Toast, dsI18n, preset and backup managers, editor-window and width-slider managers, custom-select, live sync...). No existing spec runs that closure end-to-end (popup.spec.js only covers popup.editor-window.js); the established convention for this file (see popup-live-sync.spec.js Group H) is static source-pattern assertions on the wiring text for load / change-handler wiring.
 *   applyMasterSwitchUI(), however, is a small standalone function, so for requirement 5 test/helpers/popup-master-switch-harness.js runs its real source against the real popup.html DOM - genuine runtime behavior, not a text match.
 *
 * This is a NEW focused spec file (not an extension of popup-live-sync.spec.js or popup.spec.js) because neither existing file exercises popup.js initial load / change-handler / master-switch wiring: popup-live-sync.spec.js is scoped to createLiveSyncListener() (a different module) and popup.spec.js is scoped to popup.editor-window.js. The live-sync requirement (6) is covered separately by extending popup-live-sync.spec.js, per the directive.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import StorageManager from "../../utils/storage-manager.js";
import { parsePopupHtml, mountPopupHtml, buildApplyMasterSwitchUI } from "../helpers/popup-master-switch-harness.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
    it("defines a checkbox with id=preventAutoScrollToggle inside the Features card (located by its card heading)", () => {
        const doc = parsePopupHtml();
        const title = [...doc.querySelectorAll(".card-title")].find((el) => el.textContent.trim() === "Features");
        expect(title, "could not locate the Features card heading").toBeTruthy();
        const input = title.closest(".card").querySelector("#preventAutoScrollToggle");
        expect(input, "#preventAutoScrollToggle missing from the Features card").not.toBeNull();
        expect(input.type).toBe("checkbox");
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

describe("applyMasterSwitchUI - preventAutoScrollToggle master-switch disable behavior", () => {
    it("disables preventAutoScrollToggle when isEnabled is false, same as hideThinkingToggle", () => {
        mountPopupHtml();
        const { applyMasterSwitchUI, refs } = buildApplyMasterSwitchUI();
        refs.hideThinkingToggle.disabled = false;
        refs.preventAutoScrollToggle.disabled = false;

        applyMasterSwitchUI(false);

        expect(refs.hideThinkingToggle.disabled).toBe(true);
        expect(refs.preventAutoScrollToggle.disabled).toBe(true);
    });

    it("re-enables preventAutoScrollToggle when isEnabled is true, same as hideThinkingToggle", () => {
        mountPopupHtml();
        const { applyMasterSwitchUI, refs } = buildApplyMasterSwitchUI();
        refs.hideThinkingToggle.disabled = true;
        refs.preventAutoScrollToggle.disabled = true;

        applyMasterSwitchUI(true);

        expect(refs.hideThinkingToggle.disabled).toBe(false);
        expect(refs.preventAutoScrollToggle.disabled).toBe(false);
    });
});
