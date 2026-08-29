# DS studio

> **[中文版 README](../README.md)** — Read this project's documentation in Traditional Chinese

DS studio is a Chrome extension designed to optimize the user experience of `chat.deepseek.com`. You can create multiple prompt groups, automatically inject selected prompts into your input before sending messages, and quickly switch between groups for different scenarios.

## Feature Overview

| Category | Features |
|-|-|
| **Prompt System** | Multiple prompt group management, auto-injection, global prompt, conversation binding, blank option mode |
| **Quick Switch** | In-page overlay dropdown with search filtering and drag-to-reorder, bidirectional sync with popup menu |
| **UI Adjustments** | Sidebar auto-hide, conversation/input box width adjustment, collapse thinking process, auto-expand messages, web search, prevent auto-scroll, back to top button |
| **Conversation Export** | One-click export of full conversations to Markdown with thinking process and reference link toggles |
| **Quote Reply** | Select AI reply text and convert to Markdown block quote with one click |
| **System Time Injection** | Automatically appends current system time and timezone offset to each message |
| **Censored Reply Restore** | Automatically restores original replies censored by DeepSeek from streaming data, persisted across refreshes |
| **Cloud Sync** | Cross-device automatic sync of prompt groups and settings with built-in conflict detection and smart merge |
| **JSON Backup & Restore** | Full backup and restore of prompt groups, settings, and censored reply restore records |
| **Mobile** | Sidebar swipe gesture, solving the lack of quick sidebar switching on mobile |

See [FEATURES.md](FEATURES.md) for detailed feature descriptions.

## Installation

### Loading via Chrome Extensions Page (Developer Mode)

1. Download or clone this project to your local machine.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable the **Developer mode** toggle in the upper-right corner.
4. Click the **Load unpacked** button that appears in the upper-left corner.
5. In the file picker dialog, select the project root directory (containing `manifest.json`).
6. Once loaded, the extension will appear in the list and its icon will show in the browser toolbar.

### Post-Installation Notes

- After installation, it is recommended to refresh any open `chat.deepseek.com` tabs to ensure the Content Script loads correctly.
- If the extension icon does not appear in the toolbar, click the puzzle piece icon on the right, find DS studio, and pin it.

## Related Documents

| Document | Language | Description |
|-|-|-|
| [Detailed Feature Guide](FEATURES.md) | English | Complete usage instructions and feature introduction |
| [Privacy Policy](PRIVACY.md) | English | Data handling and privacy protection |
| [Technical Specification](SPEC.md) | English | Technical specifications and module index |
| [Technical Architecture](ARCHITECTURE.md) | English | Architecture design and data flow |
| [Changelog](CHANGELOG.md) | English | Version update history |

## Technology

This project is developed with Manifest V3, conforming to the official Chrome extension security standards. All DOM interception logic runs within Content Scripts, ensuring injected content correctly triggers state updates on the target website. It supports `chrome.storage.sync` for cross-device sync with built-in conflict detection and smart merge.
