---
name: pitfall-isfrozen-undefined
description: Object.isFrozen(undefined) is true, so a "constant is frozen" test passes when the constant does not exist
metadata:
  type: feedback
---

Assert `typeof x === 'object'` and non-null before `Object.isFrozen(x)`.

**Why:** DSS_CHAT_MAP_MSG frozen test passed in red phase (2026-09-24) with the constant absent; primitives count as frozen.

**How to apply:** Any frozen/sealed/extensible assertion on a value that may be missing. Same class: `Object.keys` on undefined throws, but `isFrozen`/`isSealed` silently pass.
