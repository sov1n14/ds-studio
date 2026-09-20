# before all
Log in

---
## Scenario 1 — New chat, before submitting
given: a fresh chat page, `深度思考` enabled, `智能搜索` enabled
when: nothing submitted yet
capture: `new-chat`
rationale: the send button and disabled-state classes have their initial form only here.

---
## Scenario 2 — Generating
given: continue from Scenario 1
when: submit the prompt "Search online for the latest weather", capture WHILE the reply is still streaming
capture: `generating`
rationale: `THINK_LOADING_DOTS_CLASS`, `THINK_SEPARATOR_CLASS`, `THINK_CONTENT_OUTER_CLASS` and `THINK_CONTENT_MODIFIER_CLASS` exist only during generation, and the send button becomes a stop button so `SEND_BUTTON_ICON_SELECTOR` goes to zero.

---
## Scenario 3 — Reply complete, thinking block expanded
given: continue from Scenario 2
when: the reply has finished
capture: `in-conversation`
rationale: per-message toolbar buttons and citation markers (`.ds-markdown-cite`) are present here. The toolbar's structure can be captured from a normal reply; only the censored-reply disabled-state pattern cannot be reproduced on demand.

---
## Scenario 4 — Thinking block collapsed
given: continue from Scenario 3
when: click the thinking block header to collapse it
capture: `think-collapsed`
rationale: the `THINK_CONTENT_*` group is unmounted when collapsed — earlier manual probes contradicted each other purely because one run had it expanded and another collapsed.

---
## Scenario 5 — Edit window open
given: continue from Scenario 3
when: edit the submitted message
capture: `edit-window`

---
## Scenario 6 — Sidebar collapsed
when: collapse the sidebar
capture: `sidebar-collapsed`

---
## Scenario 7 — Sidebar expanded
when: expand the sidebar again
capture: `sidebar-expanded`
rationale: `SIDEBAR_NATIVE_COLLAPSED_SELECTOR` (`div.ca6d4be1`) was measured as present in one state and absent in the other — capturing only one side produces a false "dead selector" verdict.

---
## Scenario 8 — Dropdown or floating menu open
when: open any dropdown (for example the model selector)
capture: `dropdown-open`
rationale: `FLOATING_POSITION_WRAPPER_SELECTOR` (`.ds-floating-position-wrapper`) matched zero across an entire probe run; it likely exists only while a floating menu is open, and `sidebar-auto-hide` depends on it to avoid collapsing while the pointer is over a dropdown.

---
## Scenario 9 — Reply containing a code block
when: submit a prompt that reliably produces code, for example "Write a hello world in Python"
capture: `code-block`
rationale: `CODE_BLOCK_CLASS` (`md-code-block`) matched zero across an entire probe run because no captured reply contained code.

---
## Scenario 10 — Long, scrollable conversation
given: a conversation long enough that the message area overflows
capture: `long-conversation`
rationale: a short conversation does not overflow, and `GO_TOP_NATIVE_BUTTON_CLASS` appears only once the content is scrollable. A v4.33.20 bug was caused specifically by the non-overflowing case, so both must be observable.

---
## Scenario 11 — Temporary chat
when: start a temporary chat
capture: `temporary-chat`
rationale: `content/temporary-chat-fiber-delete.js` hardcodes `div.dc04ec1d` and runs in the MAIN world so it cannot import from the shared selectors module — it is the most fragile selector in the codebase and has never been verified against the live page.

---
## Out of scope — Censored reply
A censored reply (where DeepSeek retracts its own answer, leaving a toolbar whose 2nd and 5th buttons are disabled) cannot be triggered on demand. The toolbar's structure itself IS capturable from any completed reply in Scenario 3; only the disabled-state pattern cannot be reproduced, so `censor-reply-restore` detection logic must stay covered by unit tests alone.
