/**
 * Unit tests for the persistent-lock feature of content/prevent-auto-scroll-bridge.js
 *
 * Coverage map:
 *   § 1  setPersistent()/isPersistent() — explicit API contract (A, B, D, E)
 *   § 2  disable() regression guard while persistent (C)
 *   § 3  non-persistent behaviour unchanged (F)
 *   § 4  settings subscription — reacts live to chrome.storage.onChanged (G)
 *
 * IMPLEMENTATION BLINDNESS: assertions below are derived only from the
 * requirement contract handed down by the orchestrator, plus the public
 * function names/signatures already established by the sibling spec file
 * test/unit/prevent-auto-scroll-bridge.spec.js (enable/disable/isEnabled).
 * content/prevent-auto-scroll-bridge.js and content/prevent-auto-scroll.js
 * were NOT read while writing this file.
 *
 * Public API asserted (implementer must match these names/signatures):
 *   PreventAutoScroll.setPersistent(shouldPersist: boolean): void
 *   PreventAutoScroll.isPersistent(): boolean
 *   PreventAutoScroll.enable(): void        (already exists)
 *   PreventAutoScroll.disable(): void       (already exists)
 *   PreventAutoScroll.isEnabled(): boolean  (already exists)
 *
 * Settings-subscription entry point (mirrors HideThinking.start() in
 * content/hide-thinking.js — reads chrome.storage.local once, applies it,
 * then installs the chrome.storage.onChanged listener). It is invoked as a
 * module-level side effect on import, exactly like HideThinking.start(), so
 * — matching the precedent set in test/unit/hide-thinking.spec.js — this
 * spec never calls it directly. It must exist as:
 *   PreventAutoScroll.start(): Promise<void>
 *
 * Master-switch default semantics mirrored from content/hide-thinking.js
 * (see start(): `data[StorageManager.KEYS.IS_ENABLED] ?? false`): when the
 * master switch key is absent from storage, it is treated as disabled, so
 * persistent mode MUST stay off even if 'dsPreventAutoScroll' is true.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import '../../utils/storage-manager.js';
import bridgeModule from '../../content/prevent-auto-scroll-bridge.js';
import StorageManager from '../../utils/storage-manager.js';

const { enable, disable, isEnabled, setPersistent, isPersistent } = bridgeModule;

const SETTING_KEY = 'dsPreventAutoScroll';

function wait(ms = 10) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Baseline reset via the public API + storage only — no internal fields are
// touched, per anti-tautology rules (assert observable behaviour, not
// internal call sequences / internal state).
beforeEach(async () => {
    setPersistent(false);
    await chrome.storage.local.set({
        [StorageManager.KEYS.IS_ENABLED]: false,
        [SETTING_KEY]: false,
    });
    await wait();
    disable();
});

describe('setPersistent()', () => {
    it('setPersistent(true) activates protection: isEnabled() and isPersistent() both become true', () => {
        setPersistent(true);
        expect(isPersistent()).toBe(true);
        expect(isEnabled()).toBe(true);
    });

    it('setPersistent(false) clears persistent mode and deactivates protection', () => {
        setPersistent(true);
        setPersistent(false);
        expect(isPersistent()).toBe(false);
        expect(isEnabled()).toBe(false);
    });

    it('enable() remains idempotent while persistent: does not change isPersistent(), leaves isEnabled() true', () => {
        setPersistent(true);
        enable();
        expect(isPersistent()).toBe(true);
        expect(isEnabled()).toBe(true);
    });

    it('setPersistent(true) called twice is idempotent: no error, still enabled and persistent', () => {
        setPersistent(true);
        expect(() => setPersistent(true)).not.toThrow();
        expect(isPersistent()).toBe(true);
        expect(isEnabled()).toBe(true);
    });
});

describe('disable() while persistent', () => {
    it('does NOT deactivate protection while persistent mode is on', () => {
        setPersistent(true);
        disable();
        expect(isEnabled()).toBe(true);
        expect(isPersistent()).toBe(true);
    });
});

describe('enable()/disable() when persistent mode is off', () => {
    it('enable() then disable() flips isEnabled() true then false, as before', () => {
        expect(isPersistent()).toBe(false);
        enable();
        expect(isEnabled()).toBe(true);
        disable();
        expect(isEnabled()).toBe(false);
    });
});

describe('settings subscription', () => {
    it('persistent mode turns ON only when master switch is enabled AND dsPreventAutoScroll is true', async () => {
        await chrome.storage.local.set({ [StorageManager.KEYS.IS_ENABLED]: true });
        await wait();
        expect(isPersistent()).toBe(false); // setting still false

        await chrome.storage.local.set({ [SETTING_KEY]: true });
        await wait();
        expect(isPersistent()).toBe(true);
        expect(isEnabled()).toBe(true);
    });

    it('persistent mode stays OFF when master switch is disabled even if dsPreventAutoScroll is true', async () => {
        await chrome.storage.local.set({
            [StorageManager.KEYS.IS_ENABLED]: false,
            [SETTING_KEY]: true,
        });
        await wait();
        expect(isPersistent()).toBe(false);
    });

    it('an absent master switch key defaults to disabled, keeping persistent mode off even if dsPreventAutoScroll is true', async () => {
        await chrome.storage.local.remove(StorageManager.KEYS.IS_ENABLED);
        await chrome.storage.local.set({ [SETTING_KEY]: true });
        await wait();
        expect(isPersistent()).toBe(false);
    });

    it('flipping dsPreventAutoScroll from true back to false turns persistent mode off live, without a reload', async () => {
        await chrome.storage.local.set({
            [StorageManager.KEYS.IS_ENABLED]: true,
            [SETTING_KEY]: true,
        });
        await wait();
        expect(isPersistent()).toBe(true);

        await chrome.storage.local.set({ [SETTING_KEY]: false });
        await wait();
        expect(isPersistent()).toBe(false);
        expect(isEnabled()).toBe(false);
    });

    it('a live change to the master switch key is honoured the same way as the setting key', async () => {
        await chrome.storage.local.set({
            [StorageManager.KEYS.IS_ENABLED]: true,
            [SETTING_KEY]: true,
        });
        await wait();
        expect(isPersistent()).toBe(true);

        await chrome.storage.local.set({ [StorageManager.KEYS.IS_ENABLED]: false });
        await wait();
        expect(isPersistent()).toBe(false);

        await chrome.storage.local.set({ [StorageManager.KEYS.IS_ENABLED]: true });
        await wait();
        expect(isPersistent()).toBe(true);
    });

    it('ignores changes reported under a namespace other than "local"', async () => {
        await chrome.storage.local.set({
            [StorageManager.KEYS.IS_ENABLED]: true,
            [SETTING_KEY]: false,
        });
        await wait();
        expect(isPersistent()).toBe(false);

        await chrome.storage.sync.set({ [SETTING_KEY]: true });
        await wait();
        expect(isPersistent()).toBe(false); // sync-namespace change must be ignored
    });
});
