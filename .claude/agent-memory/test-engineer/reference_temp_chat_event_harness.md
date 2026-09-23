---
name: temp-chat-event-harness
description: How to drive temporary-chat-delete through real listeners (navigate/beforeunload/keydown) with fetch as the only mocked boundary under happy-dom
metadata:
  type: reference
---

- `window.navigation` is absent in happy-dom; set `window.navigation = new EventTarget()` BEFORE `TemporaryChatDelete.attachListeners()` (attach checks it at call time), dispatch `Object.assign(new Event('navigate'), { destination: { url }, navigationType })`.
- Real delete API: import `utils/deepseek-api.js` (publishes globalThis.DSSDeepSeekApi) and assign the default export of `content/temporary-chat-delete-api.js` to `globalThis.TemporaryChatDeleteApi` (it is not a global under ESM import). Then observe `global.fetch` calls whose URL contains `/chat_session/delete`.
- `vi.spyOn(window.location, 'reload')` works in happy-dom (no need to stubGlobal location, which would break pathname reads).
- invalidation-toast has a module-scope shown flag: `vi.resetModules()` + dynamic import per test.
- Example: test/unit/temporary-chat-delete.invalidated-reload.spec.js. Related: [[stryker-scoped-run]].
