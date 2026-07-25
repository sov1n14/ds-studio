---
name: edit-message-cleanup-iteach-collapse
description: Collapsed 34 of 78 tests in edit-message-cleanup.spec.js into 11 it.each blocks (1147→1088 lines), zero test-count change, as part of code-slimming effort.
metadata:
  type: project
---

Collapsed adjacent true-parameter-variation tests into `it.each` in `test/unit/edit-message-cleanup.spec.js`: A2+A3, A4-A9, A11+A12, A13+A14, B2-B9, C12+C13, D2+D3, D7+D8, G2-G4, G7-G9, G15+G16. 78 tests before and after (verified both `npx vitest run unit/edit-message-cleanup.spec.js --reporter=verbose` gate and full-suite gate). See [[project_edit_message_cleanup_tests]] for the original Groups A-G layout this builds on.

**Decision rule applied conservatively:** when assertion logic is identical but *setup* differs even slightly (e.g. C4/C5/C6 each call a different combination of `appendSourceA`/`appendSourceB` helpers; G12/G13/G14 each build a different combination of present/absent DOM elements), did NOT collapse — treated as "extra setup in some cases" per the anti-regression directive, even though a conditional-based it.each technically could have worked. This is the safer reading when acting as the anti-regression check for a code-slimming effort that already lost 5 tests once from a similar merge.

**Non-adjacent same-shape tests are not collapsible without violating order/count constraints:** e.g. D4/D6 assert the identical shape but are separated by D4b/D5 — left alone. E5/E6 already parameterize 2 variants each *inside* one `it` body; converting to it.each rows would silently change 2 tests into 4, which fails the "zero net test-count change" arithmetic constraint (N rows in it.each = N tests). Always compute this arithmetic explicitly before proposing a collapse, not just at the end.

**Different matchers block merging even for the same function under test:** G5 uses `toBeCloseTo` while G2/G3/G4/G6 use `toBe` on the same `computeScrollDelta` — excluded G5 to avoid coercing it to `toBe` (which would be a precision weakening) or coercing the others to `toBeCloseTo` (which would blur an intentionally exact assertion).

**How to verify:** `cd test && npx vitest run unit/edit-message-cleanup.spec.js --reporter=verbose` for the per-file gate; `cd test && npx vitest run --reporter=verbose` for the full-suite gate. Note the full-suite total drifts when other concurrent agents are simultaneously touching other spec files in a multi-agent slimming session — report the actual observed number, don't force it to match a stale expected total in the directive.
