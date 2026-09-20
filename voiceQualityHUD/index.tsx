/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";
import { createRoot } from "@webpack/common";
import type { Root } from "react-dom/client";

import { logger, resetHistory } from "./connection";
import { Hud } from "./Hud";
import { settings } from "./settings";
import { setDismissed, toggleDismissed } from "./state";
import managedStyle from "./styles.css?managed";

const CONTAINER_ID = "vc-voice-quality-hud";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount() {
    if (container) return;

    container = document.createElement("div");
    container.id = CONTAINER_ID;
    document.body.append(container);

    root = createRoot(container);
    root.render(
        <ErrorBoundary noop>
            <Hud />
        </ErrorBoundary>
    );
}

function unmount() {
    try {
        root?.unmount();
    } catch (err) {
        logger.error("Failed to unmount the HUD", err);
    }
    root = null;
    container?.remove();
    container = null;
}

export default definePlugin({
    name: "VoiceQualityHUD",
    description: "A draggable overlay showing live ping, jitter, packet loss and packet rates for the voice call you are in. No webpack patches - it only reads Discord's own connection store.",
    authors: [{
        name: "Eve",
        id: 0n
    }],
    tags: ["Voice", "Utility"],
    settings,
    managedStyle,

    toolboxActions: {
        "Voice Quality HUD: show/hide"() {
            toggleDismissed();
        }
    },

    start() {
        resetHistory();
        setDismissed(false);
        mount();
    },

    stop() {
        unmount();
        resetHistory();
    }
});
