import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import CensorReplyRestore from '../../content/censor-reply-restore.js';
import { resetCensorReplyRestore, buildChatPair } from '../helpers/censor-reply-restore-fixtures.js';

/**
 * Session-change clearing rules, null-session strictness, SPA cross-chat
 * contamination guards, and _onFragmentComplete intake filtering.
 *
 * Split out of the original censor-reply-restore.spec.js monolith; every case
 * below is the unchanged original assertion set.
 */
describe('CensorReplyRestore — session switching and fragment intake', () => {
    beforeEach(resetCensorReplyRestore);

    describe('Null-session strictness', () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('_resolveMessageIdFromStorage returns null when URL has no session id', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/some/other/path');
            document.body.innerHTML = '';
            const msgEl = buildChatPair('asst-ns1', 'a prompt');
            CensorReplyRestore._restoredMessages = {
                'nosession::10': {
                    message_id: 10, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'null-session data' }],
                    chat_session_id: null,
                    prompt_key: 'a prompt',
                    restored_at: 100
                }
            };

            const result = CensorReplyRestore._resolveMessageIdFromStorage(msgEl);
            expect(result).toBeNull();
        });

        it('_tryRestoreFromStoredRecords does not inject when current URL has no session id', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/some/other/path');
            document.body.innerHTML = '';
            buildChatPair('asst-ns2', 'a prompt');
            CensorReplyRestore._restoredMessages = {
                'nosession::20': {
                    message_id: 20, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'should not inject' }],
                    chat_session_id: null,
                    prompt_key: 'a prompt',
                    restored_at: 100
                }
            };

            const result = CensorReplyRestore._tryRestoreFromStoredRecords();
            expect(result).toBe(false);
            const msgEl = document.querySelector('.ds-message._63c77b1');
            expect(msgEl.querySelector('.restored-content')).toBeNull();
        });
    });

    describe('_checkSessionChange() — clearing rules', () => {
        it('(a) null → non-null: preserves _pendingQueue and _keyToMessageId, updates _currentSessionId', () => {
            // All session IDs must match /[a-f0-9-]+/ (hex chars and dash only)
            const NEW_SESSION = 'a0000001-0000-0000-0000-000000000001';
            CensorReplyRestore._currentSessionId = null;
            CensorReplyRestore._pendingQueue = [10, 20];
            CensorReplyRestore._keyToMessageId.set('k1', 10);
            CensorReplyRestore._hasStoredRecordsApplied = true;

            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/' + NEW_SESSION);
            CensorReplyRestore._checkSessionChange();

            expect(CensorReplyRestore._currentSessionId).toBe(NEW_SESSION);
            // Queue and map must be preserved (first message may already be in queue)
            expect(CensorReplyRestore._pendingQueue).toEqual([10, 20]);
            expect(CensorReplyRestore._keyToMessageId.size).toBe(1);
            // _hasStoredRecordsApplied is NOT reset on null→non-null
            expect(CensorReplyRestore._hasStoredRecordsApplied).toBe(true);

            vi.restoreAllMocks();
        });

        it('(b) non-null → different non-null: clears _pendingQueue, _keyToMessageId, and resets _hasStoredRecordsApplied', () => {
            const OLD_SESSION = 'b0000001-0000-0000-0000-000000000001';
            const DIFF_SESSION = 'b0000002-0000-0000-0000-000000000002';
            CensorReplyRestore._currentSessionId = OLD_SESSION;
            CensorReplyRestore._pendingQueue = [5, 6];
            CensorReplyRestore._keyToMessageId.set('k2', 5);
            CensorReplyRestore._hasStoredRecordsApplied = true;

            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/' + DIFF_SESSION);
            CensorReplyRestore._checkSessionChange();

            expect(CensorReplyRestore._currentSessionId).toBe(DIFF_SESSION);
            expect(CensorReplyRestore._pendingQueue).toHaveLength(0);
            expect(CensorReplyRestore._keyToMessageId.size).toBe(0);
            expect(CensorReplyRestore._hasStoredRecordsApplied).toBe(false);

            vi.restoreAllMocks();
        });

        it('(c) non-null → null (navigated away from chat): clears runtime state', () => {
            const SOME_SESSION = 'c0000001-0000-0000-0000-000000000001';
            CensorReplyRestore._currentSessionId = SOME_SESSION;
            CensorReplyRestore._pendingQueue = [7];
            CensorReplyRestore._keyToMessageId.set('k3', 7);
            CensorReplyRestore._hasStoredRecordsApplied = true;

            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/some/other/page');
            CensorReplyRestore._checkSessionChange();

            expect(CensorReplyRestore._currentSessionId).toBeNull();
            expect(CensorReplyRestore._pendingQueue).toHaveLength(0);
            expect(CensorReplyRestore._keyToMessageId.size).toBe(0);
            expect(CensorReplyRestore._hasStoredRecordsApplied).toBe(false);

            vi.restoreAllMocks();
        });

        it('(d) same session → no-op: nothing is cleared', () => {
            const STABLE_SESSION = 'd0000001-0000-0000-0000-000000000001';
            CensorReplyRestore._currentSessionId = STABLE_SESSION;
            CensorReplyRestore._pendingQueue = [1, 2, 3];
            CensorReplyRestore._keyToMessageId.set('k4', 1);
            CensorReplyRestore._hasStoredRecordsApplied = true;

            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/' + STABLE_SESSION);
            CensorReplyRestore._checkSessionChange();

            expect(CensorReplyRestore._currentSessionId).toBe(STABLE_SESSION);
            expect(CensorReplyRestore._pendingQueue).toEqual([1, 2, 3]);
            expect(CensorReplyRestore._keyToMessageId.size).toBe(1);
            expect(CensorReplyRestore._hasStoredRecordsApplied).toBe(true);

            vi.restoreAllMocks();
        });
    });

    describe('SPA contamination regression: chat switch must not inject stale content', () => {
        const SESSION_A = 'aaaa0001-0000-0000-0000-000000000001';
        const SESSION_B = 'bbbb0002-0000-0000-0000-000000000002';

        afterEach(() => {
            vi.restoreAllMocks();
            document.body.innerHTML = '';
        });

        it('after switching from chat A to chat B, censored element with same virtual key must NOT get chat A content', () => {
            // Step 1: Chat A — restore message_id=2 (map entry set, record stored under A)
            CensorReplyRestore._currentSessionId = SESSION_A;
            CensorReplyRestore._keyToMessageId.set('2', 2);
            CensorReplyRestore._restoredMessages[SESSION_A + '::2'] = {
                message_id: 2, censored: true,
                fragments: [{ type: 'RESPONSE', content: 'Chat A content for message 2' }],
                chat_session_id: SESSION_A,
                prompt_key: 'chat A question',
                restored_at: 100
            };
            CensorReplyRestore._hasStoredRecordsApplied = true;

            // Step 2: URL changes to chat B — simulate _checkSessionChange
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/' + SESSION_B);
            CensorReplyRestore._checkSessionChange();

            // Verify runtime state was cleared
            expect(CensorReplyRestore._keyToMessageId.size).toBe(0);
            expect(CensorReplyRestore._pendingQueue).toHaveLength(0);
            expect(CensorReplyRestore._hasStoredRecordsApplied).toBe(false);
            expect(CensorReplyRestore._currentSessionId).toBe(SESSION_B);

            // Step 3: Build chat B DOM with same virtual-item-key "2" and a different prompt
            document.body.innerHTML = '';
            buildChatPair('2', 'chat B question');

            // Step 4: Attempt restore — chat B record does NOT exist, so nothing should be injected
            const msgEl = document.querySelector('.ds-message._63c77b1');
            CensorReplyRestore.enabled = true;
            CensorReplyRestore._tryRestoreMessage(msgEl);

            expect(msgEl.querySelector('.restored-content')).toBeNull();
        });

        it('after switch, a censored element whose prompt does not match any chat B record must not be injected', () => {
            // Only chat A record exists for a given prompt
            CensorReplyRestore._currentSessionId = SESSION_A;
            CensorReplyRestore._restoredMessages[SESSION_A + '::5'] = {
                message_id: 5, censored: true,
                fragments: [{ type: 'RESPONSE', content: 'Chat A only' }],
                chat_session_id: SESSION_A,
                prompt_key: 'only in A',
                restored_at: 100
            };

            // Switch to chat B
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/' + SESSION_B);
            CensorReplyRestore._checkSessionChange();

            document.body.innerHTML = '';
            // In chat B, we have a censored element with a prompt that matches chat A's prompt
            buildChatPair('asst-chatb', 'only in A');

            const msgEl = document.querySelector('.ds-message._63c77b1');
            CensorReplyRestore.enabled = true;
            CensorReplyRestore._tryRestoreMessage(msgEl);

            // Must NOT inject chat A's content into chat B
            expect(msgEl.querySelector('.restored-content')).toBeNull();
        });
    });

    describe('_onFragmentComplete() — censored flag filtering', () => {
        it('receives censored: false payload — does NOT modify _pendingQueue or _restoredMessages', () => {
            CensorReplyRestore.enabled = true;
            const initialQueueLength = CensorReplyRestore._pendingQueue.length;
            const initialRestoredCount = Object.keys(CensorReplyRestore._restoredMessages).length;

            CensorReplyRestore._onFragmentComplete({
                messageId: 100,
                fragments: [{ type: 'RESPONSE', content: 'uncensored response' }],
                thinkingElapsedSecs: 0,
                censored: false
            });

            expect(CensorReplyRestore._pendingQueue).toHaveLength(initialQueueLength);
            expect(Object.keys(CensorReplyRestore._restoredMessages)).toHaveLength(initialRestoredCount);
        });

        it('receives censored: true payload — adds messageId to queue and saves record with censored: true', () => {
            CensorReplyRestore.enabled = true;
            CensorReplyRestore._pendingQueue = [];
            CensorReplyRestore._restoredMessages = {};

            CensorReplyRestore._onFragmentComplete({
                messageId: 42,
                fragments: [{ type: 'THINK', content: 'thinking' }, { type: 'RESPONSE', content: 'censored response' }],
                thinkingElapsedSecs: 1.5,
                censored: true
            });

            expect(CensorReplyRestore._pendingQueue).toContain(42);
            // No chatSessionId provided → stored under 'nosession::42' (session-scoped key scheme)
            expect(CensorReplyRestore._restoredMessages['nosession::42']).toBeDefined();
            expect(CensorReplyRestore._restoredMessages['nosession::42'].censored).toBe(true);
            expect(CensorReplyRestore._restoredMessages['nosession::42'].fragments[0].type).toBe('THINK');
        });

        it('passes chatSessionId and promptText into _saveFragment', () => {
            CensorReplyRestore.enabled = true;
            CensorReplyRestore._pendingQueue = [];
            CensorReplyRestore._restoredMessages = {};

            CensorReplyRestore._onFragmentComplete({
                messageId: 77,
                fragments: [{ type: 'RESPONSE', content: 'test' }],
                thinkingElapsedSecs: 0,
                censored: true,
                chatSessionId: 'session-123',
                promptText: 'Hello world'
            });

            // chatSessionId='session-123' → stored under 'session-123::77' (session-scoped key scheme)
            expect(CensorReplyRestore._restoredMessages['session-123::77']).toBeDefined();
            expect(CensorReplyRestore._restoredMessages['session-123::77'].chat_session_id).toBe('session-123');
            expect(CensorReplyRestore._restoredMessages['session-123::77'].prompt_key).toBe('Hello world');
        });
    });

    describe('End-to-end: censored vs. non-censored contamination', () => {
        it('sequence: non-censored fragment → censored fragment — only censored appears in restored messages', () => {
            CensorReplyRestore.enabled = true;
            CensorReplyRestore._pendingQueue = [];
            CensorReplyRestore._restoredMessages = {};

            // Fragment 1: censored: false
            CensorReplyRestore._onFragmentComplete({
                messageId: 200,
                fragments: [{ type: 'RESPONSE', content: 'This is safe content' }],
                thinkingElapsedSecs: 0,
                censored: false
            });

            expect(CensorReplyRestore._pendingQueue).toHaveLength(0);
            expect(CensorReplyRestore._restoredMessages['200']).toBeUndefined();

            // Fragment 2: censored: true
            CensorReplyRestore._onFragmentComplete({
                messageId: 201,
                fragments: [{ type: 'RESPONSE', content: 'This is censored content' }],
                thinkingElapsedSecs: 0,
                censored: true
            });

            expect(CensorReplyRestore._pendingQueue).toContain(201);
            // No chatSessionId → stored under 'nosession::201' (session-scoped key scheme)
            expect(CensorReplyRestore._restoredMessages['nosession::201']).toBeDefined();
            expect(CensorReplyRestore._restoredMessages['nosession::201'].censored).toBe(true);
            expect(CensorReplyRestore._restoredMessages['200']).toBeUndefined();
            expect(CensorReplyRestore._restoredMessages['nosession::200']).toBeUndefined();
        });
    });

    describe('clearAllRestoredMessages()', () => {
        it('clears _restoredMessages in memory and sets storage to empty object', () => {
            CensorReplyRestore._restoredMessages = {
                '5': { message_id: 5, censored: true, fragments: [] }
            };
            CensorReplyRestore._keyToMessageId.set('vkey_5', 5);

            CensorReplyRestore.clearAllRestoredMessages();

            expect(CensorReplyRestore._restoredMessages).toEqual({});
            expect(CensorReplyRestore._keyToMessageId.size).toBe(0);
        });
    });

    describe('Live-XHR happy path with session scoping', () => {
        const SESSION = 'aabb0001-0000-0000-0000-000000000001';

        afterEach(() => {
            vi.restoreAllMocks();
            document.body.innerHTML = '';
        });

        it('fragment complete with matching chatSessionId saves and allows restore of censored element', async () => {
            CensorReplyRestore.enabled = true;
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/' + SESSION);

            // Simulate _checkSessionChange acquiring session
            CensorReplyRestore._checkSessionChange();
            expect(CensorReplyRestore._currentSessionId).toBe(SESSION);

            // Fire live fragment
            CensorReplyRestore._onFragmentComplete({
                messageId: 300,
                fragments: [{ type: 'RESPONSE', content: 'live XHR content' }],
                thinkingElapsedSecs: 0,
                censored: true,
                chatSessionId: SESSION,
                promptText: 'live question'
            });

            // Record must be saved under session-scoped key
            const key = SESSION + '::300';
            expect(CensorReplyRestore._restoredMessages[key]).toBeDefined();
            expect(CensorReplyRestore._restoredMessages[key].chat_session_id).toBe(SESSION);
            expect(CensorReplyRestore._restoredMessages[key].fragments[0].content).toBe('live XHR content');

            // Build censored DOM element and restore it
            document.body.innerHTML = '';
            buildChatPair('asst-live', 'live question');
            const msgEl = document.querySelector('.ds-message._63c77b1');

            // _pendingQueue has [300] from _onFragmentComplete
            expect(CensorReplyRestore._pendingQueue).toContain(300);

            // Attempt restore via _tryRestoreMessage (uses queue path → record lookup via session key)
            CensorReplyRestore._tryRestoreMessage(msgEl);

            expect(msgEl.querySelector('.restored-content')).not.toBeNull();
            expect(msgEl.querySelector('.restored-content').innerHTML).toContain('live XHR content');
        });
    });
});
