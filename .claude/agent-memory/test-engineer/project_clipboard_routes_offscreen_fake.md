---
name: clipboard-routes-offscreen-fake
description: test/unit/clipboard-routes.spec.js red phase (2026-11-08) - offscreen-world fake of chrome.offscreen + runtime.sendMessage, per-test fresh module via vi.resetModules + glob reload, oracle results
metadata:
  type: project
---

The spec fakes the offscreen trust boundary as one stateful world (phase none / creating / ready): createDocument while creating or ready rejects "Only a single offscreen document may be created.", a send before ready rejects "Could not establish connection. Receiving end does not exist.", hasDocument and getContexts see only a ready document, sendMessage supports promise and callback forms (lastError only inside the callback). Knobs are createFailures (reject, throw, concurrent-creator), dropDeliveries (the document vanishes) and offscreenAnswer.

**Why:** a world with Chrome's rules lets a naive implementation (no dedupe, retry without recreate) fail by consequence instead of by asserting internal calls. A per-test fresh module works through delete global, vi.resetModules() and the import.meta.glob loader again; the re-published global proves the module re-ran.

**How to apply:** for an SW route holding module state, reuse that reload. Oracle check killed 17 wrong oracles; skip-has and relative-url survive by design (both allowed). Open questions: timeout of createDocument or send, offscreen resolving undefined. See [[red-phase-loader-pattern]], [[scratch-and-oracle-check]].
