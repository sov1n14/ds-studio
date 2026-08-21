import { describe, it, expect, beforeEach } from 'vitest';
import '../../utils/storage-manager.js';
import CensorReplyRestore from '../../content/censor-reply-restore.js';
import { resetCensorReplyRestore } from '../helpers/censor-reply-restore-fixtures.js';

/**
 * Pure helpers: prompt normalization and stored-record eviction.
 *
 * Split out of the original censor-reply-restore.spec.js monolith; every case
 * below is the unchanged original assertion set.
 */
describe('CensorReplyRestore', () => {
    beforeEach(resetCensorReplyRestore);

    describe('_normalizePrompt()', () => {
        it.each([
            ['trims leading and trailing whitespace', '  hello  ', 'hello'],
            ['collapses multiple internal whitespace to single space', 'hello    world', 'hello world'],
            ['collapses mixed internal whitespace (tabs, newlines, spaces)', 'hello\t  \nworld', 'hello world'],
            ['returns empty string for null input', null, ''],
            ['returns empty string for non-string input (number)', 42, ''],
            ['returns empty string for non-string input (object)', {}, ''],
            ['does not modify already-clean text', 'hello world', 'hello world'],
            ['returns empty string for empty string', '', '']
        ])('%s', (_name, input, expected) => {
            expect(CensorReplyRestore._normalizePrompt(input)).toBe(expected);
        });
    });

    describe('_evictOldest()', () => {
        it('removes oldest entries when exceeding STORAGE_MAX_ENTRIES', () => {
            const old = CensorReplyRestore.STORAGE_MAX_ENTRIES;
            CensorReplyRestore.STORAGE_MAX_ENTRIES = 3;
            CensorReplyRestore._restoredMessages = {
                '1': { message_id: 1, restored_at: 100 },
                '2': { message_id: 2, restored_at: 200 },
                '3': { message_id: 3, restored_at: 300 },
                '4': { message_id: 4, restored_at: 50 }
            };
            CensorReplyRestore._evictOldest();
            const keys = Object.keys(CensorReplyRestore._restoredMessages);
            expect(keys).toHaveLength(3);
            expect(keys).not.toContain('4');
            CensorReplyRestore.STORAGE_MAX_ENTRIES = old;
        });

        it('does nothing when under the limit', () => {
            CensorReplyRestore._restoredMessages = {
                '1': { message_id: 1, restored_at: 100 },
                '2': { message_id: 2, restored_at: 200 }
            };
            CensorReplyRestore._evictOldest();
            expect(Object.keys(CensorReplyRestore._restoredMessages)).toHaveLength(2);
        });

        it('removes the correct number of entries when over by multiple', () => {
            const old = CensorReplyRestore.STORAGE_MAX_ENTRIES;
            CensorReplyRestore.STORAGE_MAX_ENTRIES = 2;
            CensorReplyRestore._restoredMessages = {
                'a': { message_id: 1, restored_at: 10 },
                'b': { message_id: 2, restored_at: 20 },
                'c': { message_id: 3, restored_at: 5 },
                'd': { message_id: 4, restored_at: 15 }
            };
            CensorReplyRestore._evictOldest();
            expect(Object.keys(CensorReplyRestore._restoredMessages)).toHaveLength(2);
            CensorReplyRestore.STORAGE_MAX_ENTRIES = old;
        });
    });
});
