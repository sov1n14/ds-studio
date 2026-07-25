---
name: project-constant-mirror-redundancy-test
description: Decision method for whether a constant-mirror test (asserts a production constant equals its own literal) should be deleted or kept
metadata:
  type: project
---

A "constant-mirror" test (`expect(SOME_CONSTANT).toBe('literal')`) is NOT vacuous in the mutation sense — changing the constant in production DOES break it. That fact alone is not grounds to keep it. See [[project_mutation_proof_method]] for the general mutation-proof technique this specializes.

**The real question is redundancy, not vacuity:** for each constant, ask "if this value were wrong or changed, would some OTHER test that asserts real observable behavior also fail?"

- **YES (redundant → delete the mirror)**: some other test hardcodes the *same literal* directly in its own DOM/data setup (not by referencing the constant identifier) and asserts behavior driven by it. Mutating the constant breaks that test because production now looks for/produces something the test's hardcoded literal no longer matches.
- **NO (sole tripwire → keep)**: no other test uses the literal independently — either nothing else exercises that code path, or the "covering" test also references the same imported identifier (see gotcha below).

**Critical gotcha — identifier-reuse gives false confidence:** if a behavior test does `el.className = IMPORTED_CONSTANT` (using the same imported binding as production) rather than `el.className = 'the-actual-literal'`, mutating the constant can NEVER break that test — both sides move together. Only a *hardcoded literal* in the test constitutes independent coverage. Always check whether the "covering" test references the identifier or the literal string before crediting it as a YES.

**How to get the mutation evidence without touching production on disk:** write a throwaway script that reads the production file as text, `.replace()`s the one constant's declaration line, writes the mutated text to a scratch `.cjs`/`.mjs` module (outside `content/`/`test/`), and `require()`s it fresh (clear require cache) with a happy-dom `Window` for DOM globals. Re-run the *exact* scenario the suspected covering test builds (same hardcoded class names, same expected arithmetic) against the mutated module and confirm it fails. Delete the scratch script/module to the Recycle Bin afterward.

**Case study (2026-07-25, `test/unit/edit-message-cleanup.spec.js`):** of 9 constants mirrored in one test (`A1`), `REMOVE_MAX_HEIGHT_SELECTOR`, `DYNAMIC_MAX_HEIGHT_SELECTOR`, `HEIGHT_SOURCE_SELECTOR_A/B`, `MAX_HEIGHT_OFFSET_PX` were redundant (Group C/F hardcode the literal class names and formula in DOM setup); `USER_INPUT_REGEX`'s instanceof check was redundant (Group A2-A14 exercise the regex's actual matching behavior). `EDIT_BUTTON_CLASS` and `DETECTION_TIMEOUT_MS` were NOT redundant — Group F/E reference them via the imported identifier, not a hardcoded literal, so mutation-proofed and confirmed they'd never catch a value change. `VALUE_WAIT_TIMEOUT_MS` had zero covering test at all (the spec's own comment admits this). A separate single-assertion mirror `B1` (`MAX_HEIGHT_OFFSET_PX`) and `G1` (`EDIT_SCROLL_GAP_PX`) were both redundant (covered by `B2`'s and `G7`'s hardcoded-arithmetic expected values) and deleted outright — net -2 tests (78→76), `A1` itself stayed as one test with only the 3 non-redundant assertions kept.

**How to apply:** whenever asked to adjudicate a constant-mirror test's fate, do this mechanical check per constant before deleting or keeping anything — never delete on "it looks tautological" alone, and never keep on "it changes when I change the constant" alone.
