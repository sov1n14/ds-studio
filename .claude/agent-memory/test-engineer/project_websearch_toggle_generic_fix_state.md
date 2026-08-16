---
name: websearch-toggle-generic-fix-state
description: As of 2026-08-17, the approved generic-candidates fix for content/websearch-toggle.js is ALREADY applied in the working tree (uncommitted)
metadata:
  type: project
---

State: On 2026-08-17 (branch feat/prompt-group-global-prompt-toggle) the approved fix for the websearch-toggle findButton() adjudication is already present in the working tree, uncommitted, in `content/websearch-toggle.js`: merged+deduped candidate sources (`.ds-toggle-button[aria-pressed]` + generic `[aria-pressed="true"], [aria-pressed="false"]`), icon tier with `SEARCH_ICON_PATH_PREFIX = 'M7.9995999336'` (leading-space tolerant via trim), positional fallback (index 1) only on `.ds-toggle-button[aria-pressed]` candidates, null + single console.warn on total failure. No label-text matching remains.

**Why:** The orchestrator's test-engineer directive claimed the code was still label-based; the working tree had already been fixed, so the rewritten generic-fallback assertions (test/unit/websearch-toggle.spec.js) passed on first run instead of going red.

**How to apply:** Treat the implementation as complete for the two-tier/generic spec. Red was observed against HEAD via the [[red-phase-probe-vs-head]] probe. Next pipeline step is `test-executor` for the certifying green run; do not re-dispatch the implementer for this adjudication. Note the two legacy label-based preference cases ("picks the search toggle over an earlier deep-think toggle", "still picks the search toggle when it comes first") are obsolete under the new spec (no label tier) — the second one currently fails and needs an orchestrator decision.
