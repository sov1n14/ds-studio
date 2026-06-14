# DS studio

DS studio is a Chrome extension designed to enhance the experience of using `chat.deepseek.com`. You can create multiple prompt groups, automatically inject selected prompts into your input before sending messages, and quickly switch between different scenarios.

## Feature Overview

| Category | Feature |
|-|-|
| **Prompt System** | Multi-prompt-group management, auto-injection, global default prompt, conversation binding, blank option mode |
| **Quick Switching** | In-page Overlay dropdown with search filtering and drag-to-reorder, bidirectional sync with popup menu |
| **UI Adjustments** | Auto-hide sidebar, conversation/input box width adjustment, collapse thinking process, back-to-top button |
| **Conversation Export** | One-click export full conversation as Markdown, with toggle for thinking process and reference links |
| **Quote Reply** | Select AI reply text and convert it to Markdown blockquote with one click |
| **System Time Injection** | Automatically append current system time and timezone offset to each message |
| **Censored Reply Recovery** | Automatically restore original replies censored by DeepSeek from stream data, persists across refreshes |
| **Cloud Sync** | Cross-device automatic sync of prompt groups and settings, with built-in conflict detection and smart merge |
| **JSON Backup & Restore** | Full backup and restore of prompt groups, settings, and censored reply recovery records |
| **Mobile Support** | Sidebar swipe gesture to solve the lack of quick sidebar switching on mobile |

For detailed feature guide, see [FEATURES.md](FEATURES.md).

## Installation

### Load via Chrome Extensions Page (Developer Mode)

1. Download or clone this repository to your local machine.
2. Open Chrome browser, navigate to `chrome://extensions/` in the address bar.
3. Enable the **Developer mode** toggle in the top-right corner.
4. Click the **Load unpacked** button that appears in the top-left corner.
5. In the file picker dialog, select the project root directory (containing `manifest.json`).
6. Once loaded successfully, the extension will appear in the list with its icon in the browser toolbar.

### Post-Installation Notes

- After installation, it is recommended to refresh any open `chat.deepseek.com` tabs to ensure the Content Script loads correctly.
- If the extension icon does not appear in the toolbar, click the puzzle piece icon on the right, find DS studio, and pin it.

## Related Documents

- [Detailed Feature Guide](FEATURES.md) — Complete usage instructions and feature introduction
- [Specification](<../SPEC.md>) — Technical specification and module index (Chinese)
- [Architecture](<../ARCHITECTURE.md>) — Architecture design and data flow (Chinese)
- [Changelog](<../CHANGELOG.md>) — Version history (Chinese)

## Development Technologies

This project is built with Manifest V3, complying with Chrome extension official security standards. All DOM interception logic runs within Content Scripts to ensure injected content properly triggers target site state updates. Supports `chrome.storage.sync` for cross-device synchronization, with built-in conflict detection and smart merge mechanisms.
