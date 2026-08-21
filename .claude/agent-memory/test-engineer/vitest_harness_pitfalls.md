---
name: vitest-harness-pitfalls
description: Non-obvious behaviours of this repo's vitest harness that cost real debugging time - runner cwd, shared chrome mock onChanged echo, ESM hoisting vs spec-local chrome mocks
metadata:
  type: project
---

Three harness facts that are not visible from reading a spec file.

**Why:** each one produced a misleading failure (a suite-wide `chrome is not defined`, a phantom duplicate event, a spec whose mock nobody listened to) that looked like a production regression and was not.

**How to apply:**

1. The vitest config and `package.json` live in `test/`, not the repo root. Running `npx vitest` from the root silently picks up a default config with **no setup file**, so every spec fails with `chrome is not defined`. Always run from `test/` (`cd test && npx vitest run unit/<spec>`).
2. `InMemoryStorageMock.set()` notifies `chrome.storage.onChanged` **synchronously in the writing context** - which real Chrome also does. Any module that both writes a key and syncs on that key's `onChanged` therefore reacts to its own write. In `temporary-chat-toggle.js` this makes one user toggle dispatch `dss-temporary-chat-changed` twice (once directly, once via the flag module's cross-tab subscriber). Never assert an exact dispatch count for such an event; assert the value carried by every dispatch. The old hand-rolled inline mocks hid this because their `onChanged` never fired.
3. `InMemoryStorageMock.get()` resolves through `setTimeout(0)`, so `await`ing anything that reads storage **hangs under `vi.useFakeTimers()`**.
4. Static `import` is hoisted above all top-level statements, so a spec-local `global.chrome = {...}` assignment always runs *after* the module under test has captured whatever the setup file installed. Any collaborator or bundle-part global a module resolves at load time must be preloaded in `test/setup/vitest.setup.js`, never assigned in the spec body.
