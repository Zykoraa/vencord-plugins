/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface TabItem {
    /** Unique instance identifier for this tab */
    id: string;
    /** Target channel ID */
    channelId: string;
    /** Target guild ID, or null/@me for DMs and private channels */
    guildId: string | null;
    /** Cached channel title */
    title: string;
    /** Whether this tab is pinned to the left edge */
    pinned: boolean;
    /** Timestamp when this tab was last active */
    lastActiveTime: number;
    /** Optional user-specified custom title override */
    customTitle?: string;
}

export interface SerializedTabsData {
    tabs: TabItem[];
    activeTabId: string | null;
}

export interface DragState {
    sourceId: string;
    targetId: string | null;
}
