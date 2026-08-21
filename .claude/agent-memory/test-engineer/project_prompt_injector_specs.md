---
name: project-prompt-injector-specs
description: How the prompt-injector send-button/controller specs are wired after the P6/P14 split, and the shared send-button fixture helper they depend on.
metadata:
  type: project
---

The P6/P14 refactor split prompt injection into `content/prompt-injector.send-button.js` (pure DOM predicates, `globalThis.__DS_PromptInjectorSendButton`) and `content/prompt-injector.controller.js` (`createPromptInjector(ctx)`). Their specs are `test/unit/prompt-injector.send-button.spec.js` and `test/unit/prompt-injector.controller.spec.js`, both DOM-adapter layer (implementation first, tests after).

**Why:** these modules were previously only reachable through `content-script.js`, so a selector regression could only be caught end-to-end. The specs now pin the module boundary directly.

**How to apply:**
- Load them by side-effect import in this order: `ds-selectors.js` -> `prompt-injector.send-button.js` -> `prompt-injector.controller.js`, then read the globals. No `contentScript` import, which keeps `document` free of the host script listeners.
- `createPromptInjector` registers capture-phase `document` listeners that cannot be removed. Create ONE injector per spec file at module scope and back its ctx with a mutable `state` object reset in `beforeEach`; creating one per test stacks listeners and cross-contaminates.
- Stub `requestAnimationFrame` into a hand-flushed queue to observe the suppress-then-redispatch click cycle. Happy-dom clamps `setTimeout(0)` to ~15ms, so timers are not an option here.
- Injected value formats (ground truth, also asserted by `content-script.injection-prefix.spec.js`): prefix is `<system-reminder>\nGLOBAL\n\nPRESET\n</system-reminder>`; full value is optional `Current Time: ...\n\n` + prefix + `\n\n<user-input>\ntext\n</user-input>`; an empty-but-sendable textarea gets prefix only, no `<user-input>`.
- `injectPrefix(textarea, isSendableWithoutText = false)`.
- Shared DOM fixtures live in `test/helpers/send-button-fixtures.js` (lifted out of `content-script.send-button-mobile.spec.js`, which now imports them). Markup is transcribed from real page samples, deliberately not built from the selector constants. Re-run that spec after touching the helper.
- Unpinned and worth clarifying before anyone relies on it: whether `findSendButtonForTextarea` treats `document.body` itself as a searchable ancestor (a send button in a sibling container of the textarea container). Only the "never leaves body" direction is asserted.
