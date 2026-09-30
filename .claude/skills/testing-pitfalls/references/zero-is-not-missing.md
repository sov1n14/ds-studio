# Zero Is Not Missing: Fallback Inputs

**Cause**: v4.35.3 — `measure()` in `content/preset-dropdown.width.js` computed `parseFloat(computed.gap) || 4`, so a real `gap: 0px` became 4px and the dropdown rendered 4px too wide. The gap test in `test/unit/preset-dropdown.width.spec.js` only varied between non-zero values (4px → 11px), so `||` never saw a 0.

**Cause** (mock equals fallback): v4.35.3 — `_applyStackedOffset` in `content/go-top.render.combined.js` computed `parseFloat(nativeStyle.marginBottom) || 20`, so the native button's real `margin-bottom: 0px` became 20 and left a 28px gap above it instead of the documented 8px. The "readable geometry" test in `test/unit/go-top.inject.spec.js` mocked `marginBottom: '20px'` — the same value as the fallback — so reading the value and falling back produced identical output.

**Solution**: both sites parse once and use `Number.isFinite(parsed) ? parsed : fallback` (4 for the gap, 20 for the margin), so the fallback applies only to NaN (`''`, `'auto'`, `'normal'`). `test/unit/preset-dropdown.width.spec.js` adds a 0px → 4px gap case; on pre-fix code it failed with "accounts for the trigger computed gap (0px -> 4px changes width by 4): expected +0 to be 4". `test/unit/go-top.inject.spec.js` asserts the 8px visible gap for native margin-bottom 0 / 12 / 20 / 32px and the fallback for `''` / `'auto'`; on pre-fix code the 0px case failed with "go-top margin-bottom was 62px: expected 28 to be 8".

**Prevention**: `x || default` over a parsed number treats a legitimate 0 as missing — code MUST use a finite / NaN check instead. A test of any value-or-fallback path MUST include the zero value, and its mocked inputs MUST differ from the fallback value, so "read the input" and "fell back" produce different outputs. Vary each input across several values, including 0 and at least one on each side of the fallback.

**Check**: For every `||`, `??`, or default-parameter fallback in the code under test, list the mocked inputs and confirm one is 0 (or the type's other falsy-but-valid value) and none equals the fallback. Then replace the read with the constant fallback and confirm a test goes red.
