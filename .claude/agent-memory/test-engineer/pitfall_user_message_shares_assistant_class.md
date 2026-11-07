---
name: pitfall-user-message-shares-assistant-class
description: Live DeepSeek user .ds-message also carries _63c77b1, so `.ds-message._63c77b1` queries in tests hit the user message first once fixtures use real markup (2026-11-08)
metadata:
  type: project
---

On the live page the user message is `div.d29f3d7d.ds-message._63c77b1 > div > .ds-collapsible-text > div > span`, so `_63c77b1` does not distinguish assistant from user. Old censor specs used `document.querySelector('.ds-message._63c77b1')` after `buildChatPair()` to fetch "the assistant"; with the real-markup helper (2026-11-08) that returns the user message, making null-assertions vacuous and positive ones red (session-switch spec ~line 350).

**Why:** hand-written fixtures gave only the assistant that class, hiding the shared class and propping up ASSISTANT_MESSAGE_SELECTOR.

**How to apply:** take assistant elements from `buildChatPair()` return values or `createAssistantItem()` in `test/helpers/censor-reply-restore-fixtures.js`; never from a hash-class query. The snapshot `test/fixtures/ds-snapshots/conv2-finished-visible-items.html` lost `.ds-collapsible-text` during sanitization; use `conv2-finished-visible-items-collapsible.html` for user-message structure. Related: [[reference-ds-locator-probe-snapshots]].
