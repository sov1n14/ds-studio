---
name: project-jest-chrome-removal
description: jest-chrome dependency replaced with a hand-rolled vi.fn() mock in test/setup/vitest.setup.js; documents the chrome API surface actually used and the numbers.
metadata:
  type: project
---

`jest-chrome` was removed from `test/package.json` devDependencies and replaced with a plain-object `globalThis.chrome` mock built from `vi.fn()` + a ~10-line `createMockEvent()` factory (Set-backed addListener/removeListener/hasListener/callListeners), written directly in `test/setup/vitest.setup.js` (lines ~52-128 of that file). No new mocking dependency was added.

**Why:** jest-chrome pulled in a jest 27 peer-dependency stack — of 450 lockfile packages, 335 were transitive peers of it (100M → 52M node_modules) — just to provide a `chrome.*` stub this suite uses in a narrow, fixed way.

**Confirmed chrome API surface this suite touches** (verified via grep across all of `test/` and all production source — `chrome.action` is NOT used anywhere):
- `chrome.storage.local` / `.sync`: get/set/remove/clear/setQuotaError — served by the existing `InMemoryStorageMock` fixture (`test/fixtures/chrome-storage-mock.js`), untouched by this change.
- `chrome.storage.onChanged`: addListener/removeListener/callListeners, fan-in dispatcher over both areas — pre-existing logic in vitest.setup.js, only needed jest-chrome's raw object as a base.
- `chrome.storage.session`: deliberately NOT provided by default — `content-script.chat-delete.spec.js` installs its own stub via `if (!chrome.storage.session) {...}`; jest-chrome didn't provide it either.
- `chrome.runtime`: `id` (read in a try/catch, value irrelevant), `lastError` (plain settable prop), `getURL`/`sendMessage` (vi.fn, tests use `.mockReturnValue`/`.mockClear`), `onInstalled`/`onStartup`/`onMessage` (events — production code calls `.addListener`, specs call `.callListeners(...)` to fire them, e.g. `service-worker.pending-delete.spec.js`, `service-worker.sync-retry.spec.js`).
- `chrome.alarms`: `create`/`clear` (vi.fn, `.mockClear` used), `onAlarm` (event, same addListener/callListeners pattern).
- `chrome.tabs.query`/`.sendMessage`, `chrome.windows.create`/`.update`: vi.fn placeholders — individual specs reassign them per-test (`chrome.tabs.query = vi.fn().mockResolvedValue(...)`), so the base mock just needs the property present.

**Reset semantics preserved:** only `storageMock.local.clear()` / `.sync.clear()` run in `beforeEach` — same as before. tabs/windows/alarms/runtime mocks are NOT reset between tests within a file; specs that need isolation already reassign or `.mockClear()` them themselves.

**Verification:** exact 85 files / 1725 tests / 0 failures before and after (verified across 4 runs), per-file test counts diffed byte-identical (`--reporter=verbose` output).

**Full surface-map + gate results also sent to team-lead** in this session's completion report — see that message if the raw text is needed again.

See also [[project_gotop_timer_flakiness]] for an unrelated pre-existing flaky-error discovery made while re-running the suite for this task.
