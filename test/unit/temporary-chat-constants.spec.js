import { describe, it, expect } from 'vitest';
import constants from '../../content/temporary-chat-constants.js';

// These constants are the shared contract between modules.
// A typo in any value would silently break the feature — hence dedicated assertions.

describe('temporary-chat-constants', () => {
    it('DSS_TEMP_CHAT_STORAGE_KEY has the exact expected value', () => {
        expect(constants.DSS_TEMP_CHAT_STORAGE_KEY).toBe('dss-temporary-chat-enabled');
    });

    it('DSS_TEMP_CHAT_CHANGED_EVENT has the exact expected value', () => {
        expect(constants.DSS_TEMP_CHAT_CHANGED_EVENT).toBe('dss-temporary-chat-changed');
    });

    it('DSS_CHAT_LEFT_EVENT has the exact expected value', () => {
        expect(constants.DSS_CHAT_LEFT_EVENT).toBe('dss-chat-left');
    });

    it('exports exactly three constants (no extras)', () => {
        const keys = Object.keys(constants);
        expect(keys).toHaveLength(3);
        expect(keys).toContain('DSS_TEMP_CHAT_STORAGE_KEY');
        expect(keys).toContain('DSS_TEMP_CHAT_CHANGED_EVENT');
        expect(keys).toContain('DSS_CHAT_LEFT_EVENT');
    });
});
