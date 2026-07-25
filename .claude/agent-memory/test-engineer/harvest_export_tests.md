---
name: harvest-export-tests
description: Test patterns for harvest.js, prevent-auto-scroll-bridge.js, and async exportConversationToMarkdown; Blob-capture, scrollTop setter trap, toast class names, bridge DOM cleanup, scroll_interrupted limitation.
metadata:
  type: project
---

## harvest.js test patterns (unit/harvest.spec.js)

- **Module import**: `import harvestModule from '../../content/harvest.js'` with CJS destructuring.
- **buildVirtualListDOM helper**: creates `.ds-scroll-area` wrapping `.ds-virtual-list-items._6f2c522` > `.ds-virtual-list-visible-items`; uses `Object.defineProperty` for `scrollHeight`/`clientHeight`.
- **appendMessage helper**: wraps `.ds-message` in a `data-virtual-list-item-key="N"` parent — required for `_harvestVisibleMessages` to pick up keys.
- **scrollTop restore test**: use `Object.defineProperty` with getter+setter to capture assignments and verify the original value is restored after `harvestAllMessages()`.
- **Throw-in-finally test**: inject `window.DSstudio.GoToTop.scrollToTopAndWait` as `vi.fn().mockRejectedValue(...)`. Re-throws but scrollTop restore and `PreventAutoScroll.disable()` still run.
- **Timeout test**: set `scrollHeight` >> `clientHeight + scrollTop`, then `await vi.advanceTimersByTimeAsync(130000)`.
- **Guard: no_container**: empty DOM → exits immediately with `reason:'no_container'`.

## Toast class names (v2.x breaking change from old overlay)

- **New**: `.dsv-harvest-toast` / `.dsv-harvest-toast__text` / `display:block`
- **Old (removed)**: `.dsv-harvest-overlay` / `.dsv-harvest-overlay__text` / `display:flex`
- Text format: `正在擷取完整對話… 已擷取 N 則`
- Any test asserting old class names must be updated to new names.

## PreventAutoScroll in harvestAllMessages

- Install mock via `window.DSstudio.PreventAutoScroll = { enable: vi.fn(), disable: vi.fn(), isEnabled: vi.fn() }`.
- `enable()` is called before `showHarvestOverlay` (try block start).
- `disable()` is called as FIRST statement of finally — before scrollTop restore.
- Both throw-path and success-path tests must verify `disable()` was called exactly once.
- Remove mock in `afterEach` with `delete window.DSstudio.PreventAutoScroll`.

## prevent-auto-scroll-bridge.spec.js patterns

- Import via CJS: `import bridgeModule from '../../content/prevent-auto-scroll-bridge.js'`.
- The IIFE runs once on import; clean DOM in `beforeEach`/`afterEach` by removing `#dsv-prevent-auto-scroll-bridge` and `#dsv-prevent-auto-scroll-script`.
- `chrome.runtime.getURL` from `jest-chrome` mock: `chrome.runtime.getURL.mockReturnValue(URL)`.
- In happy-dom, script `onload` never fires — tag is NOT auto-removed; assert by id.

## scroll_interrupted safety-net is NOT end-to-end testable in happy-dom

`_expectedScrollTop` is re-read via `container.scrollTop` AFTER every `await _waitForDomStability` (line 346 of harvest.js). Any scrollTop jump during an async pause is absorbed before the check fires. The check window between line 346 and the next loop-top check (line 311) is synchronous — no external injection possible. Test the predicate logic directly (arithmetic formula) instead of driving through `harvestAllMessages`.

## content-script.js export tests (unit/content-script.export.spec.js)

- **Blob capture pattern**: replace `global.Blob` with a mock class that writes `parts.join('')` to a captured string.
- **Harvest mock**: `window.DSstudio.Harvest = { harvestAllMessages: vi.fn()... }`.
- **Warning footer text**: `> ⚠️ Export may be incomplete: scroll-harvest timed out before reaching the end.`
- Footer triggers on ANY `isComplete:false`, including `reason:'scroll_interrupted'`.
- **exportConversationToMarkdown is async** — must `await` in all tests.
- **innerText in happy-dom**: set `Object.defineProperty(el, 'innerText', ...)` on `.fbb737a4`.

## Pre-existing exit-code-1 noise

Runner exits with code 1 due to unhandled `ECONNREFUSED :3000` (fixture server) and re-thrown errors from intentional throw tests. This does NOT reflect test failures. As of 2026-05-29: 605 tests pass across 37 files.

**happy-dom SyncFetch noise (separate from the above):** happy-dom itself emits harmless `SyncFetch` `ECONNREFUSED` errors targeting `127.0.0.1:3000` during the suite run — unrelated to the fixture-server noise above and unrelated to any test's own logic. Count roughly doubled to ~96 occurrences as of the v4.11.4 suite run (was lower in earlier versions/smaller suites). Never affects pass/fail — treat any occurrence count as informational only, not a regression signal.

## Discarded-return-value defect red phase (2026-07-26)

`harvestAllMessages` calls `await goTop.scrollToTopAndWait({ timeout: 30000 })` and discards the result, so a `{ success:false, reason:X }` resolution is silently ignored and harvest proceeds to capture from wherever the viewport is. Wrote 2 new tests in `harvestAllMessages` describe block: mock `window.DSstudio.GoToTop.scrollToTopAndWait` to `vi.fn().mockResolvedValue({ success:false, reason:'stopped-by-user' })`, then assert `result.isComplete===false`, `result.reason==='stopped-by-user'`, `result.items` is `[]`.

**Vacuous-pass trap to watch for on this exact defect:** the pre-fix code's `finally` block already runs `PreventAutoScroll.disable()` + scrollTop-restore unconditionally on EVERY exit path, including its own unrelated internal capture-loop timeout (which independently resolves with `reason:'timeout'`). So a teardown-only test (checking `pas.isEnabled()===false` / scrollTop restored, without also checking `result.reason`) passes on the buggy code by coincidence — it's not exercising the abort path at all, just re-confirming existing unconditional-teardown coverage. Fix: use a distinctive reason string in the mock (not `'timeout'`, which collides with the module's own real timeout reason) and assert `result.reason` equals that exact string IN THE SAME test as the teardown checks. Only a correct fix makes both hold together.

**Runner note**: root has no `package.json` — must `cd test/` first, then `npx vitest run unit/harvest.spec.js` (or via `npm run test:unit` from `test/`). Running from repo root gives `ReferenceError: document is not defined` (wrong/no environment config picked up).
