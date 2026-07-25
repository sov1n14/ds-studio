---
name: gotop-v2-9-gating-toggle
description: go-top.js Change A (injection gating) and Change B (scroll toggle) test updates — what changed, what to watch for
metadata:
  type: project
---

Change A (injection gating, _tryConnectDom):
- _tryConnectDom now gates on INJECT_PARENT_SELECTOR (.aaff8b8f) OR _getNativeButton(), NOT _getAnchor().
- MAX_RETRIES raised to 120 (was 20); RETRY_INTERVAL stays 500ms.
- On cap exceed: gives up silently (console.warn only), no button injected, no timer scheduled, _enableRetryCount reset to 0.
- _injectAsFallback is DELETED. _injectButton with empty DOM returns false / _button null. dsw-gotop--fixed class no longer exists anywhere.

Change B (scroll toggle, scrollToTopAndWait):
- Second call while _locked aborts first scroll via _scrollReject({ success:false, reason:'stopped-by-user' }) and returns undefined (not a promise).
- _locked resets to false after abort.
- aria-disabled stays "false" throughout a scroll; it is never set to "true".
- Route-change abort still rejects with reason:'aborted'.

Key fix for enable/disable and setupStorageListener tests:
- Both beforeEach blocks need .aaff8b8f (INJECT_PARENT_SELECTOR) added to the DOM.
- Without it _tryConnectDom schedules a retry instead of injecting immediately, so _button stays null and `enable creates button` fails.

**How to apply:** Whenever go-top tests touch enable(), setupStorageListener, or any path through _tryConnectDom, the DOM must contain .aaff8b8f or a native ._0706cde button so the gating check passes synchronously.
