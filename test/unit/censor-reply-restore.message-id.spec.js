import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import CensorReplyRestore from '../../content/censor-reply-restore.js';
import { resetCensorReplyRestore, buildChatPair } from '../helpers/censor-reply-restore-fixtures.js';

/**
 * Resolving a message id for a DOM element: key map, storage lookup, and the
 * pending-queue fallback with its purge and validation rules.
 *
 * Split out of the original censor-reply-restore.spec.js monolith; every case
 * below is the unchanged original assertion set.
 */
describe('CensorReplyRestore — message-id resolution', () => {
    beforeEach(resetCensorReplyRestore);

    describe('_getMessageIdFromElement()', () => {
        beforeEach(() => {
            CensorReplyRestore._pendingQueue = [];
            CensorReplyRestore._keyToMessageId = new Map();
            CensorReplyRestore._restoredMessages = {};
            CensorReplyRestore._storedRecordsApplied = false;
            document.body.innerHTML = '';
            vi.restoreAllMocks();
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('(1) _keyToMessageId hit returns id WITHOUT consuming _pendingQueue', () => {
            const msgEl = buildChatPair('asst-key1', 'hello');
            const asstItem = document.querySelector('[data-virtual-list-item-key="asst-key1"]');
            CensorReplyRestore._keyToMessageId.set('asst-key1', 777);
            CensorReplyRestore._pendingQueue = [888];

            const result = CensorReplyRestore._getMessageIdFromElement(msgEl);

            expect(result).toBe(777);
            // Queue must NOT have been consumed
            expect(CensorReplyRestore._pendingQueue).toEqual([888]);
        });

        it('(2) storage match takes precedence over non-empty _pendingQueue — queue NOT consumed', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/aaaaaaaa-0000-0000-0000-000000000001');
            const msgEl = buildChatPair('asst-key2', 'storage prompt');
            CensorReplyRestore._restoredMessages = {
                '500': {
                    message_id: 500, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'stored' }],
                    chat_session_id: 'aaaaaaaa-0000-0000-0000-000000000001',
                    prompt_key: 'storage prompt',
                    restored_at: 100
                }
            };
            CensorReplyRestore._pendingQueue = [999];

            const result = CensorReplyRestore._getMessageIdFromElement(msgEl);

            expect(result).toBe(500);
            // Queue must NOT have been consumed
            expect(CensorReplyRestore._pendingQueue).toEqual([999]);
        });

        it('(3) queue fallback used only when both map and storage miss', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/bbbbbbbb-0000-0000-0000-000000000001');
            const msgEl = buildChatPair('asst-key3', 'no match prompt');
            CensorReplyRestore._restoredMessages = {};
            CensorReplyRestore._pendingQueue = [321];

            const result = CensorReplyRestore._getMessageIdFromElement(msgEl);

            expect(result).toBe(321);
            expect(CensorReplyRestore._pendingQueue).toHaveLength(0);
        });

        it('(4) all empty → returns null', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/cccccccc-0000-0000-0000-000000000001');
            const msgEl = buildChatPair('asst-key4', 'nothing here');
            CensorReplyRestore._restoredMessages = {};
            CensorReplyRestore._pendingQueue = [];

            const result = CensorReplyRestore._getMessageIdFromElement(msgEl);

            expect(result).toBeNull();
        });

        // ── v2.8.12 queue-purge and queue-validation tests ──────────────────────

        it('(5) map-path purge: resolving via map removes that id from queue, leaving other ids intact', () => {
            // _keyToMessageId maps 'asst-purge1' -> 11; queue contains [11, 22]
            // After resolution, 11 must be purged; 22 must remain.
            const msgEl = buildChatPair('asst-purge1', 'map purge prompt');
            CensorReplyRestore._keyToMessageId.set('asst-purge1', 11);
            CensorReplyRestore._pendingQueue = [11, 22];

            const result = CensorReplyRestore._getMessageIdFromElement(msgEl);

            expect(result).toBe(11);
            expect(CensorReplyRestore._pendingQueue).toEqual([22]);
        });

        it('(6) map-path purge: when resolved id is absent from queue, queue is unchanged', () => {
            const msgEl = buildChatPair('asst-purge2', 'map purge absent prompt');
            CensorReplyRestore._keyToMessageId.set('asst-purge2', 33);
            CensorReplyRestore._pendingQueue = [44, 55];

            const result = CensorReplyRestore._getMessageIdFromElement(msgEl);

            expect(result).toBe(33);
            expect(CensorReplyRestore._pendingQueue).toEqual([44, 55]);
        });

        it('(7) storage-path purge: resolving via storage removes that id from queue, leaving other ids intact', () => {
            // Storage resolves to id=66; queue contains [66, 77]
            // After resolution, 66 must be purged; 77 must remain.
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/dddddddd-1111-0000-0000-000000000001');
            const msgEl = buildChatPair('asst-purge3', 'storage purge prompt');
            CensorReplyRestore._restoredMessages = {
                '66': {
                    message_id: 66, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'purge test' }],
                    chat_session_id: 'dddddddd-1111-0000-0000-000000000001',
                    prompt_key: 'storage purge prompt',
                    restored_at: 100
                }
            };
            CensorReplyRestore._pendingQueue = [66, 77];

            const result = CensorReplyRestore._getMessageIdFromElement(msgEl);

            expect(result).toBe(66);
            expect(CensorReplyRestore._pendingQueue).toEqual([77]);
        });

        it('(8) storage-path purge: when resolved id is absent from queue, queue is unchanged', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/eeeeeeee-2222-0000-0000-000000000001');
            const msgEl = buildChatPair('asst-purge4', 'storage purge absent');
            CensorReplyRestore._restoredMessages = {
                '88': {
                    message_id: 88, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'no queue match' }],
                    chat_session_id: 'eeeeeeee-2222-0000-0000-000000000001',
                    prompt_key: 'storage purge absent',
                    restored_at: 100
                }
            };
            CensorReplyRestore._pendingQueue = [99, 100];

            const result = CensorReplyRestore._getMessageIdFromElement(msgEl);

            expect(result).toBe(88);
            expect(CensorReplyRestore._pendingQueue).toEqual([99, 100]);
        });

        it('(9) queue fallback rejection: prompt mismatch → returns null, queue NOT consumed', () => {
            // Candidate id=2 has stored record with prompt_key='P1';
            // element is preceded by prompt 'P2' → mismatch → null returned, queue length unchanged.
            const SESSION = 'ffff0001-0000-0000-0000-000000000001';
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/' + SESSION);
            CensorReplyRestore._currentSessionId = SESSION;

            const msgEl = buildChatPair('asst-reject1', 'P2');

            const recordKey = CensorReplyRestore._recordKey(SESSION, 2);
            CensorReplyRestore._restoredMessages = {
                [recordKey]: {
                    message_id: 2, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'msg 2 content' }],
                    chat_session_id: SESSION,
                    prompt_key: 'P1',
                    restored_at: 100
                }
            };
            CensorReplyRestore._pendingQueue = [2];

            const result = CensorReplyRestore._getMessageIdFromElement(msgEl);

            expect(result).toBeNull();
            // Queue must NOT have been consumed — length still 1
            expect(CensorReplyRestore._pendingQueue).toHaveLength(1);
            expect(CensorReplyRestore._pendingQueue[0]).toBe(2);
        });

        it('(10) queue fallback acceptance — prompt keys match: shifts and returns id', () => {
            const SESSION = 'aaaa0011-0000-0000-0000-000000000001';
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/' + SESSION);
            CensorReplyRestore._currentSessionId = SESSION;

            const msgEl = buildChatPair('asst-accept1', 'matching prompt');

            const recordKey = CensorReplyRestore._recordKey(SESSION, 5);
            CensorReplyRestore._restoredMessages = {
                [recordKey]: {
                    message_id: 5, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'correct content' }],
                    chat_session_id: SESSION,
                    prompt_key: 'matching prompt',
                    restored_at: 100
                }
            };
            CensorReplyRestore._pendingQueue = [5];

            const result = CensorReplyRestore._getMessageIdFromElement(msgEl);

            expect(result).toBe(5);
            expect(CensorReplyRestore._pendingQueue).toHaveLength(0);
        });

        it('(11) queue fallback acceptance — no stored record yet: shifts and returns id (legacy last-resort)', () => {
            const SESSION = 'bbbb0022-0000-0000-0000-000000000001';
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/' + SESSION);
            CensorReplyRestore._currentSessionId = SESSION;

            // Candidate id=7 has NO record in _restoredMessages → allow shift
            const msgEl = buildChatPair('asst-accept2', 'some prompt');
            CensorReplyRestore._restoredMessages = {};
            CensorReplyRestore._pendingQueue = [7];

            const result = CensorReplyRestore._getMessageIdFromElement(msgEl);

            expect(result).toBe(7);
            expect(CensorReplyRestore._pendingQueue).toHaveLength(0);
        });

        it('(12) queue fallback acceptance — element has no obtainable prompt key: blind shift preserved', () => {
            // Build an element with NO virtual-list-item-key ancestor so _getPrecedingUserPromptKey returns null
            // → queue fallback proceeds without validation
            const orphanMsg = document.createElement('div');
            orphanMsg.className = 'ds-message _63c77b1';
            document.body.appendChild(orphanMsg);

            CensorReplyRestore._pendingQueue = [9];

            const result = CensorReplyRestore._getMessageIdFromElement(orphanMsg);

            expect(result).toBe(9);
            expect(CensorReplyRestore._pendingQueue).toHaveLength(0);
        });

        it('(13) full field regression — stale queue bug scenario end-to-end', () => {
            // Simulates the exact field failure scenario:
            // msg2 resolves via storage (stale queue entry must be purged).
            // Then msg6's censored element appears before its fragment → must resolve null (not stale 2).
            // Then msg6's fragment arrives, re-scan injects correctly.
            const SESSION = 'cccc0033-0000-0000-0000-000000000001';
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/' + SESSION);
            CensorReplyRestore._currentSessionId = SESSION;
            CensorReplyRestore.enabled = true;

            // --- Phase 1: element A (msg2) appears; queue/map/storage all empty → null ---
            const elA = buildChatPair('asst-msg2', 'Prompt P1');
            CensorReplyRestore._pendingQueue = [];
            CensorReplyRestore._restoredMessages = {};
            expect(CensorReplyRestore._getMessageIdFromElement(elA)).toBeNull();

            // --- Phase 2: fragment for msg2 arrives (censored, P1) ---
            // Directly set up as _onFragmentComplete would — save record and push queue
            const keyMsg2 = CensorReplyRestore._recordKey(SESSION, 2);
            CensorReplyRestore._restoredMessages[keyMsg2] = {
                message_id: 2, censored: true,
                fragments: [{ type: 'RESPONSE', content: 'msg2 content' }],
                chat_session_id: SESSION,
                prompt_key: 'Prompt P1',
                restored_at: 100
            };
            CensorReplyRestore._pendingQueue = [2];

            // --- Phase 3: re-scan element A resolves via storage → queue must be purged ---
            const idA = CensorReplyRestore._getMessageIdFromElement(elA);
            expect(idA).toBe(2);
            expect(CensorReplyRestore._pendingQueue).toHaveLength(0); // purged!

            // --- Phase 4: element B (msg6) appears BEFORE its fragment → must resolve null ---
            const elB = buildChatPair('asst-msg6', 'Prompt P2');
            expect(CensorReplyRestore._getMessageIdFromElement(elB)).toBeNull();
            // Queue still empty — not erroneously populated
            expect(CensorReplyRestore._pendingQueue).toHaveLength(0);

            // --- Phase 5: fragment for msg6 arrives ---
            const keyMsg6 = CensorReplyRestore._recordKey(SESSION, 6);
            CensorReplyRestore._restoredMessages[keyMsg6] = {
                message_id: 6, censored: true,
                fragments: [{ type: 'RESPONSE', content: 'msg6 content' }],
                chat_session_id: SESSION,
                prompt_key: 'Prompt P2',
                restored_at: 200
            };
            CensorReplyRestore._pendingQueue = [6];

            // --- Phase 6: re-scan element B resolves to msg6 (storage path) → correct injection ---
            const idB = CensorReplyRestore._getMessageIdFromElement(elB);
            expect(idB).toBe(6);
            expect(CensorReplyRestore._pendingQueue).toHaveLength(0);

            // Confirm element A was NOT assigned msg6's id
            expect(idA).toBe(2);
        });
    });

    describe('_resolveMessageIdFromStorage()', () => {
        beforeEach(() => {
            CensorReplyRestore._pendingQueue = [];
            CensorReplyRestore._keyToMessageId = new Map();
            CensorReplyRestore._restoredMessages = {};
            CensorReplyRestore._storedRecordsApplied = false;
            document.body.innerHTML = '';
            vi.restoreAllMocks();
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('match by session+prompt_key returns id and writes into _keyToMessageId', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/dddddddd-0000-0000-0000-000000000001');
            const msgEl = buildChatPair('asst-r1', 'What is AI?');
            CensorReplyRestore._restoredMessages = {
                '600': {
                    message_id: 600, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'AI is...' }],
                    chat_session_id: 'dddddddd-0000-0000-0000-000000000001',
                    prompt_key: 'What is AI?',
                    restored_at: 1000
                }
            };

            const result = CensorReplyRestore._resolveMessageIdFromStorage(msgEl);

            expect(result).toBe(600);
            expect(CensorReplyRestore._keyToMessageId.get('asst-r1')).toBe(600);
            // Queue must remain untouched
            expect(CensorReplyRestore._pendingQueue).toHaveLength(0);
        });

        it('no match → returns null', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/eeeeeeee-0000-0000-0000-000000000001');
            const msgEl = buildChatPair('asst-r2', 'something else');
            CensorReplyRestore._restoredMessages = {
                '601': {
                    message_id: 601, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'x' }],
                    chat_session_id: 'eeeeeeee-0000-0000-0000-000000000001',
                    prompt_key: 'different prompt',
                    restored_at: 1000
                }
            };

            const result = CensorReplyRestore._resolveMessageIdFromStorage(msgEl);

            expect(result).toBeNull();
        });

        it('wrong session → returns null', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/ffffffff-0000-0000-0000-000000000001');
            const msgEl = buildChatPair('asst-r3', 'hello');
            CensorReplyRestore._restoredMessages = {
                '602': {
                    message_id: 602, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'x' }],
                    chat_session_id: '00000000-0000-0000-0000-000000000099',
                    prompt_key: 'hello',
                    restored_at: 1000
                }
            };

            const result = CensorReplyRestore._resolveMessageIdFromStorage(msgEl);

            expect(result).toBeNull();
        });

        it('messageId already claimed in _keyToMessageId → skipped, returns null', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/11111111-0000-0000-0000-000000000001');
            const msgEl = buildChatPair('asst-r4', 'hello again');
            CensorReplyRestore._restoredMessages = {
                '603': {
                    message_id: 603, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'x' }],
                    chat_session_id: '11111111-0000-0000-0000-000000000001',
                    prompt_key: 'hello again',
                    restored_at: 1000
                }
            };
            // 603 is already claimed by another virtual item key
            CensorReplyRestore._keyToMessageId.set('some-other-key', 603);

            const result = CensorReplyRestore._resolveMessageIdFromStorage(msgEl);

            expect(result).toBeNull();
        });

        it('_pendingQueue is never mutated by _resolveMessageIdFromStorage', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/22222222-0000-0000-0000-000000000001');
            const msgEl = buildChatPair('asst-r5', 'do not touch queue');
            CensorReplyRestore._restoredMessages = {
                '604': {
                    message_id: 604, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'x' }],
                    chat_session_id: '22222222-0000-0000-0000-000000000001',
                    prompt_key: 'do not touch queue',
                    restored_at: 1000
                }
            };
            CensorReplyRestore._pendingQueue = [701, 702];

            CensorReplyRestore._resolveMessageIdFromStorage(msgEl);

            expect(CensorReplyRestore._pendingQueue).toEqual([701, 702]);
        });
    });
});
