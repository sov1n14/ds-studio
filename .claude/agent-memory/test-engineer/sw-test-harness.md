---
name: sw-test-harness
description: Loading background/service-worker.js under Vitest with the REAL pending-store, captured onChanged listener, Map-backed alarms, Date.now clock, and the Bash heredoc limit.
metadata:
  type: project
---

Testing `background/service-worker.js` (classic script, bare globals):

- Run from `test/`: `npx vitest run unit/<file>.spec.js`. Vitest 3.2.4 + happy-dom. Each setTimeout(0) flush round costs ~16ms, so a 30-round settle is ~0.5s per sweep.
- Use the REAL store: `import TemporaryChatPendingStore from '../../background/pending-store.js'` (sets the global). Stubbing the store (test/helpers/pending-store-mock.js) is only OK for content-side specs; SW sweep specs stubbing it encoded the 2026-09-24 lost-update bug as expected behavior.
- Before `await import(service-worker.js)`: stub importScripts, StorageManager, the four DSS*Routes install objects (Settings, PendingStore, EditorWindow, ChatMap), fetch — service-worker.js top level calls DSSChatMapRoutes.install({ storageManager: StorageManager }), so both StorageManager and DSSChatMapRoutes must exist, also in tab-guard-lease.scenario own bootstrap; temporarily replace `chrome.storage.onChanged.addListener` to capture the SW listener (so seeding the sync queue never auto-starts a sweep) and invoke it directly for the onChanged path.
- Observable end state: sync queue contents, fetch bodies (`chat_session_id`), a Map fed by `chrome.alarms.create/clear` mockImplementation.
- Deterministic clock: `vi.spyOn(Date,'now').mockImplementation(() => clock)`; never fake timers (stalls the flusher). TTL expiry = sweep once to record the observation, then move clock past LEASE_TTL_MS. lastActiveAt 0 = released, expired immediately.
- Shared bootstrap: test/helpers/service-worker-harness.js (`installServiceWorkerHarness()` + exported helpers; move the clock with `setClock`, read it via the live `clock` binding). Used by the SW sweep specs plus alarm-rearm and sync-retry (hand-written store stubs there broke when the store grew applySweepResult/resolveLeaseTtl); tab-guard-lease.scenario still carries its own bootstrap. Exports readLocalDeviceId() and FOREIGN_LEASE_TTL_MS.
- Revert check recipe: `git show HEAD:background/service-worker.js > test/zz-scratch-sw-head.js`, sed the import path into scratch spec copies, run, recycle-bin them.

## Bash heredoc truncation
Very large single heredoc writes have been truncated before; ~100-line chunks appended with `>>` are safe.

## Tab guard and multi-device gotchas
- The SW tab guard extracts UUIDs from tab URLs with a hex-only regex (`[a-f0-9-]+`), so fixture UUIDs like `chat-1` never match and the guard looks broken. Use hex-shaped IDs (`aaa-111`) in any spec that relies on tab protection.
- Since the ownerDeviceId change (2026-09-24): store.addPendingDelete stamps ownerDeviceId from storage.local 'dss-device-id'; own entries expire after LEASE_TTL_MS (10 min), foreign/ownerless (e.g. harness fresh()/expired() seeds) only on lastActiveAt 0 or after FOREIGN_LEASE_TTL_MS (24 h). Exact-shape assertions must read the device ID from storage and also assert it is a non-empty string, since toEqual treats an undefined property as absent.
- To simulate two devices sharing one account, give each device its own `new InMemoryStorageMock('local')`, point `chrome.storage.local` at it, and restore the original in afterEach. Sync stays shared. The store and SW read `chrome.storage.local` on every call. See test/unit/service-worker.owner-device.scenario.spec.js.
- To simulate an SW restart, re-import with a query string (`pending-store.js?restart=N`, then `service-worker.js?restart=N`) so Vite runs a fresh module instance. Old listeners stay registered, so put such tests last in the file.

## SW with the REAL chat-map routes (2026-09-24)
The harness stubs DSSChatMapRoutes, so the `install({ storageManager })` wiring is invisible there. Recipe in test/unit/temp-chat.mutant-kill.spec.js: `globalThis.StorageManager = await importFreshStorageManager()`, `loadRoutes()` (both from chat-map-writer-harness), swap chrome.runtime.onMessage for a fresh event and no-op storage.onChanged.addListener, then `await import('../../background/service-worker.js?real-chat-map-routes')`; send BIND to the listeners and read back with a second fresh StorageManager. Restore every swapped global in afterEach.
