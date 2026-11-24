/**
 * utils/temporary-chat-constants.js load-order contract: the file reads the MAIN-world message type table that utils/temporary-chat-message-types.js publishes on globalThis.DSS_TEMP_CHAT_MESSAGE_TYPES.
 *
 * In a browser or service worker (no CommonJS require) a missing table makes the load throw an Error naming the file to load first, so a wrong script order fails at startup with a fix hint. The source is evaluated with a fresh globalThis object and no require, so the real globals stay untouched.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const SOURCE = fs.readFileSync(path.resolve(__dirname, '../../utils/temporary-chat-constants.js'), 'utf8');

/** Evaluates the constants file the way a classic script runs: only the given globalThis, the given require (none by default) and no module. */
function runAsClassicScript(fakeGlobal, fakeRequire) {
    new Function('globalThis', 'require', 'module', SOURCE)(fakeGlobal, fakeRequire, undefined);
}

describe('temporary-chat-constants load order', () => {
    it('throws a hint naming temporary-chat-message-types.js when the type table is not loaded', () => {
        expect(() => runAsClassicScript({})).toThrow('[DSS] utils/temporary-chat-constants.js 需要 utils/temporary-chat-message-types.js 先行載入');
    });

    it('loads and publishes DSS_TEMP_CHAT when the type table is loaded first', () => {
        const fakeGlobal = { DSS_TEMP_CHAT_MESSAGE_TYPES: globalThis.DSS_TEMP_CHAT_MESSAGE_TYPES };
        runAsClassicScript(fakeGlobal);
        expect(fakeGlobal.DSS_TEMP_CHAT.DSS_FIBER_DELETE_MESSAGE_TYPE).toBe(globalThis.DSS_TEMP_CHAT_MESSAGE_TYPES.FIBER_DELETE);
    });

    it('under a CommonJS loader, reads the type table through require when the global is absent', () => {
        const fakeGlobal = {};
        const requested = [];
        const fakeRequire = (id) => {
            requested.push(id);
            return globalThis.DSS_TEMP_CHAT_MESSAGE_TYPES;
        };
        runAsClassicScript(fakeGlobal, fakeRequire);
        expect(fakeGlobal.DSS_TEMP_CHAT.DSS_FIBER_DELETE_MESSAGE_TYPE).toBe(globalThis.DSS_TEMP_CHAT_MESSAGE_TYPES.FIBER_DELETE);
        expect(requested).toEqual(['./temporary-chat-message-types.js']);
    });
});
