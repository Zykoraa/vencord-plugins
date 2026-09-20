/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";
import { ReactNode } from "react";

import { defaultConfig } from "./types";

/**
 * The settings panel lives in settings.tsx, which needs the store, which needs
 * this module. Registering the renderer instead of importing it keeps that a
 * straight line rather than an import cycle.
 */
let panelRenderer: () => ReactNode = () => null;

export function registerPanel(render: () => ReactNode) {
    panelRenderer = render;
}

/**
 * The whole plugin state is one CUSTOM setting. Vencord persists CUSTOM values
 * verbatim, which is what lets per-server overrides and presets survive a
 * restart without a second storage mechanism.
 */
export const settings = definePluginSettings({
    config: {
        type: OptionType.CUSTOM,
        default: defaultConfig()
    },
    panel: {
        type: OptionType.COMPONENT,
        component: () => panelRenderer()
    }
});
