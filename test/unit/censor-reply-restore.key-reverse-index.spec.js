import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import CensorReplyRestore from '../../content/censor-reply-restore.js';
import { resetCensorReplyRestore, buildChatPair } from '../helpers/censor-reply-restore-fixtures.js';

/**
 * Backlog C13: the `_keyToMessageId` -> message-id direction is currently answered
 * by a full linear scan of the map, re-run for every censored element. The fix adds
 * a reverse lookup. These cases pin the observable contract of that lookup: for any
 * message id, it answers with the virtual-list-item key currently mapped to it, and
 * that answer must stay correct across every mutation shape the codebase actually
 * performs on `_keyToMessageId` — set, overwrite, delete, clear, and wholesale
 * reassignment to a fresh Map (which `resetCensorReplyRestore` and every session
 * switch do).
 */
describe('CensorReplyRestore — _keyToMessageId reverse lookup (C13)', () => {
    beforeEach(() => {
        resetCensorReplyRestore();
        vi.restoreAllMocks();
    });

    it('returns the key currently mapped to a message id, and null for an unmapped id', () => {
        CensorReplyRestore._keyToMessageId.set('asst-a', 101);
        CensorReplyRestore._keyToMessageId.set('asst-b', 102);

        expect(CensorReplyRestore._findKeyForMessageId(101)).toBe('asst-a');
        expect(CensorReplyRestore._findKeyForMessageId(102)).toBe('asst-b');
        expect(CensorReplyRestore._findKeyForMessageId(999)).toBeNull();
    });

    it('overwriting a key releases the old message id and claims the new one', () => {
        CensorReplyRestore._keyToMessageId.set('asst-a', 201);
        CensorReplyRestore._keyToMessageId.set('asst-a', 202);

        expect(CensorReplyRestore._findKeyForMessageId(201)).toBeNull();
        expect(CensorReplyRestore._findKeyForMessageId(202)).toBe('asst-a');
    });

    it('deleting a key releases its message id', () => {
        CensorReplyRestore._keyToMessageId.set('asst-a', 301);
        CensorReplyRestore._keyToMessageId.delete('asst-a');

        expect(CensorReplyRestore._findKeyForMessageId(301)).toBeNull();
    });

    it('clear() releases every message id', () => {
        CensorReplyRestore._keyToMessageId.set('asst-a', 401);
        CensorReplyRestore._keyToMessageId.set('asst-b', 402);
        CensorReplyRestore._keyToMessageId.clear();

        expect(CensorReplyRestore._findKeyForMessageId(401)).toBeNull();
        expect(CensorReplyRestore._findKeyForMessageId(402)).toBeNull();
    });

    it('replacing _keyToMessageId with a fresh Map answers from the new map only', () => {
        CensorReplyRestore._keyToMessageId.set('asst-old', 501);

        CensorReplyRestore._keyToMessageId = new Map([['asst-new', 502]]);

        expect(CensorReplyRestore._findKeyForMessageId(501)).toBeNull();
        expect(CensorReplyRestore._findKeyForMessageId(502)).toBe('asst-new');
    });

    // Regression guard for the consumer of the reverse lookup: a stored record whose
    // message id is claimed by another key must stay unresolvable, and must become
    // resolvable again once that claim is removed.
    it('_resolveMessageIdFromStorage honours release of a claimed id', () => {
        const SESSION = '33333333-0000-0000-0000-000000000001';
        vi.spyOn(window.location, 'pathname', 'get').mockReturnValue('/a/chat/s/' + SESSION);
        CensorReplyRestore._currentSessionId = SESSION;
        const msgEl = buildChatPair('asst-target', 'claimed prompt');
        CensorReplyRestore._restoredMessages = {
            '605': {
                message_id: 605, censored: true,
                fragments: [{ type: 'RESPONSE', content: 'x' }],
                chat_session_id: SESSION,
                prompt_key: 'claimed prompt',
                restored_at: 1000
            }
        };

        CensorReplyRestore._keyToMessageId.set('asst-other', 605);
        expect(CensorReplyRestore._resolveMessageIdFromStorage(msgEl)).toBeNull();

        CensorReplyRestore._keyToMessageId.delete('asst-other');
        expect(CensorReplyRestore._resolveMessageIdFromStorage(msgEl)).toBe(605);
        expect(CensorReplyRestore._keyToMessageId.get('asst-target')).toBe(605);
    });
});
