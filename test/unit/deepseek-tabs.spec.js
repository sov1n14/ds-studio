/**
 * background/deepseek-tabs.js — the one "which chat uuids do the open DeepSeek tabs show" query behind the pending-delete sweep and the unload grace timer.
 *
 * Contract: DSSDeepSeekTabs.listShownChatUuids() resolves a Set of the chat uuids (the id in /a/chat/s/<id>) shown by tabs that match DSS_TAB_URL; tabs on other hosts, tabs on non-chat pages and tabs without a url add nothing, two tabs on one chat add it once. The query is fail-open: a rejected or synchronously throwing chrome.tabs.query, or an answer that is not a list, resolves an empty Set so a deletion is never blocked by a tab lookup. The tab filter is the value of DSS_TAB_URL at call time and the id is read by DSSChatSessionId, so neither can drift from its owner; with either missing the call rejects with an error naming the file to load.
 *
 * Trust boundary: chrome.tabs.query (the fake in test/helpers/fake-chrome-tabs.js honors the url filter as Chrome does); everything else is real.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import '../../utils/chat-session-id.js';
import '../../background/deepseek-tabs.js';
import { installFakeTabs } from '../helpers/fake-chrome-tabs.js';

const ORIGIN = 'https://chat.deepseek.com';
const tab = (id, url) => ({ id, windowId: 1, active: false, url });
let fake;

afterEach(() => {
    fake?.restore();
    fake = undefined;
    vi.restoreAllMocks();
});

const list = () => globalThis.DSSDeepSeekTabs.listShownChatUuids();

describe('DSSDeepSeekTabs.listShownChatUuids', () => {
    it('resolves the uuids of DeepSeek tabs on a chat and ignores home pages and other hosts', async () => {
        fake = installFakeTabs([
            tab(1, `${ORIGIN}/a/chat/s/aaaa-1111`),
            tab(2, `${ORIGIN}/a/chat/s/bbbb-2222?ref=x`),
            tab(3, `${ORIGIN}/`),
            tab(4, 'https://example.com/a/chat/s/cccc-3333'),
        ]);
        expect([...await list()].sort()).toEqual(['aaaa-1111', 'bbbb-2222']);
    });

    it('lists a chat once when two tabs show it', async () => {
        fake = installFakeTabs([tab(1, `${ORIGIN}/a/chat/s/aaaa-1111`), tab(2, `${ORIGIN}/a/chat/s/aaaa-1111`)]);
        expect([...await list()]).toEqual(['aaaa-1111']);
    });

    it('ignores a tab without a url instead of reading the page location of the caller', async () => {
        window.history.pushState({}, '', '/a/chat/s/ffff-9999');
        chrome.tabs.query = async () => [{ id: 1 }, tab(2, `${ORIGIN}/a/chat/s/aaaa-1111`)];
        try {
            expect([...await list()]).toEqual(['aaaa-1111']);
        } finally {
            window.history.pushState({}, '', '/');
        }
    });

    it('resolves an empty Set when the tab query rejects, throws synchronously or answers a non-list', async () => {
        const original = chrome.tabs.query;
        try {
            chrome.tabs.query = () => Promise.reject(new Error('tabs unavailable'));
            expect((await list()).size).toBe(0);
            chrome.tabs.query = () => { throw new Error('sync boom'); };
            expect((await list()).size).toBe(0);
            chrome.tabs.query = async () => undefined;
            expect((await list()).size).toBe(0);
            chrome.tabs.query = async () => null;
            expect((await list()).size).toBe(0);
        } finally {
            chrome.tabs.query = original;
        }
    });

    it('asks for the tabs matching the current value of DSS_TAB_URL', async () => {
        const savedPattern = globalThis.DSS_TAB_URL;
        globalThis.DSS_TAB_URL = '*://chat.example.org/*';
        fake = installFakeTabs([tab(1, `${ORIGIN}/a/chat/s/aaaa-1111`), tab(2, 'https://chat.example.org/a/chat/s/dddd-4444')]);
        try {
            expect([...await list()]).toEqual(['dddd-4444']);
        } finally {
            globalThis.DSS_TAB_URL = savedPattern;
        }
    });

    it.each([
        ['DSS_TAB_URL', 'utils/message-constants.js'],
        ['DSSChatSessionId', 'utils/chat-session-id.js'],
    ])('rejects with an error naming %s\'s file when it is not loaded', async (globalName, file) => {
        const saved = globalThis[globalName];
        delete globalThis[globalName];
        try {
            await expect(list()).rejects.toThrow(file);
        } finally {
            globalThis[globalName] = saved;
        }
    });
});
