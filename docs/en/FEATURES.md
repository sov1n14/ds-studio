# DS studio Feature Guide

## Table of Contents

- [DS studio Feature Guide](#ds-studio-feature-guide)
  - [Table of Contents](#table-of-contents)
  - [Managing Prompt Groups](#managing-prompt-groups)
  - [Global Default Prompt](#global-default-prompt)
  - [Using Prompt Injection](#using-prompt-injection)
    - [Using No Prompt Group](#using-no-prompt-group)
  - [Conversation-Bound Prompt Groups](#conversation-bound-prompt-groups)
  - [In-Page Quick Switch Overlay](#in-page-quick-switch-overlay)
  - [UI Adjustment Features](#ui-adjustment-features)
  - [Back to Top Button](#back-to-top-button)
  - [Mobile Sidebar Swipe Gesture](#mobile-sidebar-swipe-gesture)
  - [Exporting Conversations](#exporting-conversations)
    - [Export Options](#export-options)
  - [Quote Reply](#quote-reply)
  - [System Time Injection](#system-time-injection)
  - [Restoring Censored Replies](#restoring-censored-replies)
  - [Backup \& Restore Settings](#backup--restore-settings)
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
   - When hovering over a prompt group, additional **✎** (rename) and **✕** (delete, with confirmation) buttons appear.
5. Click the pencil button to edit prompt content in a dedicated 1280×720 editor window, providing ample editing space with auto-save. Repeatedly clicking the pencil button focuses the existing editor window rather than opening a new one.
6. The system allows deleting all custom prompt groups. The dropdown always retains a blank option as the default.

## Global Default Prompt

The Global Default Prompt (Global Prompt) is a piece of text that is automatically appended to every conversation, operating independently from per-conversation prompt groups.

- **How to Set**: In the popup menu's **Global Prompt** section, click the pencil button to open the dedicated editor window.
- **Independent Toggle**: The switch on the right side of the card independently controls whether the global prompt is injected.
- **Priority**: The master switch (top-right) has the highest priority — when the master switch is off, no injection occurs regardless of the global switch state.

## Using Prompt Injection

1. Go to `chat.deepseek.com`, type your message normally, and send it.
2. The extension automatically prepends the currently selected prompt (and the global default prompt, if enabled) to your message in the background.
3. You can switch prompt groups via the dropdown at any time without refreshing the page.
4. Different conversations can be independently bound to different prompt groups — the system automatically restores the prompt group you last set for a conversation based on its UUID.
5. Different browser tabs operate independently — each tab remembers its currently selected prompt group.
6. When you send the first message in a new conversation, the system automatically binds the currently selected prompt group to the newly generated conversation UUID.

### Using No Prompt Group

Select the blank option in the dropdown. The pencil button for editing the prompt group will be disabled, and the system will not inject any prompt group content.
If you have set a Global Default Prompt with its toggle enabled, that content will still be injected.

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

## UI Adjustment Features

In the popup menu's **UI Adjustments** section, you can adjust the following settings:

| Feature | Description |
|-|-|
| **Auto-hide Sidebar** | Automatically collapses the sidebar to 60px width when the mouse leaves it, and expands on mouse hover, saving screen space |
| **Collapse Thinking Process** | Automatically collapses DeepSeek's thinking blocks (reasoning process) when they appear; manually expanded blocks are unaffected |
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

- **Trigger Method**: Swipe right with your finger within the central 80% area of the DeepSeek conversation page (excluding 10% margins on each side) to toggle the sidebar.
- **Accidental Trigger Prevention**: The system automatically detects swipe direction and distance — only a clear rightward swipe (≥ 50px, predominantly horizontal, < 500ms) triggers the action; vertical scrolling or brief touches do not activate it.
- **Compatibility**: The trigger area deliberately avoids the screen edges to prevent conflicts with Chrome Android's system back gesture.
- **No Configuration Needed**: This feature is automatically enabled/disabled with the extension's master switch and has no independent toggle.

## Exporting Conversations

You can export the conversation history from the current DeepSeek chat room as a Markdown (`.md`) file.

1. On the `chat.deepseek.com` page, click the extension icon.
2. Press the **Export current page conversation as Markdown** button.
3. The system automatically scrolls to the top of the conversation, then progressively captures the full conversation content from top to bottom (including messages not yet visible on screen in long conversations). The current progress is displayed on screen.
4. During capture, you can still type and send messages normally. However, do not manually scroll the conversation history, as this may interrupt the capture.
5. Once capture is complete, the system automatically downloads the `.md` file and restores your original scroll position.
6. If the capture times out or is interrupted by manual scrolling, the system will still export the content collected so far, appending a "Content may be incomplete" warning at the end of the file.

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

## System Time Injection

When enabled, the current system time and local timezone offset are automatically prepended to each sent message.

- **Format**: `Current Time: yyyy/mm/dd hh:mm:ss (UTC±hh:mm)`
- **Example**: `Current Time: 2026/06/14 20:19:32 (UTC+08:00)`
- **Duplicate Prevention**: If the text input area already starts with the `Current Time:` prefix, injection is skipped.
- **Settings Location**: Checkbox in the **Features & Export** card of the popup menu.
- **Master Switch Awareness**: This toggle is disabled when the master switch is turned off.

## Restoring Censored Replies

When DeepSeek replaces the original model reply with messages like "I'm sorry, I cannot answer this question" (content moderation), the extension automatically restores the original reply from the stream data:

- **Operation**: Fully automatic, no configuration required.
- **Display**: Restored replies are marked with a **⚠ Content Restored** badge.
- **Thinking Process**: If the original reply contains a thinking process, it is reconstructed as a collapsible thinking block with the thinking time displayed.
- **Cross-Refresh Persistence**: Restored records are automatically saved locally (up to 200 entries). After refreshing the page or returning to the conversation later, censored messages will still be automatically restored.
- **Backup Management**: In the popup menu's **Backup & Restore** section, you can export/import restoration record backups or clear all restored records with one click.

## Backup & Restore Settings

In the popup menu's **Backup & Restore** section:

| Feature | Description |
|-|-|
| **Backup Settings (Export JSON)** | Download a JSON file containing all prompt groups and settings |
| **Restore Settings (Import JSON)** | Select a previously backed-up JSON file. UI settings are overwritten; prompt groups are merged by ID, keeping the newer version for the same ID; conversation bindings (chatPresetMap) are also merged |
| **Export Restore Records** | Independently backup the restoration records of censored replies |
| **Import Restore Records** | Independently restore restoration records of censored replies |
| **Clear All Restored Records** | Delete all restoration records of censored replies with one click |
| **Manual Sync** | Immediately push local data back to the cloud sync space, useful when displaying "Not Synced" |

## Cloud Sync Conflict Handling

All setting changes (switching prompt groups, editing content, toggling switches, UI adjustments) are instantly saved to both local browser storage and the cloud sync space (`chrome.storage.sync`).

If multiple devices edit prompt groups simultaneously:

1. The next time you open the popup menu, a **Cloud Sync Conflict** dialog will appear.
2. Click **Merge Sync**, and the system will merge prompt groups from both sides by ID, retaining the latest modification (based on the `updatedAt` timestamp).
3. Interface settings are overwritten by the cloud version.
4. The popup menu title bar displays real-time sync status (green **Cloud Synced** or red **Not Synced**), along with a **Manual Sync** button.

## Master Switch Linkage

When the master switch (top-right) is turned off, all sub-features are disabled together:

- Auto-hide sidebar
- Collapse thinking process
- System time injection
- Conversation area and input box width adjustment
- In-page overlay dropdown
- Back to top button
- Mobile sidebar swipe gesture

This ensures one-click disabling of all extension behaviors.

## Legacy Data Migration

When upgrading from an older version, existing prompt content is automatically migrated to a **My Prompts** group, requiring no manual action.

---

> [Back to README](../README.md) | [Specification](../SPEC.md) (Chinese) | [Architecture](../ARCHITECTURE.md) (Chinese) | [Changelog](../CHANGELOG.md) (Chinese)
