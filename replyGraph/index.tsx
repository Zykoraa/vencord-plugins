/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import definePlugin, { IconProps } from "@utils/types";
import { SelectedChannelStore, showToast, Toasts } from "@webpack/common";

import { openGraph } from "./GraphModal";
import { settings } from "./settings";
import managedStyle from "./styles.css?managed";

function ReplyGraphIcon({ width = 24, height = 24, className }: IconProps) {
    return (
        <svg width={width} height={height} className={className} viewBox="0 0 24 24" aria-hidden="true">
            <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M12 6.8v3.4M12 13.2 7.4 16.4M12 13.2l4.6 3.2" />
            </g>
            <g fill="currentColor">
                <circle cx="12" cy="5" r="2.4" />
                <circle cx="12" cy="11.8" r="2" />
                <circle cx="6" cy="18" r="2.2" />
                <circle cx="18" cy="18" r="2.2" />
            </g>
        </svg>
    );
}

const ReplyGraphButton: ChatBarButtonFactory = ({ isMainChat, channel }) => {
    if (!isMainChat) return null;

    return (
        <ChatBarButton
            tooltip="Show the reply graph for this channel"
            onClick={() => openGraph(channel.id)}
        >
            <ReplyGraphIcon width={20} height={20} />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "ReplyGraph",
    description: "Draws the reply structure of a channel as a force-directed graph, so you can untangle four conversations happening at once. Click a node to jump to that message.",
    authors: [{
        name: "Eve",
        id: 0n
    }],
    tags: ["Chat", "Utility"],
    settings,
    managedStyle,

    chatBarButton: {
        icon: ReplyGraphIcon,
        render: ReplyGraphButton
    },

    toolboxActions: {
        "Reply graph for this channel"() {
            const channelId = SelectedChannelStore.getChannelId();
            if (channelId) openGraph(channelId);
            else showToast("Open a channel first", Toasts.Type.MESSAGE);
        }
    }
});
