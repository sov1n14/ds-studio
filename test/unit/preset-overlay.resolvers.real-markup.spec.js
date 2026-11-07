/**
 * resolveNewChatButtonEl against real DeepSeek header markup.
 *
 * Fixture: test/fixtures/ds-snapshots/mobile-ua-home-header.html, the chat header container
 * captured verbatim from the live page under a mobile user agent on the home page. That header
 * row holds, in DOM order: sidebar toggle button, title, spacers, the "download app" pill
 * (a role="button" inside a wrapper div), a spacer, and the real new-chat button (last child).
 *
 * Required behaviour: the resolver returns the new-chat button, never the download-app pill,
 * including when the new-chat button has lost its inline `min-width: 44px` style (the fallback
 * path exists for exactly that upstream change).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import '../../content/ds-selectors.js';

const { resolveNewChatButtonEl } = require('../../content/preset-overlay.resolvers.js');

const FIXTURE = path.resolve(__dirname, '../fixtures/ds-snapshots/mobile-ua-home-header.html');

function mountMobileHomeHeader() {
    document.body.innerHTML = fs.readFileSync(FIXTURE, 'utf8');
    const container = document.body.firstElementChild;
    const headerRow = container.lastElementChild;
    const newChatButton = headerRow.lastElementChild;
    const downloadPill = [...headerRow.querySelectorAll('[role="button"]')]
        .find((el) => el.textContent.trim() === '下载应用');
    return { container, newChatButton, downloadPill };
}

describe('resolveNewChatButtonEl — real mobile-UA home header', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('fixture sanity: the header holds both the new-chat button and the download-app pill', () => {
        const { newChatButton, downloadPill } = mountMobileHomeHeader();
        expect(newChatButton.getAttribute('role')).toBe('button');
        expect(downloadPill).toBeTruthy();
        expect(downloadPill).not.toBe(newChatButton);
    });

    it('control: returns the new-chat button when it carries its live inline min-width style', () => {
        const { container, newChatButton } = mountMobileHomeHeader();
        expect(resolveNewChatButtonEl(container).el).toBe(newChatButton);
    });

    it('returns the new-chat button, not the download-app pill, when the inline min-width style is absent', () => {
        const { container, newChatButton, downloadPill } = mountMobileHomeHeader();
        newChatButton.removeAttribute('style');

        const { el } = resolveNewChatButtonEl(container);

        expect(el, 'resolver picked the download-app pill instead of the new-chat button').not.toBe(downloadPill);
        expect(el).toBe(newChatButton);
    });
});
