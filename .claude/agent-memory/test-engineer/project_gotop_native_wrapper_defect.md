---
name: project-gotop-native-wrapper-defect
description: Live _0706cde is a wrapper around the native go-bottom role=button; fix landed 2026-11-08 and go-top fixtures now use the real two-level shape
metadata:
  type: project
---

On the live page the floating bar's first child is `div._0706cde` wrapping the real `div[role=button].ds-button--floating.ds-button--circle`. The fix (clone the inner role=button; fallback skips matches inside `.dsw-gotop` via closest()) landed uncommitted 2026-11-08. `createNativeButton()` in test/helpers/go-top-fixtures.js now returns a detached copy of that wrapper taken from conv2-finished-message-list.html, and `insertNativeButton(injectParent)` inserts it before the composer card (real order). A probe running the go-top specs against HEAD locate/render code went 5 red (button clone-path x2, locate self-detection, mutant-killers stacked-to-solo x2).

**Why:** hand-built flat fixtures hid a self-detection loop.

**How to apply:** never append a native button after the composer or build it flat; use insertNativeButton. Variant-class edits must target `nativeBtn.querySelector('[role="button"]')`, not the wrapper.
