---
name: sw-test-harness
description: Loading background/service-worker.js under Vitest, deterministic-now trick, and the Bash heredoc truncation limit on this Windows box.
metadata:
  type: project
---

Testing `background/service-worker.js` (a classic script using bare globals):

- Run from `test/` (nested package.json): `npx vitest run unit/<file>.spec.js`. Vitest 3.2.4 + happy-dom.
- In `beforeAll`, BEFORE `await import('../../background/service-worker.js')`, stub `globalThis.importScripts`, `StorageManager`, `TemporaryChatPendingStore`, `DSS*Routes` install objects, and `fetch`. Top-level listener registrations bind to the stubs at import time.
- Reuse `test/helpers/pending-store-mock.js` `makePendingStoreMock()` for the store; extend per-spec (do not edit the shared helper).
- Trigger listeners via the mock-event `callListeners(...)`: `chrome.runtime.onStartup`, `chrome.alarms.onAlarm({name})`, `chrome.storage.onChanged(changes, area)`.
- Flush await-chains with a real-timer macrotask flusher (`setTimeout(resolve,0)` looped). **Why:** `vi.useFakeTimers()` stalls that flusher. For a deterministic `now`, spy `Date.now` instead of fake timers — keeps the flusher alive.
- Network boundary: assert on the `fetch` stub's call bodies (`JSON.parse(body).chat_session_id`) — that is the observable delete target.

**How to apply:** copy the bootstrap from `test/unit/service-worker.pending-delete.spec.js`.

## Bash heredoc truncation
Large single `cat > file << 'EOF'` writes get TRUNCATED before the terminator, causing `unexpected EOF while looking for matching '"'"''`. ~55 content lines survived; ~175 did not. **How to apply:** write test files in chunks of well under ~80 lines using `>>` append, verifying `wc -l` after each.
