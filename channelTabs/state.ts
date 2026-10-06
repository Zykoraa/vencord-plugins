/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { ChannelRouter, ChannelStore, GuildStore, IconUtils, NavigationRouter, SelectedChannelStore, SelectedGuildStore, showToast, Toasts, UserStore } from "@webpack/common";

import { settings } from "./settings";
import { SerializedTabsData, TabItem } from "./types";

const DATA_STORE_KEY = "ChannelTabs_savedTabs";
const MAX_HISTORY = 20;

let tabs: TabItem[] = [];
let activeTabId: string | null = null;
const closedTabsHistory: TabItem[] = [];
const listeners = new Set<() => void>();
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let isInitialized = false;

function notify() {
    listeners.forEach(cb => {
        try {
            cb();
        } catch (err) {
            console.error("[ChannelTabs] Listener error:", err);
        }
    });
}

function debounceSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
        try {
            const data: SerializedTabsData = {
                tabs,
                activeTabId
            };
            await DataStore.set(DATA_STORE_KEY, data);
        } catch (err) {
            console.error("[ChannelTabs] Failed to save tabs to DataStore:", err);
        }
    }, 500);
}

export function subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

export function getTabs(): TabItem[] {
    return tabs;
}

export function getActiveTabId(): string | null {
    return activeTabId;
}

export function getActiveTab(): TabItem | undefined {
    return tabs.find(t => t.id === activeTabId);
}

export function resolveChannelTitle(channelId: string, guildId: string | null): string {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return "channel";

    if (channel.isDM?.() || channel.type === 1 /* DM */) {
        const recipientId = channel.recipients?.[0];
        const user = recipientId ? UserStore.getUser(recipientId) : null;
        return user?.globalName || user?.username || channel.name || "Direct Message";
    }

    if (channel.isGroupDM?.() || channel.type === 3 /* GROUP_DM */) {
        return channel.name || "Group DM";
    }

    if (channel.isThread?.() || channel.type === 11 || channel.type === 12) {
        return `🧵 ${channel.name}`;
    }

    if (channel.type === 2 /* GUILD_VOICE */ || channel.type === 13 /* GUILD_STAGE_VOICE */) {
        return `🔊 ${channel.name}`;
    }

    return `#${channel.name || "channel"}`;
}

export interface ChannelIconInfo {
    url?: string;
    textFallback?: string;
    isDM?: boolean;
    isVoice?: boolean;
    isThread?: boolean;
}

export function resolveChannelIcon(channelId: string, guildId: string | null): ChannelIconInfo {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return { textFallback: "#" };

    if (channel.isDM?.() || channel.type === 1) {
        const recipientId = channel.recipients?.[0];
        const user = recipientId ? UserStore.getUser(recipientId) : null;
        const avatarUrl = user ? IconUtils.getUserAvatarURL(user) : undefined;
        return {
            url: avatarUrl,
            textFallback: user?.username ? user.username[0].toUpperCase() : "@",
            isDM: true
        };
    }

    if (channel.isGroupDM?.() || channel.type === 3) {
        const iconUrl = IconUtils.getChannelIconURL(channel);
        return {
            url: iconUrl,
            textFallback: "G",
            isDM: true
        };
    }

    const gId = channel.guild_id || guildId;
    if (gId && gId !== "@me") {
        const guild = GuildStore.getGuild(gId);
        const iconUrl = guild ? IconUtils.getGuildIconURL(guild) : undefined;
        if (iconUrl) {
            return {
                url: iconUrl,
                textFallback: guild?.name ? guild.name[0].toUpperCase() : "#"
            };
        }
    }

    if (channel.isThread?.() || channel.type === 11 || channel.type === 12) {
        return { isThread: true, textFallback: "🧵" };
    }

    if (channel.type === 2 || channel.type === 13) {
        return { isVoice: true, textFallback: "🔊" };
    }

    return { textFallback: "#" };
}

function generateTabId(): string {
    return `tab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function navigateToTab(tab: TabItem) {
    try {
        if (tab.guildId && tab.guildId !== "@me") {
            NavigationRouter.transitionToGuild(tab.guildId, tab.channelId);
        } else {
            ChannelRouter.transitionToChannel(tab.channelId);
        }
    } catch {
        try {
            NavigationRouter.transitionTo(`/channels/${tab.guildId ?? "@me"}/${tab.channelId}`);
        } catch (err) {
            console.error("[ChannelTabs] Navigation failed:", err);
        }
    }
}

export function openTab(
    channelId: string,
    guildId: string | null = null,
    options: { background?: boolean; pinned?: boolean } = {}
): TabItem {
    const existingIndex = tabs.findIndex(t => t.channelId === channelId);
    if (existingIndex !== -1) {
        const existing = tabs[existingIndex];
        if (!options.background) {
            activateTab(existing.id);
        }
        return existing;
    }

    // Enforce max tabs limit: prune oldest non-pinned tab if exceeded
    const maxTabs = settings.store.maxTabs || 20;
    if (tabs.length >= maxTabs) {
        const pruneIndex = tabs.findIndex(t => !t.pinned && t.id !== activeTabId);
        if (pruneIndex !== -1) {
            tabs.splice(pruneIndex, 1);
        }
    }

    const title = resolveChannelTitle(channelId, guildId);
    const newTab: TabItem = {
        id: generateTabId(),
        channelId,
        guildId: guildId ?? (ChannelStore.getChannel(channelId)?.guild_id ?? null),
        title,
        pinned: !!options.pinned,
        lastActiveTime: Date.now()
    };

    if (options.pinned) {
        // Place right after other pinned tabs
        const lastPinnedIndex = tabs.map(t => t.pinned).lastIndexOf(true);
        tabs.splice(lastPinnedIndex + 1, 0, newTab);
    } else {
        // Insert right after the active tab, or at the end
        const activeIndex = tabs.findIndex(t => t.id === activeTabId);
        if (activeIndex !== -1) {
            tabs.splice(activeIndex + 1, 0, newTab);
        } else {
            tabs.push(newTab);
        }
    }

    if (!options.background) {
        activeTabId = newTab.id;
        navigateToTab(newTab);
    }

    debounceSave();
    notify();
    return newTab;
}

export function activateTab(tabId: string) {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;

    activeTabId = tab.id;
    tab.lastActiveTime = Date.now();

    // Update title in case channel name changed
    tab.title = resolveChannelTitle(tab.channelId, tab.guildId);

    navigateToTab(tab);
    debounceSave();
    notify();
}

export function closeTab(tabId: string) {
    const index = tabs.findIndex(t => t.id === tabId);
    if (index === -1) return;

    const tab = tabs[index];
    if (tab.pinned) return; // Do not close pinned tabs via regular close

    closedTabsHistory.push(tab);
    if (closedTabsHistory.length > MAX_HISTORY) {
        closedTabsHistory.shift();
    }

    tabs.splice(index, 1);

    if (activeTabId === tabId) {
        if (tabs.length > 0) {
            // Pick next tab, or previous if at the end
            const nextIndex = Math.min(index, tabs.length - 1);
            const nextTab = tabs[nextIndex];
            activeTabId = nextTab.id;
            nextTab.lastActiveTime = Date.now();
            navigateToTab(nextTab);
        } else {
            // Re-open current channel if everything was closed
            const currentChan = SelectedChannelStore.getChannelId();
            if (currentChan) {
                const currentGuild = SelectedGuildStore.getGuildId();
                const fresh = openTab(currentChan, currentGuild);
                activeTabId = fresh.id;
            } else {
                activeTabId = null;
            }
        }
    }

    debounceSave();
    notify();
}

export function closeOtherTabs(keepTabId: string) {
    const keepTab = tabs.find(t => t.id === keepTabId);
    if (!keepTab) return;

    tabs.filter(t => t.id !== keepTabId && !t.pinned).forEach(t => {
        closedTabsHistory.push(t);
    });

    tabs = tabs.filter(t => t.id === keepTabId || t.pinned);
    activeTabId = keepTab.id;
    keepTab.lastActiveTime = Date.now();

    debounceSave();
    notify();
}

export function closeTabsToRight(tabId: string) {
    const index = tabs.findIndex(t => t.id === tabId);
    if (index === -1) return;

    const toClose = tabs.slice(index + 1).filter(t => !t.pinned);
    toClose.forEach(t => closedTabsHistory.push(t));

    tabs = [...tabs.slice(0, index + 1), ...tabs.slice(index + 1).filter(t => t.pinned)];

    const stillActive = tabs.some(t => t.id === activeTabId);
    if (!stillActive) {
        activeTabId = tabId;
        navigateToTab(tabs[index]);
    }

    debounceSave();
    notify();
}

export function togglePinTab(tabId: string) {
    const index = tabs.findIndex(t => t.id === tabId);
    if (index === -1) return;

    const tab = tabs[index];
    tab.pinned = !tab.pinned;

    // Reorder: pinned tabs go to the front
    tabs.splice(index, 1);
    if (tab.pinned) {
        const lastPinnedIndex = tabs.map(t => t.pinned).lastIndexOf(true);
        tabs.splice(lastPinnedIndex + 1, 0, tab);
    } else {
        const firstUnpinnedIndex = tabs.findIndex(t => !t.pinned);
        if (firstUnpinnedIndex !== -1) {
            tabs.splice(firstUnpinnedIndex, 0, tab);
        } else {
            tabs.push(tab);
        }
    }

    debounceSave();
    notify();
}

export function reorderTabs(sourceId: string, targetId: string) {
    const sourceIndex = tabs.findIndex(t => t.id === sourceId);
    const targetIndex = tabs.findIndex(t => t.id === targetId);
    if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return;

    const [moved] = tabs.splice(sourceIndex, 1);
    tabs.splice(targetIndex, 0, moved);

    debounceSave();
    notify();
}

export function cycleTab(direction: 1 | -1) {
    if (tabs.length <= 1) return;

    const currentIndex = tabs.findIndex(t => t.id === activeTabId);
    let nextIndex = currentIndex + direction;

    if (nextIndex >= tabs.length) nextIndex = 0;
    if (nextIndex < 0) nextIndex = tabs.length - 1;

    activateTab(tabs[nextIndex].id);
}

export function jumpToTabIndex(index: number) {
    if (index < 0 || index >= tabs.length) return;
    activateTab(tabs[index].id);
}

export function reopenClosedTab() {
    const restored = closedTabsHistory.pop();
    if (!restored) {
        showToast("No recently closed tabs to reopen", Toasts.Type.FAILURE);
        return;
    }

    openTab(restored.channelId, restored.guildId, { pinned: restored.pinned });
    showToast(`Reopened ${restored.title}`, Toasts.Type.SUCCESS);
}

export function syncWithCurrentChannel(channelId: string, guildId: string | null = null) {
    if (!channelId) return;

    const currentTab = tabs.find(t => t.id === activeTabId);
    if (currentTab && currentTab.channelId === channelId) {
        // Tab is already active
        return;
    }

    const matchingTab = tabs.find(t => t.channelId === channelId);
    if (matchingTab) {
        activeTabId = matchingTab.id;
        matchingTab.lastActiveTime = Date.now();
        matchingTab.title = resolveChannelTitle(matchingTab.channelId, matchingTab.guildId);
        debounceSave();
        notify();
        return;
    }

    // Channel is not open in any tab
    if (settings.store.autoOpenNewTab) {
        openTab(channelId, guildId);
    } else if (currentTab && !currentTab.pinned) {
        // Reuse existing unpinned active tab
        currentTab.channelId = channelId;
        currentTab.guildId = guildId ?? (ChannelStore.getChannel(channelId)?.guild_id ?? null);
        currentTab.title = resolveChannelTitle(channelId, currentTab.guildId);
        currentTab.lastActiveTime = Date.now();
        debounceSave();
        notify();
    } else {
        openTab(channelId, guildId);
    }
}

export async function initTabs() {
    if (isInitialized) return;
    isInitialized = true;

    try {
        const saved = await DataStore.get<SerializedTabsData>(DATA_STORE_KEY);
        if (saved && Array.isArray(saved.tabs) && saved.tabs.length > 0) {
            tabs = saved.tabs.filter(t => t && t.channelId);
            activeTabId = saved.activeTabId && tabs.some(t => t.id === saved.activeTabId)
                ? saved.activeTabId
                : tabs[0]?.id ?? null;
        }
    } catch (err) {
        console.error("[ChannelTabs] Failed to load tabs from DataStore:", err);
    }

    const currentChan = SelectedChannelStore.getChannelId();
    const currentGuild = SelectedGuildStore.getGuildId();

    if (currentChan) {
        syncWithCurrentChannel(currentChan, currentGuild);
    } else if (tabs.length === 0) {
        // Default seed if completely empty
        const chan = SelectedChannelStore.getChannelId();
        if (chan) {
            openTab(chan, SelectedGuildStore.getGuildId());
        }
    }
}

export function cleanupState() {
    listeners.clear();
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = null;
    isInitialized = false;
}
