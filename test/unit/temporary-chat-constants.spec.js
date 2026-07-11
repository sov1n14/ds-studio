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

    it('DSS_TEMP_CHAT_UUID_KEY has the exact expected value', () => {
        expect(constants.DSS_TEMP_CHAT_UUID_KEY).toBe('dss-temporary-chat-uuid');
    });

    it('DSS_CHAT_CREATE_MESSAGE_TYPE has the exact expected value', () => {
        expect(constants.DSS_CHAT_CREATE_MESSAGE_TYPE).toBe('DSS_CHAT_CREATE_DETECTED');
    });

    it('DSS_CHAT_CREATE_ENDPOINT has the exact expected value', () => {
        expect(constants.DSS_CHAT_CREATE_ENDPOINT).toBe('/api/v0/chat_session/create');
    });

    it('exports exactly thirteen constants', () => {
        const keys = Object.keys(constants);
        expect(keys).toHaveLength(13);
        expect(keys).toContain('DSS_TEMP_CHAT_STORAGE_KEY');
        expect(keys).toContain('DSS_TEMP_CHAT_CHANGED_EVENT');
        expect(keys).toContain('DSS_TEMP_CHAT_UUID_KEY');
        expect(keys).toContain('DSS_CHAT_CREATE_MESSAGE_TYPE');
        expect(keys).toContain('DSS_CHAT_CREATE_ENDPOINT');
        expect(keys).toContain('DSS_CHAT_COMPLETION_MESSAGE_TYPE');
        expect(keys).toContain('DSS_FIBER_DELETE_MESSAGE_TYPE');
        expect(keys).toContain('DSS_FIBER_DELETE_RESULT_TYPE');
        expect(keys).toContain('DSS_PENDING_DELETES_SYNC_KEY');
        expect(keys).toContain('DSS_LAST_AUTH_TOKEN_KEY');
        expect(keys).toContain('DSS_OPEN_TEMP_UUIDS_KEY');
        expect(keys).toContain('DSS_DELETE_ENDPOINT_URL');
        expect(keys).toContain('DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE');
        expect(keys).not.toContain('DSS_SW_DELETE_MESSAGE_TYPE');
    });

    it('DSS_CHAT_COMPLETION_MESSAGE_TYPE has the exact expected value', () => {
        expect(constants.DSS_CHAT_COMPLETION_MESSAGE_TYPE).toBe('DSS_CHAT_COMPLETION_DETECTED');
    });

    it('DSS_FIBER_DELETE_MESSAGE_TYPE has the exact expected value', () => {
        expect(constants.DSS_FIBER_DELETE_MESSAGE_TYPE).toBe('DSS_FIBER_DELETE_SESSION');
    });

    it('DSS_FIBER_DELETE_RESULT_TYPE has the exact expected value', () => {
        expect(constants.DSS_FIBER_DELETE_RESULT_TYPE).toBe('DSS_FIBER_DELETE_RESULT');
    });

    it('DSS_PENDING_DELETES_SYNC_KEY has the exact expected value', () => {
        expect(constants.DSS_PENDING_DELETES_SYNC_KEY).toBe('dss-pending-deletes-sync');
    });

    it('DSS_LAST_AUTH_TOKEN_KEY has the exact expected value', () => {
        expect(constants.DSS_LAST_AUTH_TOKEN_KEY).toBe('dss-last-auth-token');
    });

    it('DSS_OPEN_TEMP_UUIDS_KEY has the exact expected value', () => {
        expect(constants.DSS_OPEN_TEMP_UUIDS_KEY).toBe('dss-open-temp-uuids');
    });

    it('DSS_DELETE_ENDPOINT_URL has the exact expected value', () => {
        expect(constants.DSS_DELETE_ENDPOINT_URL).toBe('https://chat.deepseek.com/api/v0/chat_session/delete');
    });

    it('DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE has the exact expected value', () => {
        expect(constants.DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE).toBe('DSS_SCHEDULE_DELETE_RETRY');
    });
});
