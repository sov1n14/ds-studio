/**
 * content/chat-session-id.js — shared chat-session-id extraction contract.
 *
 * Contract source (the four duplicate implementations this helper replaces, all
 * using the same regex `/\/a\/chat\/s\/([a-f0-9-]+)/` and the same
 * `match ? match[1] : null` shape):
 *   - content/censor-reply-restore.js:50-52           (_checkSessionChange)
 *   - content/censor-reply-restore.dom.js:103-105     (_resolveMessageIdFromStorage)
 *   - content/content-script.js:167-170               (extractUuidFromUrl)
 *   - content/temporary-chat-delete.tracking.js:82-86 (extractUuidFromUrl — the
 *     only copy that already accepts an optional argument, defaulting to
 *     window.location.pathname; the other three read the pathname directly)
 *
 * Requirement: publish `globalThis.DSSChatSessionId.extractChatSessionId(input)`
 * where `input` may be a pathname or a full URL and is optional (defaults to the
 * current location pathname). Returns the captured id string, or null when the
 * pattern is absent. Classic script; the global assignment is its only load-time
 * effect.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import '../../content/chat-session-id.js';
import { setPathname } from '../helpers/set-pathname.js';

const SESSION_ID = '0e6c3f1a-8b2d-4e57-9a10-77cbe4d5f001';

let extractChatSessionId;

beforeEach(() => {
    extractChatSessionId = globalThis.DSSChatSessionId.extractChatSessionId;
    setPathname('/');
});

describe('content/chat-session-id.js — module surface', () => {
    it('publishes extractChatSessionId on globalThis.DSSChatSessionId', () => {
        expect(globalThis.DSSChatSessionId).toBeTypeOf('object');
        expect(globalThis.DSSChatSessionId.extractChatSessionId).toBeTypeOf('function');
    });
});

describe('extractChatSessionId(input) — explicit input', () => {
    it('extracts the id from a bare pathname', () => {
        expect(extractChatSessionId(`/a/chat/s/${SESSION_ID}`)).toBe(SESSION_ID);
    });

    it('extracts the id from a full URL', () => {
        expect(extractChatSessionId(`https://chat.deepseek.com/a/chat/s/${SESSION_ID}`)).toBe(SESSION_ID);
    });

    it('stops at a query string', () => {
        expect(extractChatSessionId(`/a/chat/s/${SESSION_ID}?foo=bar`)).toBe(SESSION_ID);
    });

    it('stops at a hash fragment', () => {
        expect(extractChatSessionId(`/a/chat/s/${SESSION_ID}#anchor`)).toBe(SESSION_ID);
    });

    it('stops at a trailing path segment', () => {
        expect(extractChatSessionId(`/a/chat/s/${SESSION_ID}/detail`)).toBe(SESSION_ID);
    });

    it('returns null for the DeepSeek homepage', () => {
        expect(extractChatSessionId('/')).toBeNull();
    });

    it('returns null for a session route with no id', () => {
        expect(extractChatSessionId('/a/chat/s/')).toBeNull();
    });

    it('returns null for a different DeepSeek route', () => {
        expect(extractChatSessionId('/a/settings/profile')).toBeNull();
    });

    it('greedily captures the leading lowercase-hex run of an uppercase id — inherited quirk, not endorsed', () => {
        // The capture is unanchored, so a mixed-case id yields a partial capture rather than null.
        expect(extractChatSessionId(`/a/chat/s/${SESSION_ID.toUpperCase()}`)).toBe('0');
    });

    it('returns null for an empty string without falling back to the current location', () => {
        setPathname(`/a/chat/s/${SESSION_ID}`);
        expect(extractChatSessionId('')).toBeNull();
    });
});

describe('extractChatSessionId() — default input is the current pathname', () => {
    it('reads the id from window.location.pathname when called with no argument', () => {
        setPathname(`/a/chat/s/${SESSION_ID}`);
        expect(extractChatSessionId()).toBe(SESSION_ID);
    });

    it('returns null when the current pathname is not a chat session', () => {
        setPathname('/a/chat/history');
        expect(extractChatSessionId()).toBeNull();
    });

    it('treats an explicitly passed undefined the same as no argument', () => {
        setPathname(`/a/chat/s/${SESSION_ID}`);
        expect(extractChatSessionId(undefined)).toBe(SESSION_ID);
    });

    it('re-reads the location on every call rather than caching the first result', () => {
        setPathname(`/a/chat/s/${SESSION_ID}`);
        expect(extractChatSessionId()).toBe(SESSION_ID);

        const other = 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb';
        setPathname(`/a/chat/s/${other}`);
        expect(extractChatSessionId()).toBe(other);

        setPathname('/');
        expect(extractChatSessionId()).toBeNull();
    });
});
