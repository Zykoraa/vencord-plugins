/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";
import { ChannelStore, createRoot, NavigationRouter, SelectedChannelStore, SelectedGuildStore, showToast, Toasts } from "@webpack/common";
import type { Root } from "react-dom/client";

import { ChannelTabBar } from "./ChannelTabBar";
import { settings } from "./settings";
import {
    activateTab,
    cleanupState,
    closeTab,
    cycleTab,
    getActiveTabId,
    getTabs,
    initTabs,
    jumpToTabIndex,
    openTab,
    reopenClosedTab,
    syncWithCurrentChannel
} from "./state";
import managedStyle from "./styles.css?managed";

const CONTAINER_ID = "vc-channel-tabs-container";

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let domObserver: MutationObserver | null = null;
let rafId: number | null = null;

function findMountTarget(): HTMLElement | null {
    // Priority 1: Primary chat / main view pane
    const chat = document.querySelector<HTMLElement>('div[class*="chat_"]');
    if (chat) return chat;

    // Priority 2: Header titlebar's parent
    const title = document.querySelector<HTMLElement>('section[class*="title_"]');
    if (title?.parentElement) return title.parentElement;

    // Priority 3: The right-hand column inside content
    const content = document.querySelector<HTMLElement>('[class*="base_"] > [class*="content_"]');
    if (content && content.children.length >= 2) {
        return content.children[content.children.length - 1] as HTMLElement;
    }

    return null;
}

function ensureMounted() {
    const target = findMountTarget();
    if (!target) return;

    if (!container) {
        container = document.createElement("div");
        container.id = CONTAINER_ID;
        root = createRoot(container);
        root.render(
            <ErrorBoundary noop>
                <ChannelTabBar />
            </ErrorBoundary>
        );
    }

    // Ensure container is inserted at the top of the target
    if (container.parentElement !== target || target.firstElementChild !== container) {
        target.prepend(container);
    }
}

function scheduleEnsureMount() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
        rafId = null;
        ensureMounted();
    });
}

function handleKeyDown(e: KeyboardEvent) {
    if (!settings.store.keyboardShortcuts) return;

    // Cycle tabs: Ctrl + Tab / Ctrl + Shift + Tab
    if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        cycleTab(e.shiftKey ? -1 : 1);
        return;
    }

    // Reopen closed tab: Ctrl + Shift + T
    if (e.ctrlKey && e.shiftKey && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        e.stopPropagation();
        reopenClosedTab();
        return;
    }

    // Close active tab: Ctrl + W
    if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === "w" || e.key === "W")) {
        const activeId = getActiveTabId();
        if (activeId) {
            e.preventDefault();
            e.stopPropagation();
            closeTab(activeId);
        }
        return;
    }

    // Jump to tab 1-8: Ctrl + 1..8
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key >= "1" && e.key <= "8") {
        e.preventDefault();
        e.stopPropagation();
        const tabNum = parseInt(e.key, 10);
        jumpToTabIndex(tabNum - 1);
        return;
    }

    // Jump to last tab: Ctrl + 9
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === "9") {
        e.preventDefault();
        e.stopPropagation();
        const tabs = getTabs();
        jumpToTabIndex(tabs.length - 1);
        return;
    }
}

function extractChannelFromElement(el: Element | null): { channelId: string; guildId: string | null } | null {
    if (!el) return null;

    // Check anchor tag with /channels/ link
    const anchor = el.closest<HTMLAnchorElement>('a[href*="/channels/"]');
    if (anchor) {
        const match = anchor.href.match(/\/channels\/([a-zA-Z0-9_@]+)\/(\d+)/);
        if (match) {
            const guildId = match[1] === "@me" ? null : match[1];
            return { guildId, channelId: match[2] };
        }
    }

    // Check data-list-item-id attribute
    const item = el.closest<HTMLElement>('[data-list-item-id^="channels___"], [data-list-item-id^="private-channels-uid_"]');
    if (item) {
        const idAttr = item.getAttribute("data-list-item-id") || "";
        const parts = idAttr.split("___");
        if (parts.length >= 2 && parts[1]) {
            return {
                channelId: parts[1],
                guildId: SelectedGuildStore.getGuildId()
            };
        }
    }

    return null;
}

function handleAuxClick(e: MouseEvent) {
    if (e.button !== 1 || !settings.store.middleClickToOpen) return;

    const target = e.target as Element | null;
    // Don't intercept clicks inside the tab bar itself (handled by Tab component)
    if (target?.closest(`#${CONTAINER_ID}`)) return;

    const channelData = extractChannelFromElement(target);
    if (channelData) {
        e.preventDefault();
        e.stopPropagation();
        openTab(channelData.channelId, channelData.guildId, { background: true });
        showToast("Opened channel in background tab", Toasts.Type.MESSAGE);
    }
}

function handleClick(e: MouseEvent) {
    if (!e.ctrlKey && !e.metaKey) return;
    if (!settings.store.middleClickToOpen) return;

    const target = e.target as Element | null;
    if (target?.closest(`#${CONTAINER_ID}`)) return;

    const channelData = extractChannelFromElement(target);
    if (channelData) {
        e.preventDefault();
        e.stopPropagation();
        openTab(channelData.channelId, channelData.guildId, { background: true });
        showToast("Opened channel in background tab", Toasts.Type.MESSAGE);
    }
}

export default definePlugin({
    name: "ChannelTabs",
    description: "Adds a sleek, browser-style tab bar for channels, threads, and DMs. Middle-click channels to open in background tabs, pin favorite channels, and switch with Ctrl+Tab.",
    authors: [{
        name: "Eve",
        id: 0n
    }],
    tags: ["Utility", "Chat"],
    settings,
    managedStyle,

    toolboxActions: {
        "ChannelTabs: New Tab"() {
            const currentChan = SelectedChannelStore.getChannelId();
            const currentGuild = SelectedGuildStore.getGuildId();
            if (currentChan) {
                openTab(currentChan, currentGuild, { background: false });
            }
        },
        "ChannelTabs: Reopen Closed Tab"() {
            reopenClosedTab();
        },
        "ChannelTabs: Close Active Tab"() {
            const activeId = getActiveTabId();
            if (activeId) closeTab(activeId);
        }
    },

    flux: {
        CHANNEL_SELECT({ channelId, guildId }: { channelId: string; guildId: string | null }) {
            syncWithCurrentChannel(channelId, guildId);
            scheduleEnsureMount();
        }
    },

    async start() {
        await initTabs();
        ensureMounted();

        // Listen for DOM changes to re-mount when switching between channels / views
        domObserver = new MutationObserver(() => {
            scheduleEnsureMount();
        });
        domObserver.observe(document.body, { childList: true, subtree: true });

        // Event listeners
        window.addEventListener("keydown", handleKeyDown, true);
        document.addEventListener("auxclick", handleAuxClick, true);
        document.addEventListener("click", handleClick, true);
    },

    stop() {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }

        if (domObserver) {
            domObserver.disconnect();
            domObserver = null;
        }

        window.removeEventListener("keydown", handleKeyDown, true);
        document.removeEventListener("auxclick", handleAuxClick, true);
        document.removeEventListener("click", handleClick, true);

        try {
            root?.unmount();
        } catch (err) {
            console.error("[ChannelTabs] Unmount error:", err);
        }

        root = null;
        container?.remove();
        container = null;

        cleanupState();
    }
});
