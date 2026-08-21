/**
 * Spec for popup/popup.markdown-export.js — the real module, loaded as a classic
 * script (window.__DS_PopupMarkdownExport.createMarkdownExportManager).
 *
 * Contract under test — clicking the export button:
 *   1. No DeepSeek tab (queryActiveDeepseekTab resolves null) -> a modal explains
 *      it and NOTHING is sent; sending to a non-DeepSeek tab is the failure mode
 *      this guard exists for.
 *   2. A DeepSeek tab that acknowledges ({received:true}) -> silent success, no toast.
 *   3. A DeepSeek tab whose content script is not injected -> sendToTab resolves
 *      undefined (no receiving end), and the user is told to refresh. This is the
 *      whole point of the ack: chrome.tabs.sendMessage does not reject loudly here.
 *
 * DSSTabControl is stubbed (chrome.tabs cannot serve a real DeepSeek tab under
 * happy-dom); Modal and Toast arrive through ctx and are stubbed there. What is
 * asserted is the resulting user-visible outcome and the message actually put on
 * the wire, not a call sequence.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { evalPopupScript } from '../helpers/popup-script-loader.js';

const TAB = { id: 42, url: 'https://chat.deepseek.com/a/chat/s/abc' };

beforeAll(() => {
    evalPopupScript('popup/popup.markdown-export.js');
    if (typeof window.__DS_PopupMarkdownExport?.createMarkdownExportManager !== 'function') {
        throw new Error('createMarkdownExportManager was not exposed on window.__DS_PopupMarkdownExport');
    }
});

let ctx;
let queryActiveDeepseekTab;
let sendToTab;

beforeEach(() => {
    queryActiveDeepseekTab = vi.fn().mockResolvedValue(TAB);
    sendToTab = vi.fn().mockResolvedValue({ received: true });
    globalThis.DSSTabControl = { queryActiveDeepseekTab, sendToTab };
    ctx = {
        Modal: { confirm: vi.fn().mockResolvedValue(true) },
        Toast: { show: vi.fn() },
    };
});

const makeCheckbox = (checked) => {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.checked = checked;
    return el;
};

/** Binds a fresh button, clicks it, and waits for the async handler to settle. */
async function clickExport({ thinking, references } = {}) {
    const btn = document.createElement('button');
    window.__DS_PopupMarkdownExport
        .createMarkdownExportManager(ctx)
        .bindExportButton(
            btn,
            thinking === undefined ? null : makeCheckbox(thinking),
            references === undefined ? null : makeCheckbox(references),
        );
    btn.click();
    await new Promise((r) => setTimeout(r, 0));
    return btn;
}

describe('createMarkdownExportManager — bindExportButton', () => {
    it('no active DeepSeek tab: shows a modal and sends nothing', async () => {
        queryActiveDeepseekTab.mockResolvedValue(null);

        await clickExport();

        expect(ctx.Modal.confirm).toHaveBeenCalledOnce();
        expect(sendToTab).not.toHaveBeenCalled();
        expect(ctx.Toast.show).not.toHaveBeenCalled();
    });

    it('tab acknowledges the export: no toast, no modal', async () => {
        await clickExport();

        expect(ctx.Toast.show).not.toHaveBeenCalled();
        expect(ctx.Modal.confirm).not.toHaveBeenCalled();
    });

    it('sends the EXPORT_MARKDOWN request to the resolved tab with the toggle states', async () => {
        await clickExport({ thinking: false, references: true });

        expect(sendToTab).toHaveBeenCalledWith(TAB.id, {
            action: 'EXPORT_MARKDOWN',
            includeThinking: false,
            includeReferences: true,
        });
    });

    it('absent toggle elements default both options to true', async () => {
        await clickExport();

        expect(sendToTab.mock.calls[0][1]).toMatchObject({
            includeThinking: true,
            includeReferences: true,
        });
    });

    it('no receiving end (sendToTab resolves undefined): shows the refresh toast', async () => {
        sendToTab.mockResolvedValue(undefined);

        await clickExport();

        expect(ctx.Toast.show).toHaveBeenCalledOnce();
        expect(ctx.Toast.show).toHaveBeenCalledWith(dsI18n.t('exportFailedRefreshToast'));
    });

    it('a null button binds nothing and does not throw', () => {
        const manager = window.__DS_PopupMarkdownExport.createMarkdownExportManager(ctx);
        expect(() => manager.bindExportButton(null)).not.toThrow();
    });
});
