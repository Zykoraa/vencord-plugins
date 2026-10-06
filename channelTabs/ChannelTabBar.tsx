/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { SelectedChannelStore, SelectedGuildStore, Tooltip, useEffect, useRef, useState } from "@webpack/common";
import type { DragEvent as ReactDragEvent, WheelEvent as ReactWheelEvent } from "react";

import { settings } from "./settings";
import { getActiveTabId, getTabs, openTab, reopenClosedTab, reorderTabs, subscribe } from "./state";
import { Tab } from "./Tab";

export function ChannelTabBar() {
    const [, setTick] = useState(0);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
    const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);

    useEffect(() => {
        // Subscribe to state updates
        return subscribe(() => setTick(t => t + 1));
    }, []);

    const tabs = getTabs();
    const activeTabId = getActiveTabId();

    const pinnedTabs = tabs.filter(t => t.pinned);
    const unpinnedTabs = tabs.filter(t => !t.pinned);

    // Auto-scroll active tab into view when active tab changes
    useEffect(() => {
        if (!activeTabId || !scrollContainerRef.current) return;
        const activeEl = scrollContainerRef.current.querySelector<HTMLElement>(`[data-tab-id="${activeTabId}"]`);
        if (activeEl) {
            activeEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
        }
    }, [activeTabId]);

    // Handle horizontal mousewheel scrolling on tab strip
    const handleWheel = (e: ReactWheelEvent) => {
        if (!scrollContainerRef.current) return;
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            scrollContainerRef.current.scrollLeft += e.deltaY;
            e.preventDefault();
        }
    };

    // Drag-and-drop handlers
    const handleDragStart = (e: ReactDragEvent, tabId: string) => {
        setDraggedTabId(tabId);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", tabId);
    };

    const handleDragOver = (e: ReactDragEvent, targetId: string) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (dragOverTabId !== targetId) {
            setDragOverTabId(targetId);
        }
    };

    const handleDrop = (e: ReactDragEvent, targetId: string) => {
        e.preventDefault();
        if (draggedTabId && draggedTabId !== targetId) {
            reorderTabs(draggedTabId, targetId);
        }
        setDraggedTabId(null);
        setDragOverTabId(null);
    };

    const handleDragEnd = () => {
        setDraggedTabId(null);
        setDragOverTabId(null);
    };

    const handleNewTab = () => {
        const currentChannel = SelectedChannelStore.getChannelId();
        const currentGuild = SelectedGuildStore.getGuildId();
        if (currentChannel) {
            openTab(currentChannel, currentGuild, { background: false });
        }
    };

    if (tabs.length === 0) {
        return null;
    }

    return (
        <div
            className={`vc-channel-tabs-bar ${settings.store.compactTabs ? "vc-tabs-compact" : ""}`}
            onDragEnd={handleDragEnd}
        >
            <div
                className="vc-tabs-scroll-container"
                ref={scrollContainerRef}
                onWheel={handleWheel}
            >
                {/* Pinned tabs group */}
                {pinnedTabs.length > 0 && (
                    <div className="vc-tabs-group-pinned">
                        {pinnedTabs.map(tab => (
                            <Tab
                                key={tab.id}
                                tab={tab}
                                isActive={tab.id === activeTabId}
                                onDragStart={handleDragStart}
                                onDragOver={handleDragOver}
                                onDrop={handleDrop}
                                isDropTarget={tab.id === dragOverTabId}
                            />
                        ))}
                        <div className="vc-tabs-pinned-divider" />
                    </div>
                )}

                {/* Unpinned regular tabs */}
                <div className="vc-tabs-group-unpinned">
                    {unpinnedTabs.map(tab => (
                        <Tab
                            key={tab.id}
                            tab={tab}
                            isActive={tab.id === activeTabId}
                            onDragStart={handleDragStart}
                            onDragOver={handleDragOver}
                            onDrop={handleDrop}
                            isDropTarget={tab.id === dragOverTabId}
                        />
                    ))}
                </div>

                {/* New Tab "+" Button */}
                <Tooltip text="Open Current Channel in New Tab" position="bottom">
                    {tooltipProps => (
                        <button
                            {...tooltipProps}
                            type="button"
                            className="vc-tab-new-btn"
                            onClick={handleNewTab}
                            aria-label="New Tab"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="12" y1="5" x2="12" y2="19" />
                                <line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                        </button>
                    )}
                </Tooltip>
            </div>

            {/* Quick Actions Tray on Right Edge */}
            <div className="vc-tabs-actions-tray">
                <Tooltip text="Reopen Closed Tab (Ctrl+Shift+T)" position="bottom">
                    {tooltipProps => (
                        <button
                            {...tooltipProps}
                            type="button"
                            className="vc-tabs-action-btn"
                            onClick={reopenClosedTab}
                            aria-label="Reopen Closed Tab"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="1 4 1 10 7 10" />
                                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                            </svg>
                        </button>
                    )}
                </Tooltip>
            </div>
        </div>
    );
}
