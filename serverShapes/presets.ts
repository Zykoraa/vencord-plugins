/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { defaultAnimation, defaultGlow, Preset, ScopeConfig, ShapeId } from "./types";

/*
 * Curated looks that ship with the plugin.
 *
 * These are deliberately not written into saved settings: they stay read-only
 * so they cannot be deleted by accident, they cost no storage, and they improve
 * whenever the plugin updates. The user's own presets live alongside them.
 */

function look(
    shape: ShapeId,
    glow: Partial<ScopeConfig["glow"]>,
    animation: Partial<ScopeConfig["animation"]> = {}
): ScopeConfig {
    return {
        shape,
        glow: { ...defaultGlow(), ...glow },
        animation: { ...defaultAnimation(), ...animation }
    };
}

export const BUILTIN_PRESETS: Preset[] = [
    {
        id: "builtin:your-colours",
        name: "Your Colours",
        config: look("squircle", {
            autoColor: true,
            paintMode: "linear",
            style: "outlineGlow",
            thickness: 2,
            spread: 7,
            blur: 8,
            opacity: 0.9,
            intensity: 120
        })
    },
    {
        id: "builtin:aurora",
        name: "Aurora",
        config: look("squircle", {
            paintMode: "conic",
            gradientStops: ["#3ddc97", "#4f8cff", "#a855f7", "#f472b6"],
            style: "neon",
            thickness: 2,
            spread: 8,
            blur: 10,
            opacity: 0.9,
            intensity: 135
        }, { spin: true, spinSpeed: 10 })
    },
    {
        id: "builtin:ember",
        name: "Ember",
        config: look("blob", {
            paintMode: "linear",
            gradientStops: ["#ffb347", "#ff5f2e", "#c81e4a"],
            gradientAngle: 120,
            style: "neon",
            thickness: 2,
            spread: 9,
            blur: 12,
            opacity: 0.92,
            intensity: 150
        }, { enabled: true, speed: 5, amount: 0.3 })
    },
    {
        id: "builtin:frost",
        name: "Frost",
        config: look("circle", {
            paintMode: "solid",
            color: "#8fd7ff",
            style: "softGlow",
            spread: 9,
            blur: 14,
            opacity: 0.75,
            intensity: 110
        }, { enabled: true, speed: 6, amount: 0.25 })
    },
    {
        id: "builtin:spectrum",
        name: "Spectrum",
        config: look("squircle", {
            paintMode: "conic",
            gradientStops: ["#ff4d4d", "#ffb84d", "#4dff88", "#4dd2ff", "#a64dff"],
            style: "outlineGlow",
            thickness: 3,
            spread: 6,
            blur: 8,
            opacity: 0.95,
            intensity: 140
        }, { spin: true, spinSpeed: 6, hueCycle: true, hueSpeed: 14 })
    },
    {
        id: "builtin:hairline",
        name: "Hairline",
        config: look("circle", {
            paintMode: "solid",
            color: "#e8eaf0",
            style: "outline",
            thickness: 1,
            spread: 0,
            blur: 0,
            opacity: 0.55,
            intensity: 100,
            hoverBoost: 1.8,
            hoverBloom: 0,
            hoverLift: 0.06
        })
    },
    {
        id: "builtin:neon-heart",
        name: "Neon Heart",
        config: look("heart", {
            paintMode: "linear",
            gradientStops: ["#ff2d9b", "#00e5ff"],
            gradientAngle: 140,
            style: "neon",
            thickness: 2,
            spread: 8,
            blur: 11,
            opacity: 0.95,
            intensity: 160
        }, { enabled: true, speed: 3.5, amount: 0.35 })
    }
];

export function isBuiltinPreset(id: string) {
    return id.startsWith("builtin:");
}

export function findPreset(id: string, userPresets: Preset[]): Preset | undefined {
    return BUILTIN_PRESETS.find(p => p.id === id) ?? userPresets.find(p => p.id === id);
}
