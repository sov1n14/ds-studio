import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import CensorReplyRestore from '../../content/censor-reply-restore.js';
import { resetCensorReplyRestore, buildChatPair } from '../helpers/censor-reply-restore-fixtures.js';

/**
 * _tryRestoreMessage and applyToExisting: post-refresh restore, idempotency,
 * cold start, and the _hasStoredRecordsApplied guard.
 *
 * Split out of the original censor-reply-restore.spec.js monolith; every case
 * below is the unchanged original assertion set.
 */
describe('CensorReplyRestore — per-element restore entry points', () => {
    beforeEach(resetCensorReplyRestore);

    describe('Gap A — post-refresh: _tryRestoreMessage injects from stored records', () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('restores censored message on first call after refresh (empty queue, empty keyMap)', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/33333333-0000-0000-0000-000000000001');
            CensorReplyRestore._pendingQueue = [];
            CensorReplyRestore._keyToMessageId = new Map();
            CensorReplyRestore._hasStoredRecordsApplied = false;
            document.body.innerHTML = '';

            // Use session-scoped key format (v2.8.11+): "{sessionId}::{messageId}"
            CensorReplyRestore._restoredMessages = {
                '33333333-0000-0000-0000-000000000001::700': {
                    message_id: 700, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'Restored answer' }],
                    chat_session_id: '33333333-0000-0000-0000-000000000001',
                    prompt_key: 'What is quantum computing?',
                    restored_at: 500
                }
            };

            const msgEl = buildChatPair('asst-refresh1', 'What is quantum computing?');

            CensorReplyRestore._tryRestoreMessage(msgEl);

            expect(msgEl.querySelector('.restored-content')).not.toBeNull();
            expect(msgEl.querySelector('.restored-content').innerHTML).toContain('Restored answer');
        });
    });

    describe('Gap C — idempotency: second _tryRestoreMessage does not double-inject', () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('second invocation on already-restored element produces exactly one .restored-content node', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/44444444-0000-0000-0000-000000000001');
            CensorReplyRestore._pendingQueue = [];
            CensorReplyRestore._keyToMessageId = new Map();
            CensorReplyRestore._hasStoredRecordsApplied = false;
            document.body.innerHTML = '';

            // Use session-scoped key format (v2.8.11+): "{sessionId}::{messageId}"
            CensorReplyRestore._restoredMessages = {
                '44444444-0000-0000-0000-000000000001::800': {
                    message_id: 800, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'Idempotent answer' }],
                    chat_session_id: '44444444-0000-0000-0000-000000000001',
                    prompt_key: 'Idempotent prompt',
                    restored_at: 600
                }
            };

            const msgEl = buildChatPair('asst-idem1', 'Idempotent prompt');

            CensorReplyRestore._tryRestoreMessage(msgEl);
            CensorReplyRestore._tryRestoreMessage(msgEl);

            expect(msgEl.querySelectorAll('.restored-content')).toHaveLength(1);
        });
    });

    describe('Gap B — cold start: applyToExisting() with stored records injects correctly', () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('applyToExisting with populated storage and empty runtime maps injects into all censored messages', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/55555555-0000-0000-0000-000000000001');
            CensorReplyRestore._pendingQueue = [];
            CensorReplyRestore._keyToMessageId = new Map();
            CensorReplyRestore._hasStoredRecordsApplied = false;
            document.body.innerHTML = '';

            CensorReplyRestore._restoredMessages = {
                '901': {
                    message_id: 901, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'Cold start answer 1' }],
                    chat_session_id: '55555555-0000-0000-0000-000000000001',
                    prompt_key: 'Cold prompt 1',
                    restored_at: 700
                },
                '902': {
                    message_id: 902, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'Cold start answer 2' }],
                    chat_session_id: '55555555-0000-0000-0000-000000000001',
                    prompt_key: 'Cold prompt 2',
                    restored_at: 800
                }
            };

            const msgEls = [
                buildChatPair('asst-cold1', 'Cold prompt 1'),
                buildChatPair('asst-cold2', 'Cold prompt 2')
            ];

            CensorReplyRestore.applyToExisting();

            // The live user .ds-message shares the assistant hash class, so the assistant elements come from buildChatPair, not a class query.
            expect(msgEls[0].querySelector('.restored-content').innerHTML).toContain('Cold start answer 1');
            expect(msgEls[1].querySelector('.restored-content').innerHTML).toContain('Cold start answer 2');
        });
    });

    describe('_hasStoredRecordsApplied guard semantics', () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('is true after full scan is triggered (messageId not resolvable via map or storage, but stored records exist)', () => {
            // Scenario: _resolveMessageIdFromStorage returns null (no prompt_key ancestor for this element),
            // so _getMessageIdFromElement returns null, triggering _tryRestoreFromStoredRecords via the fallback.
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/66666666-0000-0000-0000-000000000001');
            CensorReplyRestore._pendingQueue = [];
            CensorReplyRestore._keyToMessageId = new Map();
            CensorReplyRestore._hasStoredRecordsApplied = false;
            document.body.innerHTML = '';

            CensorReplyRestore._restoredMessages = {
                '1001': {
                    message_id: 1001, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'guard test' }],
                    chat_session_id: '66666666-0000-0000-0000-000000000001',
                    prompt_key: 'Guard test prompt',
                    restored_at: 900
                }
            };

            // A censored assistant reply preceded by its user prompt (live markup), so the full scan can match it by prompt_key.
            const msgEl = buildChatPair('asst-guard1', 'Guard test prompt');

            // Mock _resolveMessageIdFromStorage to return null so full-scan path is exercised
            vi.spyOn(CensorReplyRestore, '_resolveMessageIdFromStorage').mockReturnValue(null);

            CensorReplyRestore._tryRestoreMessage(msgEl);

            expect(CensorReplyRestore._hasStoredRecordsApplied).toBe(true);
        });

        it('_onFragmentComplete resets _hasStoredRecordsApplied to false after pushing to queue', () => {
            CensorReplyRestore.enabled = true;
            CensorReplyRestore._hasStoredRecordsApplied = true;
            CensorReplyRestore._pendingQueue = [];
            CensorReplyRestore._restoredMessages = {};

            CensorReplyRestore._onFragmentComplete({
                messageId: 1100,
                fragments: [{ type: 'RESPONSE', content: 'live reply' }],
                thinkingElapsedSecs: 0,
                censored: true
            });

            expect(CensorReplyRestore._hasStoredRecordsApplied).toBe(false);
        });
    });
});
