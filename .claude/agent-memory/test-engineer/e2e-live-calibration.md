---
name: e2e-live-calibration
description: Live DeepSeek E2E calibration facts (viewport, native widths, export speed) and the sabotage-copy method for proving E2E assertions can fail
metadata:
  type: reference
---

Measured 2026-11-08 on the persistent `.browser-profile` context (default viewport 1280x720): native message width 752px and composer 776px on conversation 7606c947, so 50vw (640px) and 40vw (512px) caps are observable transitions; a cap above ~60vw would be vacuous at this viewport. Export of the kept 5-reply conversation takes about 2 s, so a 180 s per-test timeout is generous. Conversation 7606c947 has ONE thinking block containing three `.ds-think-content` segments (interleaved with search), so count blocks and bodies separately.

**Why:** E2E specs are written after the feature, so a green first run proves nothing; preconditions must show the native state differs from the asserted state.

**How to apply:** Assert a precondition (native width above the cap, bodies mounted, overlay visible) before every transition. To prove non-vacuity, write sed-sabotaged copies `test/e2e/zz-sab-*.e2e.js` that skip the setting change, run them (all must fail at the intended assertion), then recycle them with the file-deletion-policy command (a bare `rm` in Bash is blocked by a hook). Read storage afterwards via a `node --input-type=module -e` one-liner from `test/` to confirm restoration without a scratch file. See [[ds-studio-harness]].
