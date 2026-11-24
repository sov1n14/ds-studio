/**
 * utils/temporary-chat-message-types.js — the one definition of the window.postMessage types between the MAIN-world hooks and the isolated world.
 *
 * Contract: the table is frozen and holds seven distinct non-empty strings; utils/temporary-chat-constants.js (isolated world and service worker) republishes exactly those strings; each MAIN-world hook reads its types from the table and fails loading with an Error naming the missing file when the table is absent; the manifest lists the file as a web-accessible resource and loads it before the constants file in the isolated content_scripts entry.
 * The hooks run in a vm sandbox that stands in for the page's MAIN world (test/helpers/load-classic-script.js), which holds only the globals the sandbox is given.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { loadClassicScript } from '../helpers/load-classic-script.js';
import types from '../../utils/temporary-chat-message-types.js';
import '../../utils/temporary-chat-constants.js';

const MANIFEST = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../manifest.json'), 'utf8'));
const TYPES_FILE = 'utils/temporary-chat-message-types.js';
const HOOKS = [
    'content/censor-xhr-hook.js',
    'content/temporary-chat-history-hook.js',
    'content/temporary-chat-fiber-delete.js',
];

describe('message type table', () => {
    it('is published on globalThis, frozen, and holds seven distinct non-empty strings', () => {
        const values = Object.values(types);

        expect(globalThis.DSS_TEMP_CHAT_MESSAGE_TYPES).toBe(types);
        expect(Object.isFrozen(types)).toBe(true);
        expect(values).toHaveLength(7);
        values.forEach((value) => expect(typeof value === 'string' && value.length > 0).toBe(true));
        expect(new Set(values).size).toBe(values.length);
    });

    it('is the source of every type the isolated-world constants republish', () => {
        const constants = globalThis.DSS_TEMP_CHAT;

        expect(constants.DSS_CHAT_CREATE_MESSAGE_TYPE).toBe(types.CHAT_CREATE);
        expect(constants.DSS_CHAT_COMPLETION_MESSAGE_TYPE).toBe(types.CHAT_COMPLETION);
        expect(constants.DSS_FIBER_DELETE_MESSAGE_TYPE).toBe(types.FIBER_DELETE);
        expect(constants.DSS_FIBER_DELETE_RESULT_TYPE).toBe(types.FIBER_DELETE_RESULT);
        expect(constants.DSS_AUTH_CAPTURED_TYPE).toBe(types.AUTH_CAPTURED);
        expect(constants.DSS_HISTORY_NAV_TYPE).toBe(types.HISTORY_NAV);
        expect(constants.DSS_FRAGMENT_COMPLETE_TYPE).toBe(types.FRAGMENT_COMPLETE);
    });
});

describe('MAIN-world hooks without the table', () => {
    it.each(HOOKS)('%s fails loading with an Error naming the missing file', (hook) => {
        const sandbox = {
            window: { postMessage() {}, addEventListener() {}, location: { href: 'https://chat.deepseek.com/' } },
            history: { pushState() {}, replaceState() {} },
            XMLHttpRequest: class {},
            SseParser: {},
            URL,
        };

        let error = null;
        try {
            loadClassicScript(hook, sandbox);
        } catch (e) {
            error = e;
        }

        expect(error, 'loading must fail').not.toBeNull();
        expect(String(error.message)).toContain(TYPES_FILE);
    });
});

describe('manifest wiring', () => {
    it('lists the table as a web-accessible resource so the injector can add it to the page', () => {
        const resources = MANIFEST.web_accessible_resources.flatMap((entry) => entry.resources);
        expect(resources).toContain(TYPES_FILE);
    });

    it('loads the table before the constants file in the isolated content_scripts entry', () => {
        const files = MANIFEST.content_scripts.find((entry) => entry.world !== 'MAIN').js;
        expect(files.indexOf(TYPES_FILE), 'table listed').toBeGreaterThanOrEqual(0);
        expect(files.indexOf('utils/temporary-chat-constants.js'), 'constants listed').toBeGreaterThanOrEqual(0);
        expect(files.indexOf(TYPES_FILE)).toBeLessThan(files.indexOf('utils/temporary-chat-constants.js'));
    });
});

describe('message type table, evaluated fresh as a classic script', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../' + TYPES_FILE), 'utf8');

    it('publishes a frozen table whose seven wire strings are the protocol names the hooks and the isolated world exchange', () => {
        const fakeGlobal = {};
        new Function('globalThis', 'module', source)(fakeGlobal, undefined);

        expect(Object.isFrozen(fakeGlobal.DSS_TEMP_CHAT_MESSAGE_TYPES)).toBe(true);
        expect(fakeGlobal.DSS_TEMP_CHAT_MESSAGE_TYPES).toEqual({
            CHAT_CREATE: 'DSS_CHAT_CREATE_DETECTED',
            CHAT_COMPLETION: 'DSS_CHAT_COMPLETION_DETECTED',
            FIBER_DELETE: 'DSS_FIBER_DELETE_SESSION',
            FIBER_DELETE_RESULT: 'DSS_FIBER_DELETE_RESULT',
            AUTH_CAPTURED: 'DSS_AUTH_CAPTURED',
            HISTORY_NAV: 'DSS_HISTORY_NAV',
            FRAGMENT_COMPLETE: 'DSS_FRAGMENT_COMPLETE',
        });
    });

    it('exports the table through module.exports under a CommonJS loader', () => {
        const fakeGlobal = {};
        const fakeModule = { exports: {} };
        new Function('globalThis', 'module', source)(fakeGlobal, fakeModule);

        expect(fakeModule.exports).toBe(fakeGlobal.DSS_TEMP_CHAT_MESSAGE_TYPES);
    });
});
