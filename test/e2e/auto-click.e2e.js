import { test, expect } from './fixtures.js';
import { DEEPSEEK_ORIGIN } from './helpers/conversations.js';
import { expectNeverWithin } from './helpers/observation.js';

// Auto retry and auto continue click DeepSeek's retry / continue button once per round, every round waiting a random 0-3 s, while the button is on the page; each follows its own switch and the master switch (docs/FEATURES.md, Auto Retry and Auto Continue).
// DeepSeek's buttons act only through a React onClick that requires a trusted native event, so the synthetic buttons below count a click only when their own React onClick receives one: the counter is the button's observable side effect, exactly what a live DeepSeek button would act on.
// The buttons are built from the selectors docs/FEATURES.md documents, on the home page, which shows neither native button.

// The longest round delay is 3 s; the negative window is 1.5 times that, and a click is awaited for three rounds.
const NO_CLICK_WINDOW_MS = 4_500;
const CLICK_TIMEOUT_MS = 10_000;
const CLICK_COUNT_ATTRIBUTE = 'data-e2e-trusted-clicks';

const BUTTONS = Object.freeze({
    retry: Object.freeze({ ownKey: 'isAutoRetryEnabled', selector: '.ds-button--warning.ds-button--circle.ds-button--xs' }),
    continue: Object.freeze({ ownKey: 'isAutoContinueEnabled', selector: '._8e85838 > .ds-button[role="button"]' }),
});

/** Appends a synthetic DeepSeek button of `kind` to the page; its React onClick counts trusted clicks in CLICK_COUNT_ATTRIBUTE. */
async function injectSyntheticButton(page, kind) {
    await page.evaluate(({ kind: buttonKind, attribute }) => {
        const button = document.createElement('div');
        button.setAttribute('role', 'button');
        button.textContent = 'e2e ' + buttonKind;
        button.setAttribute(attribute, '0');
        button.__reactProps$e2e = {
            onClick(event) {
                const native = event && event.nativeEvent;
                if (!(native instanceof Event) || native.isTrusted !== true) return;
                button.setAttribute(attribute, String(Number(button.getAttribute(attribute)) + 1));
            },
        };
        if (buttonKind === 'retry') {
            button.className = 'ds-button ds-button--warning ds-button--circle ds-button--xs';
            document.body.appendChild(button);
        } else {
            button.className = 'ds-button';
            const wrapper = document.createElement('div');
            wrapper.className = '_8e85838';
            wrapper.appendChild(button);
            document.body.appendChild(wrapper);
        }
    }, { kind, attribute: CLICK_COUNT_ATTRIBUTE });
}

/** Trusted clicks counted by the only button matching `selector`. */
function trustedClicks(page, selector) {
    return page.locator(selector).getAttribute(CLICK_COUNT_ATTRIBUTE).then(Number);
}

/** Page predicate: the button matching `selector` has counted a trusted click. */
function hasBeenClicked({ selector, attribute }) {
    return Number(document.querySelector(selector)?.getAttribute(attribute) ?? 0) > 0;
}

/** Opens the home page with `values` seeded, checks that no native button of `kind` exists, and injects the synthetic one. */
async function openHomeWithSyntheticButton(page, settings, values, kind) {
    await settings.set(values);
    await page.goto(DEEPSEEK_ORIGIN + '/');
    const { selector } = BUTTONS[kind];
    await expect(page.locator(selector), 'the home page shows no native ' + kind + ' button (precondition)').toHaveCount(0);
    await injectSyntheticButton(page, kind);
    await expect(page.locator(selector), 'exactly one ' + kind + ' button, the synthetic one, is on the page (precondition)').toHaveCount(1);
    expect(await trustedClicks(page, selector), 'the synthetic ' + kind + ' button starts unclicked (precondition)').toBe(0);
}

test.describe('auto click', () => {
    for (const kind of Object.keys(BUTTONS)) {
        const { ownKey, selector } = BUTTONS[kind];

        test('with ' + ownKey + ' off the ' + kind + ' button is never clicked; switching it on gets the button clicked', async ({ page, settings }) => {
            await openHomeWithSyntheticButton(page, settings, { isEnabled: true, isAutoRetryEnabled: false, isAutoContinueEnabled: false }, kind);

            await expectNeverWithin(page, hasBeenClicked, { selector, attribute: CLICK_COUNT_ATTRIBUTE }, NO_CLICK_WINDOW_MS, 'with ' + ownKey + ' off the ' + kind + ' button may not be clicked');

            await settings.set({ [ownKey]: true });
            await expect.poll(() => trustedClicks(page, selector), { message: 'after switching ' + ownKey + ' on the ' + kind + ' button receives a trusted click', timeout: CLICK_TIMEOUT_MS }).toBeGreaterThan(0);
        });
    }

    test('with the master switch off an enabled auto retry never clicks; switching the master on gets the retry button clicked', async ({ page, settings }) => {
        const { selector } = BUTTONS.retry;
        await openHomeWithSyntheticButton(page, settings, { isEnabled: false, isAutoRetryEnabled: true, isAutoContinueEnabled: false }, 'retry');

        await expectNeverWithin(page, hasBeenClicked, { selector, attribute: CLICK_COUNT_ATTRIBUTE }, NO_CLICK_WINDOW_MS, 'with the master switch off the retry button may not be clicked');

        await settings.set({ isEnabled: true });
        await expect.poll(() => trustedClicks(page, selector), { message: 'after switching the master on the retry button receives a trusted click', timeout: CLICK_TIMEOUT_MS }).toBeGreaterThan(0);
    });
});
