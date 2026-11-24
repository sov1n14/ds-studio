/**
 * content/main-world-injector.js — the MAIN-world scripts must EXECUTE in declared order.
 *
 * Why this is a separate spec from main-world-injector.spec.js: that spec records the order in
 * which <script src> elements are appended, but a dynamically created <script src> runs in the
 * order its fetch finishes unless the element sets `async = false`. The hooks read
 * DSS_TEMP_CHAT_MESSAGE_TYPES while they load, so a hook that runs before the types file throws
 * and never patches the page. happy-dom does not model that ordering, so this spec drives the
 * injector against a document stand-in that follows the HTML script-loading rules (force-async
 * default for created scripts, an in-order queue for `async = false`) and runs the real source
 * files in a vm context that acts as the page's MAIN world. The test decides which fetch finishes
 * first; the assertions read what the page ends up with (execution log, load errors, patched
 * XHR and history, answered fiber-delete request).
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../..');
const EXPECTED_ORDER = [
    'content/sse-parser.js',
    'utils/temporary-chat-message-types.js',
    'content/censor-xhr-hook.js',
    'content/temporary-chat-history-hook.js',
    'content/temporary-chat-fiber-delete.js',
];
const urlOf = (file) => `chrome-extension://test-id/${file}`;

/** The page's MAIN world: a vm global with the browser APIs the hooks patch. */
function createMainWorld() {
    const messageListeners = [];
    const posted = [];
    function XMLHttpRequest() {}
    XMLHttpRequest.prototype.open = function () {};
    XMLHttpRequest.prototype.send = function () {};
    XMLHttpRequest.prototype.setRequestHeader = function () {};
    const world = {
        XMLHttpRequest,
        history: { pushState() {}, replaceState() {} },
        location: { href: 'https://chat.deepseek.com/' },
        console: { warn() {}, error() {}, log() {} },
        URL,
        fetch: () => Promise.resolve({}),
        addEventListener: (type, fn) => { if (type === 'message') messageListeners.push(fn); },
        postMessage: (data) => { posted.push(data); },
    };
    vm.createContext(world);
    world.window = world;
    return { world, posted, messageListeners };
}

/**
 * A document stand-in that follows the HTML rules for script elements that scripts create and
 * append: they are force-async until `async` is set to false; an async script runs the moment its
 * fetch finishes, a non-async script waits in an ordered queue and runs only when every script
 * appended before it has run. Removing the element after insertion does not cancel it.
 */
function createPage(main) {
    const sources = new Map(EXPECTED_ORDER.map((file) => [urlOf(file), fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8')]));
    const waiting = new Map();
    const orderedQueue = [];
    const executed = [];
    const errors = [];

    function run(entry) {
        entry.hasRun = true;
        executed.push(entry.url);
        try {
            vm.runInContext(sources.get(entry.url), main.world);
        } catch (e) {
            errors.push(`${entry.url}: ${e.message}`);
        }
    }

    function createScript() {
        let isForceAsync = true;
        return {
            nodeName: 'SCRIPT',
            src: '',
            get async() { return isForceAsync; },
            set async(value) { isForceAsync = Boolean(value); },
            remove() {},
        };
    }

    return {
        executed,
        errors,
        document: {
            documentElement: {
                appendChild(script) {
                    const entry = { url: script.src, isAsync: script.async, isFetched: false, hasRun: false };
                    waiting.set(entry.url, entry);
                    if (!entry.isAsync) orderedQueue.push(entry);
                },
            },
            createElement: (tag) => (tag === 'script' ? createScript() : {}),
        },
        /** The network delivers the file behind `file` now. */
        finishFetch(file) {
            const entry = waiting.get(urlOf(file));
            entry.isFetched = true;
            if (entry.isAsync) {
                run(entry);
                return;
            }
            while (orderedQueue.length && orderedQueue[0].isFetched) run(orderedQueue.shift());
        },
    };
}

/** Load the injector against the stand-in page; its auto-start appends all five scripts. */
async function injectInto(page) {
    vi.stubGlobal('document', page.document);
    chrome.runtime.getURL.mockReset();
    chrome.runtime.getURL.mockImplementation(urlOf);
    vi.resetModules();
    delete globalThis.DSSMainWorldInjector;
    await import('../../content/main-world-injector.js');
}

/** What a user-visible page would show: each hook answers through window.postMessage. */
function exerciseHooks(main) {
    const { world, posted, messageListeners } = main;
    // `window` inside a vm context is the context's own global proxy, not the host-side object
    const pageWindow = vm.runInContext('window', world);
    world.history.pushState({}, '', '/a/chat/s/abc');
    new world.XMLHttpRequest().setRequestHeader('Authorization', 'Bearer token-1');
    messageListeners.forEach((listener) => listener({ source: pageWindow, data: { type: 'DSS_FIBER_DELETE_SESSION', sessionId: '' } }));
    return posted.map((message) => message.type);
}

const ORDERS = {
    'in declared order': EXPECTED_ORDER,
    'in reverse order (the message types file finishes late)': [...EXPECTED_ORDER].reverse(),
    'with only the message types file finishing last': [
        'content/sse-parser.js',
        'content/censor-xhr-hook.js',
        'content/temporary-chat-history-hook.js',
        'content/temporary-chat-fiber-delete.js',
        'utils/temporary-chat-message-types.js',
    ],
    'with the hooks finishing before sse-parser': [
        'content/censor-xhr-hook.js',
        'utils/temporary-chat-message-types.js',
        'content/temporary-chat-history-hook.js',
        'content/temporary-chat-fiber-delete.js',
        'content/sse-parser.js',
    ],
};

let main;
let page;

beforeEach(() => {
    main = createMainWorld();
    page = createPage(main);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete globalThis.DSSMainWorldInjector;
});

describe('MAIN-world script execution order', () => {
    it.each(Object.entries(ORDERS))('executes every script in declared order when fetches finish %s', async (_label, finishOrder) => {
        await injectInto(page);
        finishOrder.forEach((file) => page.finishFetch(file));

        expect(page.executed).toEqual(EXPECTED_ORDER.map(urlOf));
    });

    it.each(Object.entries(ORDERS))('loads every hook without an error when fetches finish %s', async (_label, finishOrder) => {
        await injectInto(page);
        finishOrder.forEach((file) => page.finishFetch(file));

        expect(page.errors).toEqual([]);
    });

    it.each(Object.entries(ORDERS))('leaves the history, XHR and fiber-delete hooks working when fetches finish %s', async (_label, finishOrder) => {
        await injectInto(page);
        finishOrder.forEach((file) => page.finishFetch(file));

        expect(exerciseHooks(main)).toEqual(['DSS_HISTORY_NAV', 'DSS_AUTH_CAPTURED', 'DSS_FIBER_DELETE_RESULT']);
    });

    it('runs nothing before the first fetch finishes', async () => {
        await injectInto(page);

        expect(page.executed).toEqual([]);
    });
});
