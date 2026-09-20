/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    intervalMs: {
        type: OptionType.SLIDER,
        description: "How often to sample the connection while in a call (ms)",
        markers: [250, 500, 1000, 2000, 5000],
        default: 1000,
        stickToMarkers: true
    },
    showWhenIdle: {
        type: OptionType.BOOLEAN,
        description: "Keep the HUD on screen when you are not in a call",
        default: false
    }
});
