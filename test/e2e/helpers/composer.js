// The main chat composer: reading it, clearing it, and pressing Enter or clicking Send in it without ever sending a message.

import { humanType } from './human.js';
import { DSSelectors } from './selectors.js';

/**
 * DeepSeek endpoints that post a message (send, regenerate, continue, edit); the send guard aborts them and records each attempt.
 * chat_session/create is left alone: DeepSeek calls it on every home-page load to pre-create an empty session, so it is not a send.
 */
const SEND_ENDPOINTS = /\/api\/v0\/chat\/(completion|regenerate|continue|edit_message)(\?|$)/;

/** The main composer textarea. */
export function composer(page) {
    return page.locator(DSSelectors.INPUT_TEXTAREA_SELECTOR);
}

/** The composer's icon-only Send button (the one holding the send arrow icon). */
export function composerSendButton(page) {
    return page.locator(DSSelectors.SEND_BUTTON_ROLE_SELECTOR).filter({ has: page.locator(DSSelectors.SEND_BUTTON_ICON_SELECTOR) });
}

/** 送出按鈕是否處於 DeepSeek 自身的停用狀態：具有 `ds-button--disabled` class、`aria-disabled="true"` 或 `disabled` 屬性（docs/spec/01-prompt-system.md 第 2 節）。 */
export function isComposerSendButtonDisabled(page) {
    return composerSendButton(page).evaluate((button) => button.classList.contains('ds-button--disabled') || button.getAttribute('aria-disabled') === 'true' || button.hasAttribute('disabled'));
}

/**
 * Aborts every request to a send endpoint before it leaves the browser and records it, so a spec can drive DeepSeek's real send path and read what would have been posted.
 * @returns {Promise<{ requests: () => Array<{ url: string, body: any }> }>} `body` is the parsed JSON body, or null when it is not JSON.
 */
export async function blockSendRequests(page) {
    const requests = [];
    await page.route(SEND_ENDPOINTS, (route) => {
        const request = route.request();
        let body = null;
        try {
            body = request.postDataJSON();
        } catch {
            body = null;
        }
        requests.push({ url: request.url(), body });
        return route.abort();
    });
    return { requests: () => [...requests] };
}

/**
 * Makes Enter in the composer and a click on the composer Send button unable to send, so a spec can observe what the extension writes at send time.
 * Capture listeners on <html> run after the extension's document-level capture listeners (which rewrite the composer) and before DeepSeek's React root, so DeepSeek never receives the Enter or the click; the network block is a second guard.
 * @returns {Promise<{ sendRequests: () => number }>}
 */
export async function guardAgainstSending(page) {
    const blocked = await blockSendRequests(page);
    await page.evaluate(({ buttonSelector, iconSelector }) => {
        const swallow = (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
        };
        const swallowEnter = (event) => {
            if (event.key === 'Enter') swallow(event);
        };
        const swallowSendClick = (event) => {
            const button = event.target instanceof Element ? event.target.closest(buttonSelector) : null;
            if (button && button.querySelector(iconSelector)) swallow(event);
        };
        const root = document.documentElement;
        ['keydown', 'keypress'].forEach((type) => root.addEventListener(type, swallowEnter, { capture: true }));
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => root.addEventListener(type, swallowSendClick, { capture: true }));
    }, { buttonSelector: DSSelectors.SEND_BUTTON_ROLE_SELECTOR, iconSelector: DSSelectors.SEND_BUTTON_ICON_SELECTOR });
    return { sendRequests: () => blocked.requests().length };
}

/** Types `text` into the composer, replacing its value, and presses Enter (which the send guard keeps from sending); resolves the composer value. */
export async function pressEnterWith(page, text) {
    const input = composer(page);
    await humanType(input, text);
    await input.press('Enter');
    return input.inputValue();
}

/** Types `text` into the composer, replacing its value, and clicks the composer Send button (which the send guard keeps from sending); resolves the composer value. */
export async function clickSendWith(page, text) {
    const input = composer(page);
    await humanType(input, text);
    await composerSendButton(page).click();
    return input.inputValue();
}
