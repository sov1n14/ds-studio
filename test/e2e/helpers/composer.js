// The main chat composer: reading it, clearing it, and pressing Enter in it without ever sending a message.

import { DSSelectors } from './selectors.js';

/**
 * DeepSeek endpoints that post a message (send, regenerate, continue, edit); the send guard aborts them and counts each attempt.
 * chat_session/create is left alone: DeepSeek calls it on every home-page load to pre-create an empty session, so it is not a send.
 */
const SEND_ENDPOINTS = /\/api\/v0\/chat\/(completion|regenerate|continue|edit_message)(\?|$)/;

/** The main composer textarea. */
export function composer(page) {
    return page.locator(DSSelectors.INPUT_TEXTAREA_SELECTOR);
}

/**
 * Makes Enter in the composer unable to send, so a spec can observe what the extension writes at send time.
 * A capture listener on <html> runs after the extension's document-level capture listener (which rewrites the composer) and before DeepSeek's React root, so DeepSeek never receives Enter; the network route is a second guard that aborts any send request.
 * @returns {Promise<{ sendRequests: () => number }>}
 */
export async function guardAgainstSending(page) {
    let sendRequests = 0;
    await page.route(SEND_ENDPOINTS, (route) => {
        sendRequests += 1;
        return route.abort();
    });
    await page.evaluate(() => {
        const swallowEnter = (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            event.stopImmediatePropagation();
        };
        document.documentElement.addEventListener('keydown', swallowEnter, { capture: true });
        document.documentElement.addEventListener('keypress', swallowEnter, { capture: true });
    });
    return { sendRequests: () => sendRequests };
}

/** Types `text` into an empty composer and presses Enter (which the send guard keeps from sending); resolves the composer value. */
export async function pressEnterWith(page, text) {
    const input = composer(page);
    await input.fill(text);
    await input.press('Enter');
    return input.inputValue();
}
