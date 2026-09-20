/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    maxNodes: {
        type: OptionType.SLIDER,
        description: "How many of the most recent loaded messages to consider",
        markers: [50, 100, 200, 300, 500],
        default: 200,
        stickToMarkers: true
    },
    includeStandalone: {
        type: OptionType.BOOLEAN,
        description: "Also draw messages that neither reply to anything nor were replied to",
        default: false
    }
});
