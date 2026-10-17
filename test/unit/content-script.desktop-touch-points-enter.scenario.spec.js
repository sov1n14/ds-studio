/**
 * Scenario: on a Windows desktop that reports touch points, pressing Enter on the new-chat page must inject the selected preset and keep that preset bound to the chat DeepSeek creates.
 *
 * Bug (user runtime log): a Windows desktop with no touch hardware reported navigator.maxTouchPoints === 10 (most likely via an Android emulator's touch-injection service) with a desktop Edge UA, which made the device count as mobile, so the Enter handler let DeepSeek send the raw message, the chat-creation attempt was never armed, and when the new chat UUID appeared the binding controller reset the selected preset to none.
 *
 * Cross-module state under test: the injector's Enter path (content/prompt-injector.controller.js) arms the chat-creation "awaiting" flag; the binding controller (content/chat-binding-controller.js) reads it when the UUID appears to decide between auto-binding the pending preset and resetting to none.
 *
 * Harness (real modules, mocked trust boundaries only): test/helpers/overlay-consistency-harness.js. navigator is the device boundary and is overridden per test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { preset, settle, transports, shownValue, clickOption, storedMap, injected, navigateTo, setUpOverlayScenario, openChat } from '../helpers/overlay-consistency-harness.js';

const NEW_CHAT = 'dddddddd-4444-4444-4444-444444444444';
const A = preset('preset-A', 'Alpha', 'PREFIX-A', true);

const DEVICES = {
    // Exact UA, platform, and touch points from the bug-report machine's runtime log.
    'Windows desktop reporting touch points (Edge, maxTouchPoints 10)': {
        maxTouchPoints: 10,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0',
        platform: 'Win32',
    },
    // Control: the same flow on a non-touch desktop, which already worked before the bug fix.
    'control: non-touch Windows desktop (maxTouchPoints 0)': {
        maxTouchPoints: 0,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0',
        platform: 'Win32',
    },
};

function useDevice(device) {
    for (const [key, value] of Object.entries(device)) {
        Object.defineProperty(navigator, key, { configurable: true, get: () => value });
    }
    return () => { for (const key of Object.keys(device)) delete navigator[key]; };
}

function pressEnterWith(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
    textarea.dispatchEvent(ev);
    return { ev, textarea };
}

describe('Enter on the new-chat page keeps the selected preset through chat creation', () => {
    let tearDown;
    let restoreDevice;
    beforeEach(async () => {
        tearDown = await setUpOverlayScenario();
        chrome.runtime.sendMessage = vi.fn(transports.success);
    });
    afterEach(() => {
        restoreDevice?.();
        restoreDevice = null;
        document.querySelectorAll('textarea').forEach((t) => t.remove());
        tearDown();
    });

    it.each(Object.keys(DEVICES))('%s: the prefix is injected and the new chat stays bound to the selected preset', async (label) => {
        restoreDevice = useDevice(DEVICES[label]);
        await openChat('/a/chat/s', [A], {});
        clickOption('preset-A');
        await settle();
        expect(shownValue(), 'sanity: the user selected preset A on the new-chat page').toBe('preset-A');

        const { ev, textarea } = pressEnterWith('hello from the desktop');
        const sentText = textarea.value;
        expect.soft(ev.defaultPrevented, 'Enter must be intercepted so the prefixed text is what gets sent').toBe(true);
        expect.soft(sentText, 'the selected preset content must be injected in front of the user text').toMatch(/PREFIX-A[\s\S]*hello from the desktop/);

        await navigateTo(`/a/chat/s/${NEW_CHAT}`);

        expect.soft(shownValue(), 'the overlay must still show preset A for the newly created chat, not reset to none').toBe('preset-A');
        expect.soft(storedMap()[NEW_CHAT], 'the new chat must be persisted as bound to preset A').toBe('preset-A');
        expect.soft(injected(), 'the next message in the new chat must still carry preset A').toContain('PREFIX-A');
    });
});
