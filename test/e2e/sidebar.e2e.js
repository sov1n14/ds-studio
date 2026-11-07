import { test, expect } from './fixtures.js';
import { expectNeverWithin } from './helpers/observation.js';
import {
    SIDEBAR_STATE_ARG,
    collapseSidebarNatively,
    isPanelShownInPage,
    moveMouseAwayFromSidebar,
    moveMouseOntoSidebar,
    readSidebar,
    setNativeSidebar,
} from './helpers/sidebar.js';

// Sidebar auto-hide (`dsSidebarAutoHide`): the expanded sidebar shrinks to 60px while the mouse is elsewhere and widens on hover; off restores the native width.
// Auto-open sidebar (`isAutoOpenSidebarEnabled`): whenever DeepSeek collapses its sidebar, the extension opens it again; off leaves a collapsed sidebar collapsed.
// Both specs measure what DeepSeek renders (wrapper width, whether the chat-list panel is shown) and leave the sidebar as they found it.

const AUTO_HIDDEN_WIDTH = 60;
const PX_TOLERANCE = 1;
// Auto-open reacts in the same mutation batch as the collapse; 2 s also exceeds its documented 1.5 s re-collapse window.
const STAYS_COLLAPSED_WINDOW_MS = 2_000;

const BOTH_OFF = { dsSidebarAutoHide: false, isAutoOpenSidebarEnabled: false };

async function sidebarWidth(page) {
    return (await readSidebar(page))?.width ?? null;
}

async function panelShown(page) {
    return (await readSidebar(page))?.panelShown ?? null;
}

async function expectAutoHidden(page, message) {
    await expect.poll(async () => Math.abs((await sidebarWidth(page)) - AUTO_HIDDEN_WIDTH) <= PX_TOLERANCE, { message }).toBe(true);
}

async function expectWidthAtLeast(page, minimum, message) {
    await expect.poll(() => sidebarWidth(page), { message }).toBeGreaterThanOrEqual(minimum);
}

/**
 * Records whether the panel was shown before the test body and restores that afterwards with both features off; a body failure is never masked by a restoration failure.
 * The page is reloaded first, because a click that lands while DeepSeek is still animating can leave its sidebar markup half-collapsed until the next load.
 */
async function withSidebarRestored(page, settings, body) {
    await expect.poll(() => readSidebar(page), { message: 'DeepSeek sidebar is rendered' }).not.toBeNull();
    const wasShown = (await readSidebar(page)).panelShown;
    let bodyError = null;
    try {
        await body();
    } catch (error) {
        bodyError = error;
    }
    try {
        await settings.set(BOTH_OFF);
        await page.reload();
        await expect.poll(() => readSidebar(page), { message: 'DeepSeek sidebar is rendered after reload' }).not.toBeNull();
        await moveMouseAwayFromSidebar(page);
        await setNativeSidebar(page, !wasShown);
    } catch (restoreError) {
        if (!bodyError) throw restoreError;
    }
    if (bodyError) throw bodyError;
}

test.describe('sidebar', () => {
    test('auto-hide shrinks the expanded sidebar to 60px, widens it on hover, and off restores the native width', async ({ page, settings }) => {
        await settings.set({ isEnabled: true, ...BOTH_OFF });
        await withSidebarRestored(page, settings, async () => {
            await moveMouseAwayFromSidebar(page);
            await setNativeSidebar(page, false);
            await expectWidthAtLeast(page, AUTO_HIDDEN_WIDTH * 3, 'the natively expanded sidebar is far wider than 60px (precondition)');
            const nativeWidth = await sidebarWidth(page);

            await settings.set({ dsSidebarAutoHide: true });
            await expectAutoHidden(page, 'auto-hide shrinks the sidebar to 60px while the mouse is elsewhere');

            await moveMouseOntoSidebar(page);
            await expectWidthAtLeast(page, nativeWidth - PX_TOLERANCE, 'hovering the sidebar widens it back to its native width');

            await moveMouseAwayFromSidebar(page);
            await expectAutoHidden(page, 'leaving the sidebar shrinks it to 60px again');

            await settings.set({ dsSidebarAutoHide: false });
            await expectWidthAtLeast(page, nativeWidth - PX_TOLERANCE, 'turning auto-hide off restores the native width with the mouse elsewhere');
        });
    });

    test('auto-open shows a collapsed sidebar again, off leaves a collapsed sidebar collapsed, and on again re-opens it', async ({ page, settings }) => {
        await settings.set({ isEnabled: true, ...BOTH_OFF });
        await withSidebarRestored(page, settings, async () => {
            await setNativeSidebar(page, true);
            expect(await panelShown(page), 'the sidebar panel is hidden before auto-open turns on (precondition)').toBe(false);

            await settings.set({ isAutoOpenSidebarEnabled: true });
            await expect.poll(() => panelShown(page), { message: 'auto-open shows the collapsed sidebar again' }).toBe(true);

            await settings.set({ isAutoOpenSidebarEnabled: false });
            await collapseSidebarNatively(page);
            await expect.poll(() => panelShown(page), { message: 'the user collapses the sidebar with auto-open off' }).toBe(false);
            await expectNeverWithin(page, isPanelShownInPage, SIDEBAR_STATE_ARG, STAYS_COLLAPSED_WINDOW_MS, 'with auto-open off the collapsed sidebar must stay collapsed');

            await settings.set({ isAutoOpenSidebarEnabled: true });
            await expect.poll(() => panelShown(page), { message: 'turning auto-open back on shows the sidebar again' }).toBe(true);
        });
    });
});
