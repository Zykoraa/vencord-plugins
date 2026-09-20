/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

import { stopAudio, syncAudio } from "./audio";
import { guildContextPatch } from "./contextMenu";
import * as engine from "./dom";
import { settings } from "./pluginSettings";
import { RUNTIME_CSS } from "./runtimeCss";
import { registerSettingsPanel } from "./settings";
import { getConfig, subscribe } from "./store";
import { resetHistory } from "./undoRedo";

// Hands the panel renderer to the settings definition (see pluginSettings.ts).
registerSettingsPanel();

let unsubscribe: (() => void) | null = null;

export default definePlugin({
    name: "ServerShapes",
    description:
        "Reshape Discord's server icons and give them an edge light that hugs the exact silhouette. " +
        "Per-server overrides, gradients, auto-colour from each server's icon, " +
        "and optional audio reactivity.",
    authors: [
        { name: "Eve", id: 0n },
        { name: "Demonjane", id: 725525081555730542n }
    ],
    tags: ["Servers", "Appearance", "Customisation"],

    settings,

    contextMenus: {
        "guild-context": guildContextPatch
    },

    start() {
        engine.start(RUNTIME_CSS);

        const apply = () => {
            const config = getConfig();
            engine.refresh();
            // Audio capture only starts once the user has switched it on.
            syncAudio(config.audio);
        };

        // Any write to the store - from the panel, the context menu or undo -
        // re-applies the affected surfaces.
        unsubscribe = subscribe(apply);
        apply();
    },

    stop() {
        unsubscribe?.();
        unsubscribe = null;

        // Releases the microphone / capture immediately.
        stopAudio();

        // Removes the stylesheet, the shape defs, every observer and every
        // attribute and inline variable the plugin wrote.
        engine.stop();
        resetHistory();
    }
});
