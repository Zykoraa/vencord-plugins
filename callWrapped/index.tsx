/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import definePlugin from "@utils/types";
import { showToast, Toasts } from "@webpack/common";

import { openHistory, openReport } from "./ReportModal";
import { settings } from "./settings";
import { CallReport, formatDuration } from "./stats";
import managedStyle from "./styles.css?managed";
import { discardSession, endSession, getReports, loadReports, noteSpeaking, noteVoiceStates, resumeIfInCall, setReportHandler, startSession } from "./tracker";

/** Discord's speaking bitfield: 1 = voice, 2 = soundshare, 4 = priority speaker. */
const VOICE_FLAGS = 0b101;

function isSpeaking(event: any): boolean {
    const flags = event?.speakingFlags ?? event?.speaking;
    if (typeof flags === "boolean") return flags;
    if (typeof flags !== "number") return false;
    return (flags & VOICE_FLAGS) !== 0;
}

function handleReport(report: CallReport) {
    switch (settings.store.autoOpen) {
        case "open":
            openReport(report);
            break;
        case "notify":
            showNotification({
                title: "Call Wrapped",
                body: `${formatDuration(report.duration)} in ${report.channelName} · click to see how it went`,
                onClick: () => openReport(report)
            });
            break;
    }
}

export default definePlugin({
    name: "CallWrapped",
    description: "Turns every voice call into a report card: who talked how long, who interrupted who, how much dead air there was, and a timeline of the whole thing.",
    authors: [{
        name: "Eve",
        id: 0n
    }],
    tags: ["Voice", "Fun", "Utility"],
    settings,
    managedStyle,

    toolboxActions: {
        "Call Wrapped: last call"() {
            const [latest] = getReports();
            if (latest) openReport(latest);
            else showToast("No calls recorded yet", Toasts.Type.MESSAGE);
        },
        "Call Wrapped: history"() {
            openHistory();
        }
    },

    flux: {
        VOICE_CHANNEL_SELECT({ channelId, guildId }: { channelId: string | null; guildId: string | null; }) {
            if (channelId) startSession(channelId, guildId ?? null);
            else endSession();
        },

        SPEAKING(event: { userId: string; context?: string; }) {
            // streams and soundboard previews dispatch under their own context
            if (event.context != null && event.context !== "default") return;
            noteSpeaking(event.userId, isSpeaking(event));
        },

        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: Array<{ userId: string; channelId?: string | null; }>; }) {
            noteVoiceStates(voiceStates ?? []);
        }
    },

    async start() {
        setReportHandler(handleReport);
        await loadReports();
        resumeIfInCall();
    },

    stop() {
        setReportHandler(null);
        discardSession();
    }
});
