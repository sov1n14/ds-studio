---
name: censor-reply-restore-v289-tests
description: New tests for censor-reply-restore.js v2.8.9 fix — _resolveMessageIdFromStorage, _getMessageIdFromElement lookup order, _storedRecordsApplied guard, post-refresh restore (Gap A/B/C/F/G)
metadata:
  type: project
---

Added to `test/unit/censor-reply-restore.spec.js` (35 new tests, 773 total pass):

- `_getMessageIdFromElement()` — 4 tests: keyToMessageId hit skips queue; storage match skips queue; queue fallback only when both miss; all empty returns null.
- `_resolveMessageIdFromStorage()` — 5 tests: match writes keyToMessageId; no match → null; wrong session → null; claimed id skipped; pendingQueue never mutated.
- `Gap A` — post-refresh restore: _tryRestoreMessage with empty queue/map injects from stored records.
- `Gap C` — idempotency: second call produces exactly one .restored-content node.
- `Gap B` — cold start: applyToExisting() with stored records injects all censored messages.
- `_storedRecordsApplied guard` — true after full scan triggered (via mock of _resolveMessageIdFromStorage); reset to false by _onFragmentComplete.
- `Gaps F/G` — _tryRestoreFromStoredRecords returns false when session id null; returns false when no unrestored censored DOM elements.

Also fixed `test/unit/censor-xhr-hook.spec.js` — removed `fs.readFileSync` references to deleted `to-fix/` fixture files; replaced with inline SSE strings.

**Key behavioral contract verified:**
- _keyToMessageId → _resolveMessageIdFromStorage → _pendingQueue.shift() (queue is LAST resort only).
- _resolveMessageIdFromStorage never mutates _pendingQueue.
- _storedRecordsApplied guard: set true only in the null-messageId → full-scan path; reset by _onFragmentComplete on every censored push.

**Why:** The `_storedRecordsApplied` guard test requires mocking `_resolveMessageIdFromStorage` to return null to force the full-scan code path — because when storage resolves the id directly, `_tryRestoreFromStoredRecords` is never called and the flag stays false.
