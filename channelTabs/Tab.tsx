/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { GuildStore, ReadStateStore, Tooltip, useStateFromStores } from "@webpack/common";
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";

import { openTabContextMenu } from "./ContextMenu";
import { settings } from "./settings";
import { activateTab, closeTab, reorderTabs, resolveChannelIcon } from "./state";
import { TabItem } from "./types";

interface TabProps {
    tab: TabItem;
    isActive: boolean;
    onDragStart: (e: ReactDragEvent, tabId: string) => void;
    onDragOver: (e: ReactDragEvent, tabId: string) => void;
    onDrop: (e: ReactDragEvent, tabId: string) => void;
    isDropTarget: boolean;
}

export function Tab({
    tab,
    isActive,
    onDragStart,
    onDragOver,
    onDrop,
    isDropTarget
}: TabProps) {
    const { hasUnread, mentionCount } = useStateFromStores([ReadStateStore], () => {
        try {
            return {
                hasUnread: ReadStateStore.hasUnread(tab.channelId),
                mentionCount: ReadStateStore.getMentionCount(tab.channelId)
            };
        } catch {
            return { hasUnread: false, mentionCount: 0 };
        }
    });

    const iconInfo = resolveChannelIcon(tab.channelId, tab.guildId);
    const guild = tab.guildId && tab.guildId !== "@me" ? GuildStore.getGuild(tab.guildId) : null;
    const tooltipText = guild ? `${guild.name} • ${tab.title}` : tab.title;

    const handleClick = (e: ReactMouseEvent) => {
        if (e.button === 0) {
            activateTab(tab.id);
        }
    };

    const handleAuxClick = (e: ReactMouseEvent) => {
        if (e.button === 1 && settings.store.closeTabOnMiddleClick && !tab.pinned) {
            e.preventDefault();
            e.stopPropagation();
            closeTab(tab.id);
        }
    };

    const handleContextMenu = (e: ReactMouseEvent) => {
        openTabContextMenu(e, tab);
    };

    const handleCloseClick = (e: ReactMouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        closeTab(tab.id);
    };

    const className = [
        "vc-tab",
        isActive ? "vc-tab-active" : "",
        tab.pinned ? "vc-tab-pinned" : "",
        isDropTarget ? "vc-tab-drop-target" : "",
        settings.store.compactTabs ? "vc-tab-compact" : ""
    ].filter(Boolean).join(" ");

    return (
        <Tooltip text={tooltipText} position="bottom">
            {tooltipProps => (
                <div
                    {...tooltipProps}
                    className={className}
                    draggable
                    onDragStart={e => onDragStart(e, tab.id)}
                    onDragOver={e => onDragOver(e, tab.id)}
                    onDrop={e => onDrop(e, tab.id)}
                    onClick={handleClick}
                    onAuxClick={handleAuxClick}
                    onContextMenu={handleContextMenu}
                    data-tab-id={tab.id}
                    role="tab"
                    aria-selected={isActive}
                >
                    {/* Active Accent Glow Bar */}
                    {isActive && <div className="vc-tab-accent-line" />}

                    {/* Channel or Server Icon */}
                    {settings.store.showServerIcons && (
                        <div className="vc-tab-icon-wrapper">
                            {iconInfo.url ? (
                                <img
                                    src={iconInfo.url}
                                    alt=""
                                    className="vc-tab-icon"
                                    onError={e => {
                                        (e.currentTarget as HTMLElement).style.display = "none";
                                    }}
                                />
                            ) : (
                                <span className="vc-tab-icon-fallback">
                                    {iconInfo.textFallback ?? "#"}
                                </span>
                            )}
                        </div>
                    )}

                    {/* Tab Title (hidden for pinned tabs to save space) */}
                    {!tab.pinned && (
                        <span className="vc-tab-title">
                            {tab.customTitle || tab.title}
                        </span>
                    )}

                    {/* Unread & Mention Badges */}
                    {settings.store.showUnreadBadges && (
                        <div className="vc-tab-badges">
                            {mentionCount > 0 ? (
                                <span className="vc-tab-badge-mention">
                                    {mentionCount > 99 ? "99+" : mentionCount}
                                </span>
                            ) : hasUnread ? (
                                <span className="vc-tab-badge-unread" />
                            ) : null}
                        </div>
                    )}

                    {/* Close Tab Button */}
                    {!tab.pinned && (
                        <button
                            type="button"
                            className="vc-tab-close"
                            onClick={handleCloseClick}
                            title="Close Tab (Ctrl+W / Middle Click)"
                            aria-label={`Close ${tab.title}`}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    )}
                </div>
            )}
        </Tooltip>
    );
}
