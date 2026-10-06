/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ContextMenuApi, FluxDispatcher, Menu, ReadStateStore, showToast, Toasts } from "@webpack/common";
import type { MouseEvent as ReactMouseEvent } from "react";

import { closeOtherTabs, closeTab, closeTabsToRight, togglePinTab } from "./state";
import { TabItem } from "./types";

interface TabContextMenuProps {
    tab: TabItem;
}

export function TabContextMenu({ tab }: TabContextMenuProps) {
    const channelLink = `https://discord.com/channels/${tab.guildId ?? "@me"}/${tab.channelId}`;

    const handleCopyLink = async () => {
        try {
            await navigator.clipboard.writeText(channelLink);
            showToast("Channel link copied to clipboard", Toasts.Type.SUCCESS);
        } catch {
            showToast("Failed to copy link", Toasts.Type.FAILURE);
        }
    };

    const handleMarkAsRead = () => {
        try {
            const lastId = ReadStateStore.lastMessageId(tab.channelId);
            if (lastId) {
                FluxDispatcher.dispatch({
                    type: "CHANNEL_ACK",
                    channelId: tab.channelId,
                    messageId: lastId
                });
            } else {
                FluxDispatcher.dispatch({
                    type: "BULK_ACK",
                    context: "APP",
                    channels: [{
                        channelId: tab.channelId,
                        messageId: "0",
                        readStateType: 0
                    }]
                });
            }
            showToast(`Marked ${tab.title} as read`, Toasts.Type.SUCCESS);
        } catch (err) {
            console.error("[ChannelTabs] Mark as read error:", err);
        }
    };

    return (
        <Menu.Menu navId="vc-channel-tabs-context" onClose={ContextMenuApi.closeContextMenu} aria-label="Tab Options">
            <Menu.MenuGroup>
                <Menu.MenuItem
                    id="vc-tab-pin"
                    label={tab.pinned ? "Unpin Tab" : "Pin Tab"}
                    action={() => togglePinTab(tab.id)}
                />
            </Menu.MenuGroup>

            <Menu.MenuGroup>
                <Menu.MenuItem
                    id="vc-tab-close"
                    label="Close Tab"
                    disabled={tab.pinned}
                    action={() => closeTab(tab.id)}
                />
                <Menu.MenuItem
                    id="vc-tab-close-others"
                    label="Close Other Tabs"
                    action={() => closeOtherTabs(tab.id)}
                />
                <Menu.MenuItem
                    id="vc-tab-close-right"
                    label="Close Tabs to the Right"
                    action={() => closeTabsToRight(tab.id)}
                />
            </Menu.MenuGroup>

            <Menu.MenuGroup>
                <Menu.MenuItem
                    id="vc-tab-mark-read"
                    label="Mark as Read"
                    action={handleMarkAsRead}
                />
                <Menu.MenuItem
                    id="vc-tab-copy-link"
                    label="Copy Channel Link"
                    action={handleCopyLink}
                />
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}

export function openTabContextMenu(e: ReactMouseEvent | MouseEvent, tab: TabItem) {
    e.preventDefault();
    e.stopPropagation();
    ContextMenuApi.openContextMenu(e as any, () => <TabContextMenu tab={tab} />);
}
