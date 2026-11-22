import { test, expect } from './fixtures.js';
import { DSSelectors } from './helpers/selectors.js';

// "Hide Thinking Process" (`dsHideThinking`) collapses every mounted thinking block through DeepSeek's own toggle, which unmounts the thinking body (`.ds-think-content`); turning it off expands them again.

/** Counts mounted thinking blocks and mounted thinking bodies; a collapsed block keeps its header but no body. */
function readThinkState(page) {
    return page.evaluate(({ block, content }) => ({
        blocks: document.querySelectorAll(block).length,
        bodies: document.querySelectorAll(content).length,
    }), { block: DSSelectors.THINK_BLOCK_SELECTOR, content: DSSelectors.THINK_CONTENT_SELECTOR });
}

// The recording's conversation with a search reply and the one with the most thinking replies (they may be the same conversation).
const cases = [
    { name: 'thinking with web search', role: 'withSearch' },
    { name: 'most replies with thinking', role: 'withThinking' },
];

test.describe('hide thinking process', { tag: '@offline' }, () => {
    for (const { name, role } of cases) {
        test(`collapses every thinking block when on and expands them when off (${name})`, async ({ page, settings, openRecorded }) => {
            await settings.set({ isEnabled: true, dsHideThinking: false });
            await openRecorded(role);

            // Baseline: bodies are mounted, otherwise "no body after enabling" would prove nothing.
            await expect.poll(async () => {
                const state = await readThinkState(page);
                return { hasBlocks: state.blocks > 0, hasBodies: state.bodies > 0 };
            }, { message: 'thinking blocks show mounted bodies before enabling' })
                .toEqual({ hasBlocks: true, hasBodies: true });

            await settings.set({ dsHideThinking: true });
            await expect.poll(async () => {
                const state = await readThinkState(page);
                return { hasBlocks: state.blocks > 0, bodies: state.bodies };
            }, { message: 'thinking blocks stay mounted while no thinking body remains mounted' })
                .toEqual({ hasBlocks: true, bodies: 0 });

            await settings.set({ dsHideThinking: false });
            await expect.poll(async () => {
                const state = await readThinkState(page);
                return { hasBlocks: state.blocks > 0, hasBodies: state.bodies > 0 };
            }, { message: 'thinking bodies are mounted again after disabling' })
                .toEqual({ hasBlocks: true, hasBodies: true });
        });
    }
});
