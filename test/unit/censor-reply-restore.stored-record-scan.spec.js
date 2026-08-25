import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import CensorReplyRestore from '../../content/censor-reply-restore.js';
import { resetCensorReplyRestore, buildChatPair } from '../helpers/censor-reply-restore-fixtures.js';

/**
 * The full-DOM scan that matches stored records to censored elements by
 * chat session and preceding-prompt key.
 *
 * Split out of the original censor-reply-restore.spec.js monolith; every case
 * below is the unchanged original assertion set.
 */
describe('CensorReplyRestore — _tryRestoreFromStoredRecords full scan', () => {
    beforeEach(resetCensorReplyRestore);

    describe('_tryRestoreFromStoredRecords() — session+prompt anchoring', () => {
        // Uses the shared buildChatPair() helper (censored: true by default), which builds
        // the identical container/user/assistant/toolbar shape this block previously duplicated.

        beforeEach(() => {
            CensorReplyRestore._keyToMessageId = new Map();
            CensorReplyRestore._restoredMessages = {};
            document.body.innerHTML = '';
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('restores messages by matching prompt_key between DOM and records', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/550e8400-e29b-41d4-a716-446655440000');

            buildChatPair('asst-1', 'What is AI?');
            buildChatPair('asst-2', 'Tell me a joke');
            buildChatPair('asst-3', 'Explain quantum physics');

            CensorReplyRestore._restoredMessages = {
                '101': {
                    message_id: 101, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'AI response' }],
                    chat_session_id: '550e8400-e29b-41d4-a716-446655440000', prompt_key: 'What is AI?', restored_at: 100
                },
                '102': {
                    message_id: 102, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'Joke response' }],
                    chat_session_id: '550e8400-e29b-41d4-a716-446655440000', prompt_key: 'Tell me a joke', restored_at: 200
                },
                '103': {
                    message_id: 103, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'Physics response' }],
                    chat_session_id: '550e8400-e29b-41d4-a716-446655440000', prompt_key: 'Explain quantum physics', restored_at: 300
                }
            };

            const result = CensorReplyRestore._tryRestoreFromStoredRecords();
            expect(result).toBe(true);

            const msgEls = document.querySelectorAll('.ds-message._63c77b1');
            expect(msgEls).toHaveLength(3);
            expect(CensorReplyRestore._keyToMessageId.size).toBe(3);
            for (const msgEl of msgEls) {
                expect(msgEl.querySelector('.restored-content')).not.toBeNull();
            }
        });

        it('pairs duplicate prompts by message_id order', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/550e8400-e29b-41d4-a716-446655440000');

            buildChatPair('asst-1', 'hello');
            buildChatPair('asst-2', 'hello');

            CensorReplyRestore._restoredMessages = {
                '100': {
                    message_id: 100, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'First response' }],
                    chat_session_id: '550e8400-e29b-41d4-a716-446655440000', prompt_key: 'hello', restored_at: 100
                },
                '200': {
                    message_id: 200, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'Second response' }],
                    chat_session_id: '550e8400-e29b-41d4-a716-446655440000', prompt_key: 'hello', restored_at: 200
                }
            };

            const result = CensorReplyRestore._tryRestoreFromStoredRecords();
            expect(result).toBe(true);

            const msgEls = document.querySelectorAll('.ds-message._63c77b1');
            expect(CensorReplyRestore._keyToMessageId.size).toBe(2);
            const firstRestored = msgEls[0].querySelector('.restored-content');
            const secondRestored = msgEls[1].querySelector('.restored-content');
            expect(firstRestored).not.toBeNull();
            expect(secondRestored).not.toBeNull();
            expect(firstRestored.innerHTML).toContain('First response');
            expect(secondRestored.innerHTML).toContain('Second response');
        });

        it('does NOT inject records from a different chat_session_id', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/a0000000-0000-0000-0000-000000000001');

            buildChatPair('asst-1', 'Hello');

            CensorReplyRestore._restoredMessages = {
                '101': {
                    message_id: 101, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'Wrong session' }],
                    chat_session_id: 'b0000000-0000-0000-0000-000000000002', prompt_key: 'Hello', restored_at: 100
                }
            };

            CensorReplyRestore._tryRestoreFromStoredRecords();

            const msgEl = document.querySelector('.ds-message._63c77b1');
            expect(msgEl.querySelector('.restored-content')).toBeNull();
        });

        it('skips legacy records without prompt_key or chat_session_id', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/550e8400-e29b-41d4-a716-446655440000');

            buildChatPair('asst-1', 'Hello');

            CensorReplyRestore._restoredMessages = {
                '101': {
                    message_id: 101, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'Legacy' }]
                    // no chat_session_id, no prompt_key
                }
            };

            CensorReplyRestore._tryRestoreFromStoredRecords();

            const msgEl = document.querySelector('.ds-message._63c77b1');
            expect(msgEl.querySelector('.restored-content')).toBeNull();
        });

        it('does nothing when current session cannot be determined from URL', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/some/other/page');

            buildChatPair('asst-1', 'Hello');

            CensorReplyRestore._restoredMessages = {
                '101': {
                    message_id: 101, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'Content' }],
                    chat_session_id: '550e8400-e29b-41d4-a716-446655440000', prompt_key: 'Hello', restored_at: 100
                }
            };

            CensorReplyRestore._tryRestoreFromStoredRecords();

            const msgEl = document.querySelector('.ds-message._63c77b1');
            expect(msgEl.querySelector('.restored-content')).toBeNull();
        });

        it('returns false when no records can be matched', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/550e8400-e29b-41d4-a716-446655440000');

            buildChatPair('asst-1', 'What is AI?');

            CensorReplyRestore._restoredMessages = {
                '101': {
                    message_id: 101, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'Unmatched' }],
                    chat_session_id: '550e8400-e29b-41d4-a716-446655440000', prompt_key: 'nonexistent', restored_at: 100
                }
            };

            const result = CensorReplyRestore._tryRestoreFromStoredRecords();

            expect(result).toBe(false);
            const msgEl = document.querySelector('.ds-message._63c77b1');
            expect(msgEl.querySelector('.restored-content')).toBeNull();
        });
    });

    describe('_tryRestoreFromStoredRecords() — skips non-censored records', () => {
        beforeEach(() => {
            CensorReplyRestore._keyToMessageId = new Map();
            CensorReplyRestore._restoredMessages = {};
            document.body.innerHTML = '';
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('skips record with censored !== true — record is filtered out, no injection', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/550e8400-e29b-41d4-a716-446655440000');

            // User message (preceding)
            const userItem = document.createElement('div');
            userItem.setAttribute('data-virtual-list-item-key', 'user-1');
            const userMsgDiv = document.createElement('div');
            userMsgDiv.className = 'ds-message';
            const userContent = document.createElement('div');
            userContent.className = 'fbb737a4';
            userContent.textContent = 'Hello';
            userMsgDiv.appendChild(userContent);
            userItem.appendChild(userMsgDiv);
            document.body.appendChild(userItem);

            // Assistant message with toolbar indicating censorship
            const asstItem = document.createElement('div');
            asstItem.setAttribute('data-virtual-list-item-key', 'asst-1');
            const msgEl = document.createElement('div');
            msgEl.className = 'ds-message _63c77b1';
            const mainContent = document.createElement('div');
            mainContent.className = 'ds-markdown ds-assistant-message-main-content';
            msgEl.appendChild(mainContent);
            asstItem.appendChild(msgEl);
            // Censored toolbar: buttons 2 and 5 disabled (0-indexed 1 and 4)
            const toolbar = document.createElement('div');
            toolbar.className = 'ds-flex';
            for (const state of ['enabled', 'disabled', 'enabled', 'enabled', 'disabled']) {
                const btn = document.createElement('button');
                btn.className = 'ds-icon-button';
                if (state === 'disabled') {
                    btn.classList.add('ds-icon-button--disabled');
                    btn.setAttribute('aria-disabled', 'true');
                }
                toolbar.appendChild(btn);
            }
            asstItem.appendChild(toolbar);
            document.body.appendChild(asstItem);

            CensorReplyRestore._restoredMessages = {
                '100': {
                    message_id: 100,
                    censored: false,
                    fragments: [{ type: 'RESPONSE', content: 'should not be injected' }],
                    chat_session_id: '550e8400-e29b-41d4-a716-446655440000',
                    prompt_key: 'Hello'
                }
            };

            CensorReplyRestore._tryRestoreFromStoredRecords();
            const restoredContent = msgEl.querySelector('.restored-content');
            expect(restoredContent).toBeNull();
        });
    });

    describe('Gaps F/G — _tryRestoreFromStoredRecords edge cases', () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('(Gap F) returns false when session id cannot be derived from URL', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/some/non-chat/page');
            document.body.innerHTML = '';

            CensorReplyRestore._restoredMessages = {
                '200': {
                    message_id: 200, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'x' }],
                    chat_session_id: '77777777-0000-0000-0000-000000000001',
                    prompt_key: 'hello',
                    restored_at: 1000
                }
            };
            buildChatPair('asst-gapf', 'hello');

            const result = CensorReplyRestore._tryRestoreFromStoredRecords();

            expect(result).toBe(false);
        });

        it('(Gap G) returns false when there are no unrestored censored elements in DOM', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/88888888-0000-0000-0000-000000000001');
            document.body.innerHTML = '';

            CensorReplyRestore._restoredMessages = {
                '201': {
                    message_id: 201, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'y' }],
                    chat_session_id: '88888888-0000-0000-0000-000000000001',
                    prompt_key: 'some prompt',
                    restored_at: 1000
                }
            };
            // Build a chat pair with non-censored toolbar (censored: false → buttons all enabled)
            buildChatPair('asst-gapg', 'some prompt', { censored: false });

            const result = CensorReplyRestore._tryRestoreFromStoredRecords();

            expect(result).toBe(false);
        });
    });

    describe('Refresh-restore path with session-scoped storage', () => {
        const SESSION = 'ccdd0001-0000-0000-0000-000000000001';

        afterEach(() => {
            vi.restoreAllMocks();
            document.body.innerHTML = '';
        });

        it('storage pre-populated with session-scoped records for current session → observer-path restore succeeds', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/' + SESSION);
            CensorReplyRestore._currentSessionId = SESSION;

            // Pre-populate as if _loadRestoredMessages already ran (session-scoped keys)
            CensorReplyRestore._restoredMessages = {
                [SESSION + '::400']: {
                    message_id: 400, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'refresh restored content' }],
                    chat_session_id: SESSION,
                    prompt_key: 'refresh question',
                    restored_at: 1000
                }
            };

            document.body.innerHTML = '';
            buildChatPair('asst-refresh2', 'refresh question');

            const result = CensorReplyRestore._tryRestoreFromStoredRecords();
            expect(result).toBe(true);

            const msgEl = document.querySelector('.ds-message._63c77b1');
            expect(msgEl.querySelector('.restored-content')).not.toBeNull();
            expect(msgEl.querySelector('.restored-content').innerHTML).toContain('refresh restored content');
        });

        it('records from a different session in storage are not injected on refresh', () => {
            vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/' + SESSION);
            CensorReplyRestore._currentSessionId = SESSION;

            const OTHER_SESSION = 'eeee0002-0000-0000-0000-000000000001';
            CensorReplyRestore._restoredMessages = {
                [OTHER_SESSION + '::401']: {
                    message_id: 401, censored: true,
                    fragments: [{ type: 'RESPONSE', content: 'other session content' }],
                    chat_session_id: OTHER_SESSION,
                    prompt_key: 'refresh question',
                    restored_at: 1000
                }
            };

            document.body.innerHTML = '';
            buildChatPair('asst-refresh3', 'refresh question');

            const result = CensorReplyRestore._tryRestoreFromStoredRecords();
            expect(result).toBe(false);

            const msgEl = document.querySelector('.ds-message._63c77b1');
            expect(msgEl.querySelector('.restored-content')).toBeNull();
        });
    });
});
