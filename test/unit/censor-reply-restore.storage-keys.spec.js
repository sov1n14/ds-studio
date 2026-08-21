import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import CensorReplyRestore from '../../content/censor-reply-restore.js';
import { resetCensorReplyRestore, buildChatPair } from '../helpers/censor-reply-restore-fixtures.js';

/**
 * Record-key construction, save/lookup round-trips, and _loadRestoredMessages
 * filtering plus legacy bare-key migration.
 *
 * Split out of the original censor-reply-restore.spec.js monolith; every case
 * below is the unchanged original assertion set.
 */
describe('CensorReplyRestore — session-scoped storage keys', () => {
    beforeEach(resetCensorReplyRestore);

    describe('_recordKey() — session-scoped key helper', () => {
        it.each([
            ['returns "{sessionId}::{messageId}" format for normal session', 'abc-123', 42, 'abc-123::42'],
            ['uses "nosession" prefix when sessionId is null', null, 42, 'nosession::42'],
            ['uses "nosession" prefix when sessionId is undefined', undefined, 5, 'nosession::5'],
            ['uses "nosession" prefix when sessionId is empty string', '', 99, 'nosession::99'],
            ['coerces numeric messageId to string', 'sess-1', 100, 'sess-1::100']
        ])('%s', (_name, sessionId, messageId, expected) => {
            expect(CensorReplyRestore._recordKey(sessionId, messageId)).toBe(expected);
        });
    });

    describe('_saveFragment() — session-scoped save and lookup round-trip', () => {
        const SESSION_A = 'aaaaaaaa-1111-1111-1111-111111111111';
        const SESSION_B = 'bbbbbbbb-2222-2222-2222-222222222222';

        beforeEach(() => {
            CensorReplyRestore._restoredMessages = {};
        });

        it('saves under session-scoped key and record is retrievable at that key', async () => {
            await CensorReplyRestore._saveFragment({
                message_id: 2,
                fragments: [{ type: 'RESPONSE', content: 'Chat A content' }],
                thinking_elapsed_secs: 0,
                chat_session_id: SESSION_A,
                prompt_key: 'What is AI?'
            });

            const expectedKey = SESSION_A + '::2';
            expect(CensorReplyRestore._restoredMessages[expectedKey]).toBeDefined();
            expect(CensorReplyRestore._restoredMessages[expectedKey].fragments[0].content).toBe('Chat A content');
        });

        it('cross-chat collision regression: chat A and chat B both save message_id=2, keys are distinct', async () => {
            await CensorReplyRestore._saveFragment({
                message_id: 2,
                fragments: [{ type: 'RESPONSE', content: 'Chat A content' }],
                thinking_elapsed_secs: 0,
                chat_session_id: SESSION_A,
                prompt_key: 'prompt A'
            });
            await CensorReplyRestore._saveFragment({
                message_id: 2,
                fragments: [{ type: 'RESPONSE', content: 'Chat B content' }],
                thinking_elapsed_secs: 0,
                chat_session_id: SESSION_B,
                prompt_key: 'prompt B'
            });

            const keyA = SESSION_A + '::2';
            const keyB = SESSION_B + '::2';
            expect(CensorReplyRestore._restoredMessages[keyA].fragments[0].content).toBe('Chat A content');
            expect(CensorReplyRestore._restoredMessages[keyB].fragments[0].content).toBe('Chat B content');
        });

        it('record saved under session A is NOT found when looking up under session B key', async () => {
            await CensorReplyRestore._saveFragment({
                message_id: 2,
                fragments: [{ type: 'RESPONSE', content: 'Chat A only' }],
                thinking_elapsed_secs: 0,
                chat_session_id: SESSION_A,
                prompt_key: 'prompt'
            });

            const wrongKey = SESSION_B + '::2';
            expect(CensorReplyRestore._restoredMessages[wrongKey]).toBeUndefined();
        });
    });

    describe('_loadRestoredMessages() — storage cleanup', () => {
        it('loads storage with mixed censored flags — keeps only censored: true records', async () => {
            const storedData = {
                '12': { message_id: 12, censored: false, fragments: [{ type: 'RESPONSE', content: 'uncensored' }] },
                '24': { message_id: 24, censored: true, fragments: [{ type: 'RESPONSE', content: 'censored content' }] }
            };

            // Pre-populate the in-memory storage mock with mixed data
            await new Promise((resolve) => {
                chrome.storage.local.set({ restored_messages: storedData }, resolve);
            });

            // Load the messages (should filter out censored: false entries)
            await CensorReplyRestore._loadRestoredMessages();

            // Verify that only censored: true records were kept.
            // Bare keys (no '::') are legacy format and get migrated to session-scoped keys.
            // '12' is censored: false → filtered out entirely.
            // '24' is censored: true, no chat_session_id embedded → migrated to 'nosession::24'.
            expect(CensorReplyRestore._restoredMessages['12']).toBeUndefined();
            expect(CensorReplyRestore._restoredMessages['24']).toBeUndefined();
            expect(CensorReplyRestore._restoredMessages['nosession::24']).toBeDefined();
            expect(CensorReplyRestore._restoredMessages['nosession::24'].censored).toBe(true);
        });
    });

    describe('_loadRestoredMessages() — legacy key migration', () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('bare-key records are re-keyed using embedded chat_session_id', async () => {
            const SESSION = '11112222-3333-4444-5555-666677778888';
            const storedData = {
                '55': {
                    message_id: 55, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'migrated content' }],
                    chat_session_id: SESSION
                }
            };
            await new Promise((resolve) => { chrome.storage.local.set({ restored_messages: storedData }, resolve); });

            await CensorReplyRestore._loadRestoredMessages();

            // Bare key must be gone; session-scoped key must exist
            expect(CensorReplyRestore._restoredMessages['55']).toBeUndefined();
            expect(CensorReplyRestore._restoredMessages[SESSION + '::55']).toBeDefined();
            expect(CensorReplyRestore._restoredMessages[SESSION + '::55'].fragments[0].content).toBe('migrated content');
        });

        it('bare-key record with null chat_session_id migrates to "nosession::{messageId}"', async () => {
            const storedData = {
                '99': {
                    message_id: 99, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'no-session content' }],
                    chat_session_id: null
                }
            };
            await new Promise((resolve) => { chrome.storage.local.set({ restored_messages: storedData }, resolve); });

            await CensorReplyRestore._loadRestoredMessages();

            expect(CensorReplyRestore._restoredMessages['99']).toBeUndefined();
            expect(CensorReplyRestore._restoredMessages['nosession::99']).toBeDefined();
        });

        it('nosession record never matches a live session element via _resolveMessageIdFromStorage', async () => {
            const storedData = {
                '77': {
                    message_id: 77, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'null session content' }],
                    chat_session_id: null,
                    prompt_key: 'test prompt'
                }
            };
            await new Promise((resolve) => { chrome.storage.local.set({ restored_messages: storedData }, resolve); });
            await CensorReplyRestore._loadRestoredMessages();

            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/a1b2c3d4-0000-0000-0000-000000000001');
            document.body.innerHTML = '';
            const msgEl = buildChatPair('asst-nosess', 'test prompt');

            const result = CensorReplyRestore._resolveMessageIdFromStorage(msgEl);
            expect(result).toBeNull();
        });

        it('already session-scoped keys (contain "::") are preserved unchanged', async () => {
            const SESSION = 'aabbccdd-0000-0000-0000-000000000001';
            const storedData = {
                [SESSION + '::33']: {
                    message_id: 33, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'already scoped' }],
                    chat_session_id: SESSION
                }
            };
            await new Promise((resolve) => { chrome.storage.local.set({ restored_messages: storedData }, resolve); });

            await CensorReplyRestore._loadRestoredMessages();

            expect(CensorReplyRestore._restoredMessages[SESSION + '::33']).toBeDefined();
            expect(CensorReplyRestore._restoredMessages[SESSION + '::33'].fragments[0].content).toBe('already scoped');
        });
    });
});
