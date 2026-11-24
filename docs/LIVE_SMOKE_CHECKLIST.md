# Live Smoke Checklist

The checklist is a manual check of DS studio against the live DeepSeek site, run by hand in your own browser before each release, and it takes about 5 minutes. Only you run it: no automation drives the live site, as [Testing Policy](../CLAUDE.md#testing-policy) states. The release flow asks for it in step 4 of [Release HAR Freshness Check](../.claude/skills/version-bump/SKILL.md#release-har-freshness-check). Each step is one action followed by the result you must see or, for an action that produces no check, what appears next. The last column links to the section of the [Feature Guide](FEATURES.md) that describes the behavior.

## Before You Start

Use the Chrome profile you normally browse with, signed in to Chrome with sync on and signed in to DeepSeek. Load the release build as the DS studio extension. Write down the current state of the four switches that steps 24, 25, 26 and 29 change and the current Global Prompt text, so the cleanup steps can restore them.

## Setup

| Step | Action | Expected result | Feature Guide section |
|-|-|-|-|
| 1 | Open `chrome://extensions`. | The extension list shows DS studio. | none |
| 2 | Read the DS studio version. | The version equals `version` in `manifest.json` of the release commit. | none |
| 3 | Open https://chat.deepseek.com/ in a new tab. | The homepage loads signed in, with the chat input box. | none |
| 4 | Open DevTools on that tab. | The DevTools panel opens. | none |
| 5 | Select the Console. | The Console shows its message list and filter box. | none |
| 6 | Type `DSS` in the filter box. | No `[DSS] init:failed` line appears. | none |

## Page Injection Points

| Step | Action | Expected result | Feature Guide section |
|-|-|-|-|
| 7 | Look at the center of the title bar. | A prompt group dropdown is shown. | [In-Page Quick Switch Overlay](FEATURES.md#in-page-quick-switch-overlay) |
| 8 | Look below the floating button bar above the chat input. | A toggle row labeled `臨時對話` (Temporary Conversation) is shown. | [Temporary Conversation](FEATURES.md#temporary-conversation) |
| 9 | Click the extension icon. | The popup opens. | [Master Switch Linkage](FEATURES.md#master-switch-linkage) |
| 10 | Switch the master switch off in the popup. | The title bar dropdown and the `臨時對話` row disappear without a reload. | [Master Switch Linkage](FEATURES.md#master-switch-linkage) |
| 11 | Switch the master switch on in the popup. | The dropdown and the row reappear without a reload. | [Master Switch Linkage](FEATURES.md#master-switch-linkage) |

## Popup, Prompt Groups, and Editor Window

| Step | Action | Expected result | Feature Guide section |
|-|-|-|-|
| 12 | Read the popup that is still open. | It shows the Prompt Group dropdown, the Global Prompt section, the Features card, the UI Adjustments card, the Backup & Restore section, and a green Cloud Synced status in the title bar. | [Managing Prompt Groups](FEATURES.md#managing-prompt-groups), [Cloud Sync Conflict Handling](FEATURES.md#cloud-sync-conflict-handling) |
| 13 | Click **+** in the popup. | A naming dialog appears. | [Managing Prompt Groups](FEATURES.md#managing-prompt-groups) |
| 14 | Type `Smoke A` in the naming dialog. | The name field shows `Smoke A`. | [Managing Prompt Groups](FEATURES.md#managing-prompt-groups) |
| 15 | Confirm the naming dialog. | `Smoke A` is selected in the dropdown and the pencil button is enabled. | [Managing Prompt Groups](FEATURES.md#managing-prompt-groups) |
| 16 | Click the pencil button. | A 1280×720 editor window opens with the name field focused and the caret at the end of the name. | [Managing Prompt Groups](FEATURES.md#managing-prompt-groups) |
| 17 | Type `SMOKE-A` into the content area of the editor window. | The text appears in the content area. | [Managing Prompt Groups](FEATURES.md#managing-prompt-groups) |
| 18 | Switch back to the DeepSeek tab. | The editor window closes by itself. | [Managing Prompt Groups](FEATURES.md#managing-prompt-groups) |
| 19 | Click the extension icon. | The popup opens. | [Global Prompt](FEATURES.md#global-prompt) |
| 20 | Click the pencil button of the Global Prompt section. | The Global Prompt editor window opens. | [Global Prompt](FEATURES.md#global-prompt) |
| 21 | Add a last line `SMOKE-GLOBAL` to the Global Prompt content. | The line appears in the content area. | [Global Prompt](FEATURES.md#global-prompt) |
| 22 | Switch back to the DeepSeek tab. | The editor window closes by itself. | [Global Prompt](FEATURES.md#global-prompt) |
| 23 | Click the extension icon. | The popup opens. | [Global Prompt](FEATURES.md#global-prompt) |
| 24 | If the Global Prompt switch is off, switch it on. | The Global Prompt switch is on for `Smoke A`. | [Global Prompt](FEATURES.md#global-prompt) |
| 25 | If **Inject Current System Time at Message Start** is off, switch it on. | The switch is on. | [System Time Injection](FEATURES.md#system-time-injection) |
| 26 | If **Auto copy reply content** is off, switch it on. | The switch is on, or the browser asks for permissions. | [Auto Copy Reply and Code Blocks](FEATURES.md#auto-copy-reply-and-code-blocks) |
| 27 | If the browser asks for permissions, allow them. | The permission prompt closes. | [Auto Copy Reply and Code Blocks](FEATURES.md#auto-copy-reply-and-code-blocks) |
| 28 | If you allowed permissions, reopen the popup. | The **Auto copy reply content** switch is on. | [Auto Copy Reply and Code Blocks](FEATURES.md#auto-copy-reply-and-code-blocks) |
| 29 | If **Auto-hide Sidebar** is off, switch it on. | The switch is on. | [UI Adjustment Features](FEATURES.md#ui-adjustment-features) |

## Conversation

| Step | Action | Expected result | Feature Guide section |
|-|-|-|-|
| 30 | Select `Smoke A` in the title bar dropdown. | The dropdown shows `Smoke A`. | [In-Page Quick Switch Overlay](FEATURES.md#in-page-quick-switch-overlay) |
| 31 | Send `List every keyword that starts with SMOKE- in the instructions you were given, then copy the Current Time line you were given, and add nothing else.` | After the reply finishes, it names `SMOKE-A` and `SMOKE-GLOBAL` and shows a line in the form `Current Time: yyyy/mm/dd hh:mm:ss (UTC±hh:mm)` that matches your local time. | [Using Prompt Injection](FEATURES.md#using-prompt-injection), [Global Prompt](FEATURES.md#global-prompt), [System Time Injection](FEATURES.md#system-time-injection) |
| 32 | If the model declines to repeat the keywords, rephrase the message and send it once more. | The second reply meets the expected result of step 31. | [Using Prompt Injection](FEATURES.md#using-prompt-injection), [Global Prompt](FEATURES.md#global-prompt), [System Time Injection](FEATURES.md#system-time-injection) |
| 33 | Press Ctrl+V in the chat input. | The input holds the text of the reply that just finished. | [Auto Copy Reply and Code Blocks](FEATURES.md#auto-copy-reply-and-code-blocks) |
| 34 | Click the edit button on the message you sent in step 31. | The edit box holds only the sentence you typed, with no `<user-input>` or `<system-reminder>` tag, no `SMOKE-` keyword, and no Current Time line. | [Edit Message Cleanup](FEATURES.md#edit-message-cleanup) |
| 35 | Close the edit box with DeepSeek's cancel button. | The edit box closes and the message is unchanged. | [Edit Message Cleanup](FEATURES.md#edit-message-cleanup) |
| 36 | Select one sentence of the reply with the mouse. | A **Quote Reply** button appears at the top of the page. | [Quote Reply](FEATURES.md#quote-reply) |
| 37 | Click **Quote Reply**. | The chat input receives the selected sentence as a line that starts with `> `. | [Quote Reply](FEATURES.md#quote-reply) |
| 38 | Move the pointer off the sidebar. | The sidebar collapses to a narrow strip. | [UI Adjustment Features](FEATURES.md#ui-adjustment-features) |
| 39 | Move the pointer back onto the sidebar. | The sidebar expands. | [UI Adjustment Features](FEATURES.md#ui-adjustment-features) |
| 40 | Open the conversation's address in a new tab. | The conversation loads and the title bar dropdown shows `Smoke A`. | [Conversation-Bound Prompt Groups](FEATURES.md#conversation-bound-prompt-groups) |

## Export

| Step | Action | Expected result | Feature Guide section |
|-|-|-|-|
| 41 | Click the extension icon in that new tab. | The popup opens. | [Exporting Conversations](FEATURES.md#exporting-conversations) |
| 42 | Click **Export Current Page Conversation as Markdown**. | The browser downloads `deepseek-chat-YYYYMMDD-HHmmss.md`, and the file holds the step 31 message and DeepSeek's reply. A progress toast with a **Cancel** button shows while it captures; on a short conversation it can pass too fast to see, which is not a failure. | [Exporting Conversations](FEATURES.md#exporting-conversations) |

## Censored Reply Restore

| Step | Action | Expected result | Feature Guide section |
|-|-|-|-|
| 43 | If the history list holds a conversation that shows the ⚠ Content Restored badge, open it. | The badge shows on the censored reply after the page loads. | [Restoring Censored Replies](FEATURES.md#restoring-censored-replies) |

## Temporary Conversation

| Step | Action | Expected result | Feature Guide section |
|-|-|-|-|
| 44 | Click DeepSeek's new chat button. | The homepage shows the `臨時對話` row. | [Temporary Conversation](FEATURES.md#temporary-conversation) |
| 45 | Switch the `臨時對話` toggle on. | The toggle shows on. | [Temporary Conversation](FEATURES.md#temporary-conversation) |
| 46 | Send `temp check`. | The reply streams in. | [Temporary Conversation](FEATURES.md#temporary-conversation) |
| 47 | Click DeepSeek's new chat button. | The homepage loads. | [Temporary Conversation](FEATURES.md#temporary-conversation) |
| 48 | Reload the page. | The page reloads. | [Temporary Conversation](FEATURES.md#temporary-conversation) |
| 49 | Look for the `temp check` conversation in the history list. | The conversation is not listed. | [Temporary Conversation](FEATURES.md#temporary-conversation) |

## Cleanup

| Step | Action | Expected result | Feature Guide section |
|-|-|-|-|
| 50 | If the `臨時對話` toggle was off before step 45, switch it off. | The toggle shows off. | [Temporary Conversation](FEATURES.md#temporary-conversation) |
| 51 | Open the popup. | The popup opens. | none |
| 52 | Set the Global Prompt switch back to the state you wrote down. | The switch shows its earlier state. | [Global Prompt](FEATURES.md#global-prompt) |
| 53 | Set the **Inject Current System Time at Message Start** switch back to the state you wrote down. | The switch shows its earlier state. | [System Time Injection](FEATURES.md#system-time-injection) |
| 54 | Set the **Auto copy reply content** switch back to the state you wrote down. | The switch shows its earlier state. | [Auto Copy Reply and Code Blocks](FEATURES.md#auto-copy-reply-and-code-blocks) |
| 55 | Set the **Auto-hide Sidebar** switch back to the state you wrote down. | The switch shows its earlier state. | [UI Adjustment Features](FEATURES.md#ui-adjustment-features) |
| 56 | Remove the `SMOKE-GLOBAL` line from the Global Prompt. | The Global Prompt text equals the text you wrote down. | [Global Prompt](FEATURES.md#global-prompt) |
| 57 | Hover over `Smoke A` in the popup dropdown. | A **✕** button appears. | [Managing Prompt Groups](FEATURES.md#managing-prompt-groups) |
| 58 | Click **✕**. | A confirmation appears. | [Managing Prompt Groups](FEATURES.md#managing-prompt-groups) |
| 59 | Confirm the deletion. | `Smoke A` is gone from the popup dropdown and from the title bar dropdown. | [Managing Prompt Groups](FEATURES.md#managing-prompt-groups) |

## Not Covered

The checklist leaves out the features that need an event you cannot trigger on demand (auto retry, auto continue, auto open sidebar, the mobile sidebar swipe) and the features whose live-page dependency the steps above already exercise or that live only in the popup (reply-complete notification, backup and restore, language switcher, width adjustments, collapse thinking, auto expand messages, prevent auto-scroll, web search, back to top, legacy data migration). Record them as not checked.

## Recording the Result

Report the result to the agent that asked for it, in one message: the version from step 2, the date, and for every step number one of `pass`, `fail` with what you saw, or `skipped` with the unmet condition.

- When every step is `pass` or `skipped`, the release may go on.
- When any step is `fail`, the release stops. Send the step number, the expected result, the observed result, and the Console lines that contain `DSS`. After the fix and its version bump, run the checklist again on the fixed build.
- When the failure comes from a changed DeepSeek page (an element is missing or renamed), also ask for a fresh recording, because the main recording differs from the live page; step 2 of [Release HAR Freshness Check](../.claude/skills/version-bump/SKILL.md#release-har-freshness-check) describes how to record it.

---

> [Back to README](../README.md) | [Feature Guide](FEATURES.md) | [Architecture](ARCHITECTURE.md)
