/* i18n lifecycle / data-lookup contract  --  backlog U2 + U13 (RED phase)
 *
 * U2: utils/i18n.js must lose its module-level autoInit IIFE. Loading the file
 *     must be inert (no localStorage read, no chrome.storage read, no listener,
 *     no DOM). dsI18n.init() performs the whole initialization explicitly and is
 *     idempotent for listener registration. The DOM-application half moves to a
 *     UI-layer helper (popup/popup.i18n-apply.js); utils/ must not touch the DOM.
 * U13: the five locale-ternaries collapse into a single lookup. Those cases are
 *     characterization tests: they pin today's OBSERVABLE behavior so the
 *     refactor cannot change it, and stay green before AND after.
 *
 * Loading strategy: utils/i18n.js is a classic IIFE reading chrome,
 * localStorage, document, window and globalThis as free variables. Each test
 * compiles it through new Function with those names as PARAMETERS, so the module
 * gets a private, instrumented environment and never touches the shared
 * globalThis.dsI18n that test/setup/vitest.setup.js preloads for the suite.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const I18N_PATH = resolve(HERE, '../../utils/i18n.js');
const APPLIER_PATH = resolve(HERE, '../../popup/popup.i18n-apply.js');
const I18N_SRC = readFileSync(I18N_PATH, 'utf-8');

const STORAGE_KEY = 'ds_studio_locale';

// -- instrumented environment ------------------------------------------------
function makeLocalStorage(initial) {
    const store = Object.assign({}, initial);
    const calls = { get: 0, set: 0 };
    return {
        calls,
        store,
        getItem(k) { calls.get++; return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
        setItem(k, v) { calls.set++; store[k] = String(v); },
        removeItem(k) { delete store[k]; },
    };
}

function makeChrome(syncData) {
    const data = Object.assign({}, syncData);
    const calls = { get: 0, set: 0, addListener: 0 };
    const listeners = [];
    return {
        calls,
        data,
        // Live (still-registered) listeners: lets a test tell "re-registered one
        // listener" apart from "leaked a second, stale listener".
        listeners,
        storage: {
            sync: {
                async get(key) {
                    calls.get++;
                    return Object.prototype.hasOwnProperty.call(data, key) ? { [key]: data[key] } : {};
                },
                async set(obj) { calls.set++; Object.assign(data, obj); },
            },
            onChanged: {
                addListener(fn) { calls.addListener++; listeners.push(fn); },
                removeListener(fn) {
                    const i = listeners.indexOf(fn);
                    if (i !== -1) listeners.splice(i, 1);
                },
            },
        },
        fire(changes, area) { listeners.slice().forEach((l) => l(changes, area)); },
    };
}

function loadI18n(env) {
    const fakeGlobal = { __DS_I18N_Locales: globalThis.__DS_I18N_Locales };
    const factory = new Function(
        'globalThis', 'window', 'chrome', 'localStorage', 'document', 'require', 'console',
        I18N_SRC + '\n;return globalThis.dsI18n || window.dsI18n;'
    );
    return factory(
        fakeGlobal, fakeGlobal, env.chrome, env.localStorage, env.document, undefined,
        env.console || globalThis.console
    );
}

const flush = () => new Promise((r) => setTimeout(r, 0));

// ===========================================================================
//  U2 -- loading the module must be inert
// ===========================================================================
describe('U2 -- utils/i18n.js load is side-effect free', () => {
    it('reads no localStorage while loading', async () => {
        const localStorage = makeLocalStorage({ [STORAGE_KEY]: 'en' });
        loadI18n({ chrome: makeChrome(), localStorage, document: globalThis.document });
        await flush();
        expect(localStorage.calls.get, 'module load must not read localStorage').toBe(0);
        expect(localStorage.calls.set, 'module load must not write localStorage').toBe(0);
    });

    it('reads no chrome.storage while loading', async () => {
        const chrome = makeChrome({ [STORAGE_KEY]: 'en' });
        loadI18n({ chrome, localStorage: makeLocalStorage(), document: globalThis.document });
        await flush();
        expect(chrome.calls.get, 'module load must not call chrome.storage.sync.get').toBe(0);
    });

    it('registers no chrome.storage.onChanged listener while loading', async () => {
        const chrome = makeChrome();
        loadI18n({ chrome, localStorage: makeLocalStorage(), document: globalThis.document });
        await flush();
        expect(chrome.calls.addListener, 'module load must not register a listener').toBe(0);
    });

    it('never references the DOM (utils/ is layer-agnostic)', () => {
        expect(I18N_SRC, 'utils/i18n.js must contain no document reference').not.toMatch(/\bdocument\b/);
    });
});

// ===========================================================================
//  U2 -- init() owns the initialization, explicitly and idempotently
// ===========================================================================
describe('U2 -- dsI18n.init()', () => {
    it('resolves the persisted localStorage locale when chrome.storage is empty', async () => {
        const localStorage = makeLocalStorage();
        const i18n = loadI18n({ chrome: makeChrome(), localStorage, document: globalThis.document });
        // Persisted preference written AFTER load, so a value picked up here can
        // only have come from init() -- never from a load-time autoInit.
        localStorage.store[STORAGE_KEY] = 'en';

        await i18n.init();

        expect(i18n.getLocale()).toBe('en');
        expect(i18n.t('confirmButton')).toBe('OK');
    });

    it('lets a chrome.storage.sync locale win over the localStorage one, and mirrors it back', async () => {
        const localStorage = makeLocalStorage();
        const i18n = loadI18n({
            chrome: makeChrome({ [STORAGE_KEY]: 'en' }), localStorage, document: globalThis.document,
        });
        localStorage.store[STORAGE_KEY] = 'zh_TW';

        await i18n.init();

        expect(i18n.getLocale()).toBe('en');
        expect(localStorage.store[STORAGE_KEY], 'init() mirrors the resolved locale to localStorage').toBe('en');
    });

    it('defaults to zh_TW when nothing is persisted anywhere', async () => {
        const i18n = loadI18n({ chrome: makeChrome(), localStorage: makeLocalStorage(), document: globalThis.document });
        await i18n.init();
        expect(i18n.getLocale()).toBe('zh_TW');
        expect(i18n.t('confirmButton')).toBe('確定');
    });

    it('registers exactly one storage listener no matter how many times it is called', async () => {
        const chrome = makeChrome();
        const i18n = loadI18n({ chrome, localStorage: makeLocalStorage(), document: globalThis.document });

        expect(chrome.calls.addListener, 'no listener before init()').toBe(0);
        await i18n.init();
        expect(chrome.calls.addListener, 'init() registers the live-switch listener').toBe(1);
        await i18n.init();
        await i18n.init();
        expect(chrome.calls.addListener, 'repeat init() must not stack listeners').toBe(1);
    });

    it('keeps the live locale switch working after an explicit init()', async () => {
        const localStorage = makeLocalStorage();
        const chrome = makeChrome();
        const i18n = loadI18n({ chrome, localStorage, document: globalThis.document });
        await i18n.init();

        chrome.fire({ [STORAGE_KEY]: { newValue: 'en' } }, 'sync');

        expect(i18n.getLocale()).toBe('en');
        expect(i18n.t('confirmButton')).toBe('OK');
        expect(localStorage.store[STORAGE_KEY]).toBe('en');
    });

    it('ignores storage changes from a non-sync area', async () => {
        const chrome = makeChrome();
        const i18n = loadI18n({ chrome, localStorage: makeLocalStorage(), document: globalThis.document });
        await i18n.init();

        chrome.fire({ [STORAGE_KEY]: { newValue: 'en' } }, 'local');

        expect(i18n.getLocale()).toBe('zh_TW');
    });
});

// ===========================================================================
//  U2 -- the DOM-application half lives in the UI layer
// ===========================================================================
describe('U2 -- popup/popup.i18n-apply.js (relocated DOM applier)', () => {
    function loadApplier() {
        expect(existsSync(APPLIER_PATH), APPLIER_PATH + ' must exist').toBe(true);
        const src = readFileSync(APPLIER_PATH, 'utf-8');
        const fakeWindow = {};
        new Function('window', 'globalThis', 'document', 'dsI18n', src)(
            fakeWindow, fakeWindow, globalThis.document, globalThis.dsI18n
        );
        const published = fakeWindow.__DS_PopupI18nApply;
        expect(published, 'popup.i18n-apply.js must publish window.__DS_PopupI18nApply').toBeTruthy();
        return published;
    }

    it('swaps textContent for [data-i18n] and the named attribute for [data-i18n-attr]', async () => {
        await globalThis.dsI18n.init();
        await globalThis.dsI18n.setLocale('zh_TW');
        const root = globalThis.document.createElement('div');
        root.innerHTML =
            '<span data-i18n="confirmButton">x</span>' +
            '<button data-i18n="cancelButton" data-i18n-attr="title">y</button>' +
            '<span data-i18n="">untouched</span>';
        globalThis.document.body.appendChild(root);

        loadApplier().apply(root);

        expect(root.querySelector('[data-i18n="confirmButton"]').textContent).toBe('確定');
        expect(root.querySelector('[data-i18n="cancelButton"]').getAttribute('title')).toBe('取消');
        expect(root.querySelector('[data-i18n=""]').textContent).toBe('untouched');
        root.remove();
    });
});

// ===========================================================================
//  U13 -- one locale lookup, identical observable results
//  Characterization: these stay green before AND after the refactor.
// ===========================================================================
describe('U13 -- locale data lookup equivalence', () => {
    async function fresh(syncData) {
        const i18n = loadI18n({
            chrome: makeChrome(syncData), localStorage: makeLocalStorage(), document: globalThis.document,
        });
        await i18n.init();
        return i18n;
    }

    it('serves zh_TW strings for locale zh_TW', async () => {
        const i18n = await fresh({ [STORAGE_KEY]: 'zh_TW' });
        expect(i18n.getLocale()).toBe('zh_TW');
        expect(i18n.t('confirmButton')).toBe('確定');
        expect(i18n.t('globalPromptLabel')).toBe('全域提示詞');
    });

    it('serves en strings for locale en', async () => {
        const i18n = await fresh({ [STORAGE_KEY]: 'en' });
        expect(i18n.getLocale()).toBe('en');
        expect(i18n.t('confirmButton')).toBe('OK');
        expect(i18n.t('globalPromptLabel')).toBe('Global Prompt');
    });

    it('falls back to zh_TW when the persisted locale is unknown', async () => {
        const i18n = await fresh({ [STORAGE_KEY]: 'fr' });
        expect(i18n.getLocale()).toBe('zh_TW');
        expect(i18n.t('confirmButton')).toBe('確定');
    });

    it('rejects an unknown locale from setLocale() and leaves the strings untouched', async () => {
        const i18n = await fresh({ [STORAGE_KEY]: 'en' });
        expect(await i18n.setLocale('fr')).toBe(false);
        expect(await i18n.setLocale('')).toBe(false);
        expect(i18n.getLocale()).toBe('en');
        expect(i18n.t('confirmButton')).toBe('OK');
    });

    it('ignores an unknown locale arriving through the live-switch listener', async () => {
        const chrome = makeChrome();
        const i18n = loadI18n({ chrome, localStorage: makeLocalStorage(), document: globalThis.document });
        await i18n.init();
        chrome.fire({ [STORAGE_KEY]: { newValue: 'fr' } }, 'sync');
        expect(i18n.getLocale()).toBe('zh_TW');
        expect(i18n.t('confirmButton')).toBe('確定');
    });

    it('returns the raw key for an unknown message key in every locale', async () => {
        const i18n = await fresh({ [STORAGE_KEY]: 'en' });
        expect(i18n.t('nope__notAKey')).toBe('nope__notAKey');
        await i18n.setLocale('zh_TW');
        expect(i18n.t('nope__notAKey')).toBe('nope__notAKey');
    });
});

// ===========================================================================
//  U2 -- locale-change subscription contract (dsI18n.onLocaleChanged)
//  The storage listener notifies SUBSCRIBERS, not the DOM. utils/ stays
//  layer-agnostic; content/popup code subscribes instead of listening for a
//  document CustomEvent.
// ===========================================================================
describe('U2 -- dsI18n.onLocaleChanged(cb)', () => {
    function makeConsole() {
        const errors = [];
        return {
            errors,
            error: (...a) => errors.push(a.map(String).join(' ')),
            warn() {}, log() {}, info() {}, debug() {},
        };
    }

    it('notifies a subscriber with the new locale after a sync storage change', async () => {
        const chrome = makeChrome();
        const i18n = loadI18n({ chrome, localStorage: makeLocalStorage(), document: globalThis.document });
        await i18n.init();

        const seen = [];
        i18n.onLocaleChanged((locale) => seen.push(locale));

        chrome.fire({ [STORAGE_KEY]: { newValue: 'en' } }, 'sync');

        expect(seen, 'subscriber must fire exactly once with the new locale').toEqual(['en']);
    });

    it('has already switched locale and data BEFORE the subscriber runs', async () => {
        const chrome = makeChrome();
        const i18n = loadI18n({ chrome, localStorage: makeLocalStorage(), document: globalThis.document });
        await i18n.init();

        const observed = {};
        i18n.onLocaleChanged((locale) => {
            observed.arg = locale;
            observed.getLocale = i18n.getLocale();
            observed.translated = i18n.t('confirmButton');
        });

        chrome.fire({ [STORAGE_KEY]: { newValue: 'en' } }, 'sync');

        expect(observed.arg).toBe('en');
        expect(observed.getLocale, 'getLocale() inside the callback must already be the new locale').toBe('en');
        expect(observed.translated, 't() inside the callback must already serve the new locale strings').toBe('OK');
    });

    it('does not notify subscribers for a non-sync area or an unknown locale', async () => {
        const chrome = makeChrome();
        const i18n = loadI18n({ chrome, localStorage: makeLocalStorage(), document: globalThis.document });
        await i18n.init();

        const seen = [];
        i18n.onLocaleChanged((locale) => seen.push(locale));

        chrome.fire({ [STORAGE_KEY]: { newValue: 'en' } }, 'local');
        chrome.fire({ [STORAGE_KEY]: { newValue: 'fr' } }, 'sync');

        expect(seen, 'no notification for a rejected change').toEqual([]);
    });

    it('fires every registered subscriber', async () => {
        const chrome = makeChrome();
        const i18n = loadI18n({ chrome, localStorage: makeLocalStorage(), document: globalThis.document });
        await i18n.init();

        const seen = [];
        i18n.onLocaleChanged((l) => seen.push('a:' + l));
        i18n.onLocaleChanged((l) => seen.push('b:' + l));
        i18n.onLocaleChanged((l) => seen.push('c:' + l));

        chrome.fire({ [STORAGE_KEY]: { newValue: 'en' } }, 'sync');

        expect(seen.slice().sort()).toEqual(['a:en', 'b:en', 'c:en']);
    });

    it('isolates a throwing subscriber and reports it via console.error with the [DSS] prefix', async () => {
        const chrome = makeChrome();
        const fakeConsole = makeConsole();
        const i18n = loadI18n({
            chrome, localStorage: makeLocalStorage(), document: globalThis.document, console: fakeConsole,
        });
        await i18n.init();

        const seen = [];
        i18n.onLocaleChanged(() => { throw new Error('subscriber blew up'); });
        i18n.onLocaleChanged((l) => seen.push(l));

        expect(
            () => chrome.fire({ [STORAGE_KEY]: { newValue: 'en' } }, 'sync'),
            'a throwing subscriber must not escape the storage listener'
        ).not.toThrow();

        expect(seen, 'the surviving subscriber must still be notified').toEqual(['en']);
        expect(i18n.getLocale(), 'the locale switch itself must still stand').toBe('en');
        expect(
            fakeConsole.errors.join('\n'),
            'the swallowed subscriber error must be reported with the [DSS] prefix'
        ).toMatch(/\[DSS\]/);
    });

    it('dispatches no document CustomEvent -- the DOM seam is gone from the source', () => {
        expect(I18N_SRC, 'utils/i18n.js must no longer dispatch dsI18n-locale-changed')
            .not.toMatch(/dsI18n-locale-changed/);
        expect(I18N_SRC, 'utils/i18n.js must not dispatch any DOM event')
            .not.toMatch(/dispatchEvent/);
    });
});

// ===========================================================================
//  U2 -- _reset() must fully undo init(), listener guard included
// ===========================================================================
describe('U2 -- dsI18n._reset() clears the listener-installed guard', () => {
    it('lets a later init() install exactly one live listener again', async () => {
        const chrome = makeChrome();
        const i18n = loadI18n({ chrome, localStorage: makeLocalStorage(), document: globalThis.document });

        // Asserted as a whole lifecycle on purpose: checking only the count
        // after the second init() would pass vacuously in a world where the
        // listener is installed at module-load time and never re-registered.
        expect(chrome.listeners.length, 'no live listener before init()').toBe(0);

        await i18n.init();
        expect(chrome.listeners.length, 'init() installs one listener').toBe(1);

        i18n._reset();
        await i18n.init();

        expect(
            chrome.listeners.length,
            '_reset() then init() must leave exactly one live listener, not a stale extra'
        ).toBe(1);
    });

    it('notifies a post-reset subscriber exactly once per change', async () => {
        const chrome = makeChrome();
        const i18n = loadI18n({ chrome, localStorage: makeLocalStorage(), document: globalThis.document });

        await i18n.init();
        i18n._reset();
        await i18n.init();

        const seen = [];
        i18n.onLocaleChanged((l) => seen.push(l));

        chrome.fire({ [STORAGE_KEY]: { newValue: 'en' } }, 'sync');

        expect(seen, 'a duplicated stale listener would deliver the change twice').toEqual(['en']);
    });

    it('drops subscribers registered before the reset', async () => {
        const chrome = makeChrome();
        const i18n = loadI18n({ chrome, localStorage: makeLocalStorage(), document: globalThis.document });
        await i18n.init();

        const seen = [];
        i18n.onLocaleChanged((l) => seen.push(l));

        i18n._reset();
        await i18n.init();
        chrome.fire({ [STORAGE_KEY]: { newValue: 'en' } }, 'sync');

        expect(seen, '_reset() must clear the subscriber list with the rest of the state').toEqual([]);
    });
});
