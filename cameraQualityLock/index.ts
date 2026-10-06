/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";

const logger = new Logger("CameraQualityLock");

// The voice connection that carries your camera. Go Live uses "stream".
const CAMERA_CONTEXT = "default";

type SinkWants = Record<string, unknown>;

const settings = definePluginSettings({
    minQuality: {
        type: OptionType.SLIDER,
        description: "Lowest quality viewers can ask your camera for (100 = always full resolution)",
        markers: [0, 20, 30, 40, 50, 60, 70, 80, 90, 100],
        default: 100,
        stickToMarkers: true
    },
    log: {
        type: OptionType.BOOLEAN,
        description: "Log every request Discord's server sends, and what it was changed to",
        default: false
    }
});

export default definePlugin({
    name: "CameraQualityLock",
    description: "Stops viewers from shrinking your camera to a thumbnail-sized feed (e.g. 320x180) when they fullscreen your Go Live. Only your outgoing camera is affected.",
    authors: [{
        name: "Eve",
        id: 0n
    }],
    tags: ["Voice", "Media"],
    settings,

    patches: [
        {
            find: "Remote media sink wants",
            replacement: {
                match: /_handleMediaSinkWants\((\i)\)\{/,
                replace: "$&$1=$self.adjust($1,this.context);"
            }
        }
    ],

    adjust(wants: SinkWants, context: string): SinkWants {
        if (context !== CAMERA_CONTEXT || wants == null || typeof wants !== "object") return wants;

        const floor = settings.store.minQuality;
        const adjusted: SinkWants = { ...wants };
        let changed = false;

        for (const [key, value] of Object.entries(wants)) {
            // Per-ssrc entries are numeric keys. "any" and "pixelCounts" are left as they are.
            if (!/^\d+$/.test(key) || typeof value !== "number") continue;
            if (value > 0 && value < floor) {
                adjusted[key] = floor;
                changed = true;
            }
        }

        if (settings.store.log) {
            logger.info(`Camera sink wants ${JSON.stringify(wants)} ${changed ? `-> ${JSON.stringify(adjusted)}` : "(unchanged)"}`);
        }

        return changed ? adjusted : wants;
    }
});
