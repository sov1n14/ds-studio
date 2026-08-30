# DS studio Feature Guide

## Table of Contents

- [Managing Prompt Groups](#managing-prompt-groups)
- [Global Prompt](#global-prompt)
- [Using Prompt Injection](#using-prompt-injection)
- [Conversation-Bound Prompt Groups](#conversation-bound-prompt-groups)
- [In-Page Quick Switch Overlay](#in-page-quick-switch-overlay)
- [Temporary Conversation](#temporary-conversation)
- [UI Adjustment Features](#ui-adjustment-features)
- [Back to Top Button](#back-to-top-button)
- [Mobile Sidebar Swipe Gesture](#mobile-sidebar-swipe-gesture)
- [Mobile Homepage Cleanup](#mobile-homepage-cleanup)
- [Auto Retry](#auto-retry)
- [Exporting Conversations](#exporting-conversations)
- [Quote Reply](#quote-reply)
- [Edit Message Cleanup](#edit-message-cleanup)
- [System Time Injection](#system-time-injection)
- [Restoring Censored Replies](#restoring-censored-replies)
- [Backup and Restore Settings](#backup-and-restore-settings)
- [Cloud Sync Conflict Handling](#cloud-sync-conflict-handling)
- [Master Switch Linkage](#master-switch-linkage)
- [Legacy Data Migration](#legacy-data-migration)

---

## Managing Prompt Groups

Prompt Groups are the core feature of DS studio, allowing you to create multiple sets of prompts for different scenarios (code review, translation, writing, etc.) and switch between them quickly.

1. Click the extension icon in the top-right corner of your browser to open the popup menu.
2. In the **Prompt Group** dropdown, select the prompt group you want to use, or keep the blank option to use no prompt group.
3. The dropdown supports:
   - **Search Filtering**: Type keywords to filter prompt group names in real time.
   - **Drag-to-Reorder**: Drag the handle on the left side of a prompt group to adjust its order.
4. Action buttons to the right of the dropdown:
   - **+**: Add a new prompt group (a naming dialog appears; name is required).
   - **Pencil**: Edit the currently selected prompt group's content; disabled when no prompt group is selected.
   - When hovering over a prompt group, a **pin** (set as default) and a **✕** (delete, with confirmation, tooltip "Delete Prompt") button appear.
5. **Setting a default prompt group (pin, v4.18.0)**: Click a group's pin to make it the default. The pin lights up and stays visible without hovering. From then on, every **new conversation** (a new tab, or the new-chat button) opens with that group preselected.
   - New conversations only. Switching to a conversation that already exists (its chat id is in the URL) never changes its prompt group — whether it had one bound before or never had one.
   - Only one default at a time. Clicking another group's pin moves the default there; clicking the lit pin again removes the default, and new conversations go back to preselecting nothing.
   - Deleting the group that is currently the default also clears the default.
   - The default travels with the **Export Settings** backup file and is restored on import.
6. Click the pencil button to edit prompt content and name in a dedicated 1280×720 editor window, providing ample editing space with auto-save. The name input in the window header is auto-focused but its text is no longer selected (v4.18.2) — the caret sits at the end of the existing name, so typing appends instead of replacing it; repeatedly clicking the pencil button focuses and reloads the existing editor window so the name input is re-focused every time. Press `Esc` to close the editor window (unsaved content is auto-saved first). Switching back to the DeepSeek tab also closes any open editor window automatically (v4.29.0), so editor windows never pile up in the background — `Esc` and the window's close button still work as before; all three close methods save unsaved content first, so nothing is lost.
7. The system allows deleting all custom prompt groups: the dropdown always retains a blank option as the default, and hovering over it reveals a **✕** (delete all prompt groups, with confirmation) button that clears every custom prompt group at once.

## Global Prompt

The Global Prompt is a piece of text that is automatically appended to every conversation, operating independently from per-conversation prompt groups.

- **How to Set**: In the popup menu's **Global Prompt** section, click the pencil button to open the dedicated editor window.
- **Per-Prompt-Group Toggle (v4.20.0)**: The switch on the right side of the card controls whether the global prompt is injected, and **each prompt group remembers its own switch state**. With prompt group A on and prompt group B off, messages sent under A carry the global prompt while messages under B do not. Switching prompt groups updates the switch to reflect that group's own setting. This setting syncs across devices along with the prompt group.
- **The Content Is Still Shared**: Only the toggle is per-group — the global prompt **content** remains a single shared string used by every prompt group.
- **When No Prompt Group Is Selected**: With the blank option selected, or in an unbound conversation, the device-level toggle state is used instead.
- **Existing Prompt Groups**: Prompt groups created before the upgrade are treated as enabled, matching the pre-upgrade behavior.
- **Priority**: The master switch (top-right) has the highest priority — when the master switch is off, no injection occurs regardless of the global switch state.

## Using Prompt Injection

1. Go to `chat.deepseek.com`, type your message normally, and send it.
2. The extension automatically prepends the currently selected prompt (and the global prompt, if enabled) to your message in the background.
3. You can switch prompt groups via the dropdown at any time without refreshing the page.
4. Different conversations can be independently bound to different prompt groups — the system automatically restores the prompt group you last set for a conversation based on its UUID.
5. Different browser tabs operate independently — each tab remembers its currently selected prompt group.
6. When you send the first message in a new conversation, the system automatically binds the currently selected prompt group to the newly generated conversation UUID.

### Using No Prompt Group

Select the blank option in the dropdown. The pencil button for editing the prompt group will be disabled, and the system will not inject any prompt group content.
If you have set a Global Prompt with its toggle enabled, that content will still be injected — with no prompt group selected, the toggle falls back to the device-level state.

## Conversation-Bound Prompt Groups

Each conversation can be independently bound to a different prompt group:

- When switching conversations, the dropdown automatically switches to the bound prompt group.
- After sending the first message in a new conversation, the system automatically binds the currently selected prompt group to the new conversation UUID.
- Different browser tabs are independent: each tab can set a different prompt group without affecting others.

## In-Page Quick Switch Overlay

A prompt group dropdown is displayed directly in the center of the title bar at the top of the DeepSeek conversation page, allowing quick switching without opening the popup menu:

- **Bidirectional Sync**: Changes made in either the overlay or the popup menu are immediately reflected in the other.
- On mobile (< 768px), uses gap-mode positioning between buttons.
- Built-in auto-stabilization: continuously adjusts position on page load until the layout is fully settled, ensuring it does not get stuck at an incorrect early measurement after a refresh.

## Temporary Conversation

On the `chat.deepseek.com` homepage, a "toggle + Temporary Conversation" control appears 38px below `div.aaff8b8f` (toggle on the left, label on the right):

- **Purpose**: When turned on, any **new conversation created from the homepage** is marked as temporary. When you leave that temporary conversation, the extension automatically calls the DeepSeek deletion API to remove it — ideal for one-off questions you do not want to keep.
- **Only newly created conversations are deleted**: Whether a conversation is temporary is determined by whether the `POST /api/v0/chat_session/create` API was called. **Existing conversations opened from the history list are never marked and never deleted** — even with the toggle on, entering and leaving a history conversation does not delete it.
- **Default off**: The toggle defaults to off. When off, no new conversations are marked.
- **Already-marked conversations after turning off**: If you created temporary conversations while the toggle was on and then turn it off, those conversations are still deleted when you leave them (the mark belongs to the conversation itself). Turning off the toggle only stops **future** new conversations from being marked.
- **Toggle exists only on the homepage**: When you leave the homepage (the URL is no longer `chat.deepseek.com/`), the toggle is automatically removed from the page; returning to the homepage re-displays it. Removing the toggle does not change its on/off state.
- **State persistence**: The toggle state and the tracked conversation are stored in different scopes.
  - The **toggle state** is stored in `chrome.storage.local` (key `dss-temporary-chat-enabled`), so it **persists across tabs and browser restarts**: if you left it on last time, it is still on the next time you open the browser and visit DeepSeek. Multiple tabs open at the same time also sync to the same state in real time.
  - The **currently tracked temporary conversation** is stored in the tab's `sessionStorage` (key `dss-temporary-chat-uuid`), valid only for that tab's session (including in-page navigation and page refresh); it is lost when the tab is closed.
- **Scenarios that trigger deletion** (only for already-marked temporary conversations):
  - Navigating to another conversation, returning to the homepage, back/forward navigation, or any other navigation away from the temporary conversation.
  - Typing a different URL in the address bar, clicking an external link, closing the tab, or closing the browser.
- **Scenarios that do NOT trigger deletion**:
  - Page refresh (F5, the refresh button, Ctrl+R / Cmd+R).
  - Navigating to the current URL (typing the current URL in the address bar and pressing Enter, which is equivalent to re-entering the page).
  - Entering or leaving a non-temporary history conversation.
- **Independent operation**: This feature is not controlled by the master switch (top-right); it is independently controlled by its own homepage toggle.

### Cross-Device Protection (v4.31.1)

When a temporary conversation is being used in a tab, the extension automatically maintains a lease for that conversation, preventing remediation mechanisms on other devices from deleting it while it is still in use:

- **Heartbeat renewal**: An immediate heartbeat is sent when tracking begins, followed by automatic renewals every 1 minute. The heartbeat is sent from the content script to the background service worker, which updates the lease timestamp for that conversation in the pending-delete queue.
- **Lease TTL**: 10 minutes. Any device's remediation deletion process checks whether the lease has expired before processing a pending-delete item — deletion is performed only when the lease has gone unrenewed for more than 10 minutes. The TTL is set generously to absorb `chrome.storage.sync` propagation delay, background tab timer throttling, and cross-device clock skew.
- **Tab unfreeze catch-up**: When the tab transitions from background to foreground (`visibilitychange`, `pageshow`), an immediate heartbeat is sent to prevent the lease from expiring due to browser timer throttling.
- **Natural stop**: When the tab is closed, crashes, or is forcefully terminated, the heartbeat stops naturally and the lease expires on its own — no device identifier is needed.

### Privacy Guarantee

The Temporary Conversation feature automatically calls the deletion API to remove the conversation from the DeepSeek server after you leave it. The following scenarios describe the effective scope of this guarantee:

- **Guaranteed deletion scenarios**:
  - Normal in-page (SPA) navigation away to another page or conversation.
  - Normally closing the browser tab or window (including closing the entire browser).
- **Delayed deletion (on next browser launch) scenarios**:
  - Computer is forcefully shut down (holding the power button, power outage).
  - Browser crashes or is forcefully terminated by the operating system.

This extension is a browser extension only and has no system-level control outside the browser. If you require the highest level of privacy assurance, close the browser normally before shutting down your computer.

### Known Limitations

| Scenario | Behavior |
|-|-|
| Forced shutdown (power button, power outage) | Conversation persists until the browser is next opened, at which point remediation deletion occurs |
| Browser crash / forcefully terminated by OS | Same as above |
| Long idle without opening the browser | Conversation persists until the browser is opened |
| Auth token expires before remediation deletion | Remediation fails; conversation persists permanently |
| Remediation device has never logged into the same DeepSeek account | That device cannot remediate; must wait for a device with a valid token to start up |
| Chrome sync is off, or the device is not signed into the same Chrome account | Cross-device remediation does not occur; each device can only remediate conversations it marked itself |
| The same conversation is in use on another device under the same DeepSeek account | The heartbeat renewal mechanism maintains the lease; other devices do not delete while the lease is active (10-minute TTL) |
| Pending-delete item reaches the retry limit | The item is removed from the queue; the conversation persists permanently with no further notification |
| Browsing in incognito mode or a non-syncing profile | `chrome.storage.sync` may be unavailable or behave differently; cross-device remediation may fail |
| Rapid tracking/un-tracking of temporary conversations in a short period | May theoretically hit the `chrome.storage.sync` write-rate limit; a theoretical boundary scenario |

## UI Adjustment Features

In the popup menu's **UI Adjustments** section, you can adjust the following settings:

| Feature | Description |
|-|-|
| **Auto-hide Sidebar** | Automatically collapses the sidebar to 60px width when the mouse leaves it, and expands on mouse hover, saving screen space |
| **Collapse Thinking Process** | Automatically collapses DeepSeek's thinking blocks (reasoning process) when they appear; manually expanded blocks are unaffected. Located in the **Features** card |
| **Auto Expand Messages** | Automatically clicks collapsed expand buttons so all messages are shown expanded by default. When disabled, all expanded messages on screen are collapsed back. Located in the **Features** card, off by default |
| **Prevent Auto-Scroll** | Suppresses the page's downward auto-scroll at all times, instead of only during back-to-top and Markdown export. **Trade-off**: the view no longer follows a streaming AI reply downward, so you scroll yourself; native wheel/trackpad scrolling is unaffected. Located in the **Features** card, off by default |
| **Web Search** | Sets the starting state of the page's smart-search toggle: `On` starts it at `aria-pressed="true"`, `Off` starts it at `"false"`. Applied exactly once per activation event — entering the page, changing this setting in the popup, or turning the master switch back on. After each application the extension releases control, so your own manual toggling sticks until the next activation event. Clicks only on state mismatch, so it never toggles the state away. Controlled by the master switch |
| **Conversation Area Width** | After enabling the toggle, use the slider to adjust the conversation message display width (30%–100% viewport width) |
| **Input Box Width** | After enabling the toggle, use the slider to independently adjust the input box display width (30%–100% viewport width); the input box width is automatically constrained by the conversation area width and will not exceed it |

UI adjustment features are controlled by the master switch (top-right) — when the master switch is off, these adjustments are disabled.

## Back to Top Button

The **Back to Top** button is fully automatic and requires no configuration:

- **Appearance**: Visually identical to DeepSeek's native **Back to Bottom** button (circular, same color and border), with the arrow pointing upward.
- **Trigger**: When you scroll down past the first message, the button appears above the native button in the bottom-right corner.
- **Usage**: Click the button to automatically scroll to the top of the conversation; keyboard (Enter or Space) also works.
- **Stop Mechanism**: The button remains clickable during scrolling — clicking it again stops scrolling at the current position (without restarting).
- **Auto-Hide**: When you are already at the top of the conversation, the button automatically hides and does not take up screen space.
- **No Configuration Needed**: This feature is automatically enabled/disabled with the extension's master switch.
- **Export Integration**: Automatically integrated into the Markdown export flow to ensure full conversation capture.

## Mobile Sidebar Swipe Gesture

This feature only works on mobile devices and requires no configuration:

- **Trigger Method**: Swipe horizontally with your finger within the central 80% area of the DeepSeek conversation page (excluding 10% margins on each side) to open or close the sidebar. Right-swipe (left→right) opens the sidebar; left-swipe (right→left) closes it.
- **Accidental Trigger Prevention**: The system automatically detects swipe direction and distance — only a clear horizontal swipe (≥ 50px, predominantly horizontal, < 500ms) triggers the action; vertical scrolling or brief touches do not activate it.
- **Compatibility**: The trigger area deliberately avoids the screen edges to prevent conflicts with Chrome Android's system back gesture.
- **No Configuration Needed**: This feature is automatically enabled/disabled with the extension's master switch and has no independent toggle.

## Mobile Homepage Cleanup

On mobile devices browsing the DeepSeek homepage (v4.1.0), the extension automatically removes specific decorative DOM elements, resulting in a cleaner page layout:

- **Device Detection**: Determined by touch capability (`navigator.maxTouchPoints > 0`) or mobile user-agent markers (`Mobi`, `Android`, `iPhone`, `iPad`), independent of screen size. On desktop devices this feature is completely inactive with zero overhead.
- **Effective Scope**: Active only on the homepage path (`/`). After leaving the homepage, the MutationObserver remains listening but does not perform removals.
- **Instant Removal**: Uses a MutationObserver on `document.body` subtree changes; target elements dynamically inserted by the DeepSeek SPA are removed immediately.
- **No Independent Toggle**: This feature is controlled by the master switch (top-right) — disabled when the master switch is off.

## Auto Retry

When a DeepSeek response fails (e.g. "The server is busy. Please try again later.") and a retry button appears, the extension clicks it for you:

- **Detection**: Polls the page once per second for the retry button; clicks it once whenever it is present.
- **Retry Count**: Unlimited. As long as the button remains on screen, it retries once per second until a response is produced and the button disappears.
- **Selector Strategy**: Primarily targets DeepSeek's semantic classes `.ds-button--warning.ds-button--circle.ds-button--xs`, with the hashed classes `.a3b9bd76._76a2310` as a fallback, reducing the chance of breakage when DeepSeek ships a front-end change.
- **No Configuration Needed**: This feature is automatically enabled/disabled with the extension's master switch and has no independent toggle. When the master switch is off, the polling timer is stopped entirely and consumes no resources.

## Exporting Conversations

You can export the conversation history from the current DeepSeek chat room as a Markdown (`.md`) file.

1. On the `chat.deepseek.com` page, click the extension icon.
2. Press the **Export current page conversation as Markdown** button.
3. The system automatically scrolls to the top of the conversation, then progressively captures the full conversation content from top to bottom (including messages not yet visible on screen in long conversations). The current progress and the number of messages captured so far are displayed on screen.
4. During capture, you can still type and send messages normally. However, do not manually scroll the conversation history, as this may interrupt the capture.
5. The progress toast carries a **Cancel** button, so you can stop a capture at any time (v4.19.0). Cancelling still exports whatever was collected — the work is not thrown away. The button switches to "Cancelling..." once clicked; the actual stop happens at the next capture step boundary.
6. Once capture is complete, the system automatically downloads the `.md` file and restores your original scroll position.
7. **A long conversation will not interrupt the export** (v4.19.0). As long as new messages keep being captured, the run is never cut short no matter how long it takes. Earlier versions imposed a 120-second total cap, which truncated long conversations and lost their newest messages; that cap has been removed. The run now stops only after 20 continuous seconds with no progress at all.
8. If the capture is interrupted — by a stall, by manual scrolling, or because you cancelled it — the system still exports the content collected so far, and:
   - appends a warning at the end of the file naming the **actual** cause and the number of messages captured;
   - shows a prominent warning toast on the page (v4.19.0). Earlier versions left only a single warning line at the end of the file, which in practice was invisible — in one reported case it landed on line 12209 of a 12209-line file, and the export looked like it had completed normally.

### Export Options

The following export behaviors can be controlled in the popup menu:

| Option | Description |
|-|-|
| **Include Thinking Process in Export** | Choose whether to include the AI's thinking process in the exported Markdown |
| **Include Reference Links in Export** | Choose whether to include search reference links (e.g., `[link-1]`) in the exported Markdown |

## Quote Reply

After selecting text within an AI reply area, a **Quote Reply** floating button appears at the top of the page:

- **Trigger Scope**: Only activates when the user selects text within an AI reply area.
- **Injection Format**: Clicking the button appends the selected content to the input box as a Markdown blockquote (`> content`).
- **Multi-Line Support**: When multiple lines are selected, each line is prefixed with `> `.
- **Auto-Dismiss**: Automatically hides when the selection is cleared, when clicking outside the button area, or when the button scrolls out of the viewport.

## Edit Message Cleanup

When you click DeepSeek's edit message button (v3.2.1), the extension automatically cleans up wrapper tags in the edit box that were injected by prompt injection, so you see only your original input text:

- **Trigger**: Clicking the edit button next to a message (CSS class `d4910adc`); the extension detects the click via event delegation and waits for DeepSeek to asynchronously render the edit textarea.
- **Cleanup Content**: If the textarea content matches the `<user-input>...</user-input>` wrapper format, the wrapper is stripped, keeping only the original input. Outer `<system-reminder>` and other injected content is also removed.
- **Height Adjustment**: After the edit box appears, the container's max-height restriction is automatically removed, and the max-height of related elements is dynamically calculated based on the viewport height, ensuring the edit area has sufficient visible space. The edit box is automatically scrolled into view.
- **Fully Automatic**: This feature is active as soon as the extension is injected; it has no independent toggle and is not gated by the master switch.

## System Time Injection

When enabled, the current system time and local timezone offset are automatically prepended to each sent message.

- **Format**: `Current Time: yyyy/mm/dd hh:mm:ss (UTC±hh:mm)`
- **Example**: `Current Time: 2026/06/14 20:19:32 (UTC+08:00)`
- **Duplicate Prevention**: If the text input area already starts with the `Current Time:` prefix, injection is skipped.
- **Settings Location**: First item in the **Features** card of the popup menu.
- **Master Switch Awareness**: This toggle is disabled when the master switch is turned off.

## Restoring Censored Replies

When DeepSeek replaces the original model reply with messages like "I'm sorry, I cannot answer this question" (content moderation), the extension automatically restores the original reply from the stream data:

- **Operation**: Fully automatic, no configuration required.
- **Display**: Restored replies are marked with a **⚠ Content Restored** badge.
- **Thinking Process**: If the original reply contains a thinking process, it is reconstructed as a collapsible thinking block with the thinking time displayed.
- **Cross-Refresh Persistence**: Restored records are automatically saved locally (up to 200 entries). After refreshing the page or returning to the conversation later, censored messages will still be automatically restored.
- **Backup Management**: In the popup menu's **Backup & Restore** section, you can export/import restoration record backups or clear all restored records with one click.

## Backup and Restore Settings

In the popup menu's **Backup & Restore** section:

| Feature | Description |
|-|-|
| **Backup Settings (Export JSON)** | Download a JSON file containing all prompt groups and settings |
| **Restore Settings (Import JSON)** | Select a previously backed-up JSON file. UI settings are overwritten; prompt groups are merged by ID, keeping the newer version for the same ID; conversation bindings (chatPresetMap) are also merged |
| **Export Restore Records** | Independently backup the restoration records of censored replies |
| **Import Restore Records** | Independently restore restoration records of censored replies |
| **Clear All Restored Records** | Delete all restoration records of censored replies with one click |

## Cloud Sync Conflict Handling

All setting changes (switching prompt groups, editing content, toggling switches, UI adjustments) are instantly saved to both local browser storage and the cloud sync space (`chrome.storage.sync`).

If multiple devices edit prompt groups simultaneously:

1. The next time you open the popup menu, a **Cloud Sync Conflict** dialog will appear.
2. Click **Merge Sync**, and the system will merge prompt groups from both sides by ID, retaining the latest modification (based on the `updatedAt` timestamp).
3. Interface settings are overwritten by the cloud version (except device-local toggles like `isEnabled` and the legacy device-level `globalPromptEnabled` fallback, which are excluded from sync conflict resolution). Since v4.20.0, each prompt group's own `globalPromptEnabled` field lives on the prompt group data itself and therefore syncs and merges along with it.
4. The popup menu title bar displays real-time sync status (green **Cloud Synced**, red **Not Synced**, or **Too Large — Local Only** when total prompt group data exceeds the `chrome.storage.sync` capacity limit, in which case data is kept locally only and cloud sync is skipped).

## Master Switch Linkage

When the master switch (top-right) is turned off, all sub-features are disabled together:

- Auto-hide sidebar
- Collapse thinking process
- Auto expand messages
- Prevent auto-scroll
- Web search toggle
- System time injection
- Conversation area and input box width adjustment
- In-page overlay dropdown
- Back to top button
- Mobile sidebar swipe gesture
- Mobile homepage cleanup

This ensures one-click disabling of all extension behaviors.

## Legacy Data Migration

When upgrading from an older version, existing prompt content is automatically migrated to a **My Prompts** group, requiring no manual action.

---

> [Back to README](../README.md) | [Specification](../SPEC.md) (Chinese) | [Architecture](../ARCHITECTURE.md) (Chinese) | [Changelog](../CHANGELOG.md) (Chinese)
