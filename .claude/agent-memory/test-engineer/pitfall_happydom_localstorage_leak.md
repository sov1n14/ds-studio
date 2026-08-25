---
name: pitfall-happydom-localstorage-leak
description: happy-dom localStorage persists across tests in a file; i18n specs must removeItem('ds_studio_locale') before _reset()+init()
metadata:
  type: project
---

happy-dom's `localStorage` is NOT cleared between tests. Any spec calling `dsI18n.setLocale('en')` persists `ds_studio_locale`, and since utils/i18n.js `init()` honours the stored preference, the next test starts in English.

**Why:** U2 removed autoInit from utils/i18n.js and made `init()` read the localStorage preference; 9 i18n.spec.js tests went red on locale bleed.
**How to apply:** in any i18n-touching spec's beforeEach, `localStorage.removeItem('ds_studio_locale')` BEFORE `_reset()` + `await init()`. In test/setup/vitest.setup.js the explicit `await globalThis.dsI18n.init()` must stay above the `globalThis.chrome = {...}` assignment — with chrome undefined it registers no storage listener, keeping getStorageOnChangedListenerCount() baseline intact for background specs. See [[ds-studio-harness]].
