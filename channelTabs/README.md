# ChannelTabs

A sleek, browser-style horizontal tab bar for Discord channels, threads, and direct messages.

Open channels in background tabs with middle-click, pin your everyday channels, reorder tabs via drag-and-drop, and switch between active conversations with familiar browser hotkeys (`Ctrl+Tab`, `Ctrl+W`, `Ctrl+1..9`).

---

## ✨ Features

- **Browser-Style Tab Navigation**: Keep multiple channels open across servers and DMs simultaneously.
- **Middle-Click to Open in Background**: Middle-click or `Ctrl+Click` any channel or DM in the sidebar to open it in a new tab without interrupting your current reading flow.
- **Pinned Tabs**: Pin high-frequency channels (like `#general`, active DMs, or bot consoles) to compact icon-only tabs anchored on the left.
- **Live Unread & Mention Badges**: Tabs display real-time white dots for unread messages and red badges for direct mentions.
- **Full Drag-and-Drop Reordering**: Drag tabs left and right smoothly to organize your workspace.
- **Native Context Menu**: Right-click any tab to Pin/Unpin, Close, Close Other Tabs, Close Tabs to the Right, Mark as Read, or Copy Channel Link.
- **Keyboard Shortcuts**:
  - `Ctrl + Tab` / `Ctrl + Shift + Tab`: Cycle next / previous tab
  - `Ctrl + W`: Close active tab
  - `Ctrl + 1` to `Ctrl + 8`: Jump directly to tab 1 through 8
  - `Ctrl + 9`: Jump to the last tab
  - `Ctrl + Shift + T`: Reopen the most recently closed tab
- **Persistent State**: Open and pinned tabs are preserved across Discord restarts using Vencord's local `DataStore`.
- **Zero Webpack Patches**: 100% store and DOM-driven — immune to Discord build updates and regex breakage.

---

## ⚙️ Settings

Accessible under **Settings → Plugins → ChannelTabs**:

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| **Auto Open New Tab** | Boolean | `true` | Opens a new tab when clicking a channel in Discord (or reuses active tab if disabled). |
| **Show Server Icons** | Boolean | `true` | Shows server icons on channel tabs (or user avatars for DMs). |
| **Show Unread Badges** | Boolean | `true` | Displays unread dots and mention counters on tabs. |
| **Close Tab on Middle Click** | Boolean | `true` | Middle-clicking any tab immediately closes it. |
| **Middle Click to Open** | Boolean | `true` | Middle-click (or Ctrl+Click) sidebar channels to open in background. |
| **Keyboard Shortcuts** | Boolean | `true` | Enables `Ctrl+Tab`, `Ctrl+W`, `Ctrl+1..9`, `Ctrl+Shift+T`. |
| **Compact Tabs** | Boolean | `false` | Reduces tab height and padding for compact layouts. |
| **Max Tabs** | Slider | `20` | Prunes oldest inactive tabs when limit is exceeded (5 to 50). |

---

## 📦 Architecture

- **`index.tsx`**: Lifecycle orchestration (`start`/`stop`), DOM mounting observer, keyboard event capturing, and middle-click channel link interception.
- **`state.ts`**: Tab collection management, navigation dispatch (`ChannelRouter` & `NavigationRouter`), DataStore persistence, and Flux store synchronization.
- **`ChannelTabBar.tsx`**: Scrollable tab strip container, pinned tab grouping, action tray, and horizontal mouse-wheel scrolling.
- **`Tab.tsx`**: Individual tab component with drag-and-drop event handlers, dynamic icon resolution, unread counts from `ReadStateStore`, and hover close buttons.
- **`ContextMenu.tsx`**: Native Discord context menu integrated via `ContextMenuApi`.
- **`styles.css`**: Scoped styles using Discord's design system tokens (`--background-tertiary`, `--brand-experiment`, `--header-primary`).
