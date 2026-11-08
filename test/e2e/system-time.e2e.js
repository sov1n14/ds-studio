import { test, expect } from './fixtures.js';
import { DEEPSEEK_ORIGIN } from './helpers/conversations.js';
import { closeExtensionPages, openPopup } from './helpers/popup.js';
import { createTestPreset, pickPreset, seedOnlyPreset } from './helpers/presets.js';
import { documentedPrompt, gotoWithOverlay, openBlockingSends, sendAndCapturePrompt } from './helpers/prompt-capture.js';

// System Time Injection (docs/FEATURES.md, System Time Injection; docs/spec/04-features.md section 19; docs/spec/01-prompt-system.md section 2).
// The time line `Current Time: yyyy/mm/dd hh:mm:ss (UTC±hh:mm)` comes before the <system-reminder> block, or before the <user-input> block when no group is picked.
// The dedupe of a leading "Current Time:" line (docs/FEATURES.md, System Time Injection, Duplicate Prevention; docs/spec/04-features.md section 19, Duplicate Injection Handling) has no E2E test here; test/unit/prompt-injector.system-time-dedupe.spec.js covers it.
// Each send happens on a freshly loaded page; every send request is aborted in the browser, and every touched storage key is restored after the test.

const USER_TEXT = 'e2e system time probe (aborted before it leaves the browser)';
const HOME = DEEPSEEK_ORIGIN + '/';
const TIME_LINE = /^Current Time: (\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2}) \(UTC([+-])(\d{2}):(\d{2})\)\n+/;
// The stamp has whole seconds, so a stamp taken during the send may read up to one second before the send started.
const CLOCK_SLACK_MS = 1_000;

/** Sends `text` and resolves the captured prompt with the wall-clock window (epoch ms) in which the send happened and the page's UTC offset in minutes. */
async function sendTimed(page, blocked, text) {
    const offsetMinutes = await page.evaluate(() => -new Date().getTimezoneOffset());
    const startedAt = Date.now();
    const prompt = await sendAndCapturePrompt(page, blocked, text);
    return { prompt, startedAt, endedAt: Date.now(), offsetMinutes };
}

/** Asserts that `prompt` opens with a documented time line for a moment inside the send window, in the page's timezone, and resolves the rest of the prompt. */
function expectTimeLine({ prompt, startedAt, endedAt, offsetMinutes }) {
    const match = TIME_LINE.exec(prompt);
    expect(match, `the prompt opens with "Current Time: yyyy/mm/dd hh:mm:ss (UTC±hh:mm)" on its own line; got ${JSON.stringify(prompt.slice(0, 80))}`).not.toBeNull();
    const [line, year, month, day, hour, minute, second, sign, offsetHours, offsetMins] = match;
    const statedOffset = (sign === '-' ? -1 : 1) * (Number(offsetHours) * 60 + Number(offsetMins));
    expect(statedOffset, 'the stated UTC offset is the local timezone offset').toBe(offsetMinutes);
    const stampedAt = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) - statedOffset * 60_000;
    expect(stampedAt, `the stated time ${line.trim()} is the moment of the send`).toBeGreaterThanOrEqual(startedAt - CLOCK_SLACK_MS);
    expect(stampedAt, `the stated time ${line.trim()} is the moment of the send`).toBeLessThanOrEqual(endedAt);
    return prompt.slice(line.length);
}

test.describe('system time injection', () => {
    test.beforeEach(async ({ settings }) => {
        await settings.set({ isEnabled: true, globalPromptEnabled: false });
    });

    test.afterEach(async ({ context }) => {
        await closeExtensionPages(context);
    });

    test('with the toggle on, the current time line comes first, before the user-input block and before the system-reminder block of a picked group', async ({ page, context, settings }) => {
        const group = createTestPreset('system-time');
        await seedOnlyPreset(settings, context, group);
        await settings.setInBothAreas({ dsShowSystemTime: true });

        const blocked = await openBlockingSends(page, HOME);
        const plain = await sendTimed(page, blocked, USER_TEXT);
        expect(expectTimeLine(plain), 'with no group picked the user-input block follows the time line').toBe(documentedPrompt({ text: USER_TEXT }));

        await gotoWithOverlay(page, HOME);
        await pickPreset(page, group);
        const grouped = await sendTimed(page, blocked, USER_TEXT);
        expect(expectTimeLine(grouped), 'with a group picked the system-reminder block follows the time line').toBe(documentedPrompt({ reminder: group.content, text: USER_TEXT }));
    });

    test('switching the toggle off in the popup sends the prompt with no time line', async ({ page, context, settings, extensionId }) => {
        await seedOnlyPreset(settings, context, createTestPreset('system-time-off'));
        await settings.setInBothAreas({ dsShowSystemTime: true });

        const blocked = await openBlockingSends(page, HOME);
        expectTimeLine(await sendTimed(page, blocked, USER_TEXT));

        const popup = await openPopup(context, extensionId);
        await expect(popup.locator('#showSystemTimeToggle'), 'the popup shows the toggle on (precondition)').toBeChecked();
        // The toggle is a plain checkbox with its own label in the Features card.
        await popup.locator('label[for="showSystemTimeToggle"]').click();
        await expect(popup.locator('#showSystemTimeToggle'), 'the popup toggle turns off').not.toBeChecked();
        await expect(async () => {
            await gotoWithOverlay(page, HOME);
            const prompt = await sendAndCapturePrompt(page, blocked, USER_TEXT);
            expect(prompt, 'with the toggle off the prompt starts with the user-input block, no time line').toBe(documentedPrompt({ text: USER_TEXT }));
        }).toPass({ timeout: 30_000 });
    });
});
