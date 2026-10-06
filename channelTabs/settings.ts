/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    autoOpenNewTab: {
        type: OptionType.BOOLEAN,
        description: "Automatically open a new tab when navigating to a channel that isn't already open",
        default: true,
    },
    showServerIcons: {
        type: OptionType.BOOLEAN,
        description: "Display server icons on tabs (or avatars for DMs)",
        default: true,
    },
    showUnreadBadges: {
        type: OptionType.BOOLEAN,
        description: "Show unread dots and mention badges on tabs",
        default: true,
    },
    closeTabOnMiddleClick: {
        type: OptionType.BOOLEAN,
        description: "Close a tab by middle-clicking anywhere on it",
        default: true,
    },
    middleClickToOpen: {
        type: OptionType.BOOLEAN,
        description: "Middle-click (or Ctrl+Click) any channel in the sidebar to open it in a background tab without switching",
        default: true,
    },
    keyboardShortcuts: {
        type: OptionType.BOOLEAN,
        description: "Enable tab keyboard shortcuts (Ctrl+Tab to cycle, Ctrl+W to close active tab, Ctrl+1..9 to jump, Ctrl+Shift+T to reopen)",
        default: true,
    },
    compactTabs: {
        type: OptionType.BOOLEAN,
        description: "Compact tab sizing for denser tab bars",
        default: false,
    },
    maxTabs: {
        type: OptionType.SLIDER,
        description: "Maximum number of open tabs (oldest inactive tabs will close when exceeded)",
        markers: [5, 10, 15, 20, 30, 50],
        default: 20,
        stickToMarkers: true,
    },
});
