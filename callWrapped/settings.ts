/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    autoOpen: {
        type: OptionType.SELECT,
        description: "What to do when a call ends",
        options: [
            { label: "Show a notification I can click", value: "notify", default: true },
            { label: "Open the report straight away", value: "open" },
            { label: "Nothing - I'll open it from the toolbox", value: "silent" }
        ] as const
    },
    minDurationSeconds: {
        type: OptionType.SLIDER,
        description: "Ignore calls shorter than this (seconds)",
        markers: [0, 30, 60, 120, 300, 600],
        default: 60,
        stickToMarkers: false
    },
    minParticipants: {
        type: OptionType.SLIDER,
        description: "Ignore calls with fewer people than this (counting you)",
        markers: [1, 2, 3, 4, 5],
        default: 2,
        stickToMarkers: true
    },
    interruptWindowSeconds: {
        type: OptionType.SLIDER,
        description: "How fast someone has to give up the mic for it to count as an interruption (seconds)",
        markers: [0.5, 1, 1.5, 2, 3, 5],
        default: 2,
        stickToMarkers: false
    },
    ignoreSelf: {
        type: OptionType.BOOLEAN,
        description: "Leave yourself out of the stats",
        default: false
    },
    ignoreBots: {
        type: OptionType.BOOLEAN,
        description: "Leave bots out of the stats",
        default: true
    },
    keepReports: {
        type: OptionType.SLIDER,
        description: "How many past reports to keep",
        markers: [1, 5, 10, 25, 50],
        default: 10,
        stickToMarkers: true
    }
});
