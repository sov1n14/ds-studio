import { test, expect } from './fixtures.js';
import { expectNeverWithin } from './helpers/observation.js';
import { DSSelectors } from './helpers/selectors.js';

// Web-search start state (`dsWebSearchToggle`: 'on' | 'off') sets DeepSeek's own Search toggle (aria-pressed) once per trigger: page entry, a change of this setting, or the master switch turning on; afterwards a manual flip is left alone until the next trigger.
// The Search toggle is found the language-independent way: the [aria-pressed] button whose icon path starts with SEARCH_ICON_PATH_PREFIX.

const MANUAL_FLIP_WINDOW_MS = 2_000;

const SEARCH_BUTTON_ARG = Object.freeze({
    pressable: DSSelectors.TOGGLE_BUTTON_FALLBACK_SELECTOR,
    iconPrefix: DSSelectors.SEARCH_ICON_PATH_PREFIX,
});

/** Page function, the one Search-toggle lookup: the toggle when it shows aria-pressed === `value`, otherwise null (also while the composer has not rendered it). The icon path may carry leading whitespace, so it is trimmed before the prefix match. */
function searchButtonPressedAs({ pressable, iconPrefix, value }) {
    const button = [...document.querySelectorAll(pressable)]
        .find((el) => (el.querySelector('path[d]')?.getAttribute('d') || '').trim().startsWith(iconPrefix));
    return button?.getAttribute('aria-pressed') === value ? button : null;
}

/** Whether DeepSeek's Search toggle shows aria-pressed === `value` right now. */
async function isSearchPressedAs(page, value) {
    const handle = await page.evaluateHandle(searchButtonPressedAs, { ...SEARCH_BUTTON_ARG, value });
    const found = handle.asElement() !== null;
    await handle.dispose();
    return found;
}

/** Clicks DeepSeek's Search toggle, as a user would, once it shows aria-pressed === `value`. */
async function clickSearchButtonPressedAs(page, value) {
    const handle = await page.waitForFunction(searchButtonPressedAs, { ...SEARCH_BUTTON_ARG, value });
    await handle.asElement().click();
    await handle.dispose();
}

test.describe('web-search start state', () => {
    test('mode off releases DeepSeek\'s Search toggle and mode on presses it again', async ({ page, settings }) => {
        // 產品每次只寫一個鍵；先寫模式再開總開關，不把兩個鍵併成一次寫入，也不依賴設定檔殘留的值。
        await settings.set({ dsWebSearchToggle: 'on' });
        await settings.set({ isEnabled: true });
        await expect.poll(() => isSearchPressedAs(page, 'true'), { message: 'mode on leaves Search pressed (precondition for the off transition)' }).toBe(true);

        await settings.set({ dsWebSearchToggle: 'off' });
        await expect.poll(() => isSearchPressedAs(page, 'false'), { message: 'mode off releases Search' }).toBe(true);

        await settings.set({ dsWebSearchToggle: 'on' });
        await expect.poll(() => isSearchPressedAs(page, 'true'), { message: 'mode on presses Search again' }).toBe(true);
    });

    test('mode off is applied once: a manual flip back on is not undone', async ({ page, settings }) => {
        // 產品每次只寫一個鍵；先寫模式再開總開關，不把兩個鍵併成一次寫入，也不依賴設定檔殘留的值。
        await settings.set({ dsWebSearchToggle: 'on' });
        await settings.set({ isEnabled: true });
        await expect.poll(() => isSearchPressedAs(page, 'true'), { message: 'Search starts pressed (precondition)' }).toBe(true);
        await settings.set({ dsWebSearchToggle: 'off' });
        await expect.poll(() => isSearchPressedAs(page, 'false'), { message: 'mode off releases Search' }).toBe(true);

        await clickSearchButtonPressedAs(page, 'false');
        await expect.poll(() => isSearchPressedAs(page, 'true'), { message: 'the user presses Search by hand' }).toBe(true);
        await expectNeverWithin(page, searchButtonPressedAs, { ...SEARCH_BUTTON_ARG, value: 'false' }, MANUAL_FLIP_WINDOW_MS, 'the manual flip must survive until the next trigger');
    });
});
