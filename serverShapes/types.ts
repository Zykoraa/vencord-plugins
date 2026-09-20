/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type ShapeId =
    | "default"
    | "circle"
    | "square"
    | "softSquare"
    | "squircle"
    | "heart"
    | "star"
    | "hexagon"
    | "diamond"
    | "octagon"
    | "shield"
    | "blob"
    | "leaf"
    | "clover"
    | "gem"
    | "triangle";

/** Glow styles differ only in which of the two layers they use and how. */
export type GlowStyleId = "outline" | "softGlow" | "outlineGlow" | "neon";

export type PaintMode = "solid" | "linear" | "conic";

export interface GlowConfig {
    enabled: boolean;
    style: GlowStyleId;
    paintMode: PaintMode;
    /** used when paintMode === "solid" */
    color: string;
    /** used when paintMode is "linear" or "conic"; 2..6 stops */
    gradientStops: string[];
    /** degrees, for linear and conic */
    gradientAngle: number;
    /** 0..200, drives saturate()/brightness() on the glow layers */
    intensity: number;
    /** px the blurred halo extends past the icon edge */
    spread: number;
    /** px blur radius of the halo */
    blur: number;
    /** 0..1 */
    opacity: number;
    /** px width of the crisp rim */
    thickness: number;
    /** multiplier applied to opacity while hovering, 1 = no boost */
    hoverBoost: number;
    /** multiplier applied to opacity on the selected server, 1 = no boost */
    selectedBoost: number;
    /**
     * Derive the colour from each server's own icon instead of the configured
     * colour, so every server glows in its own palette with no setup.
     */
    autoColor: boolean;
    /** extra px the halo blooms out to on hover */
    hoverBloom: number;
    /** px the icon itself lifts (scales) on hover; 0 disables */
    hoverLift: number;
}

export interface AnimationConfig {
    enabled: boolean;
    /** seconds for one full breathe cycle */
    speed: number;
    /** 0..1, how far opacity/size dips during the cycle */
    amount: number;
    /** rotate the gradient around the silhouette */
    spin: boolean;
    /** seconds for one full rotation */
    spinSpeed: number;
    /** cycle the glow through the colour wheel */
    hueCycle: boolean;
    /** seconds for one full hue revolution */
    hueSpeed: number;
}

/** A complete, self-contained look. Global config and presets are both this. */
export interface ScopeConfig {
    shape: ShapeId;
    glow: GlowConfig;
    animation: AnimationConfig;
}

/**
 * Per-server overrides are partial on purpose: an absent key falls back to
 * global, which is what makes "reset shape only" a key deletion rather than a
 * copy of the global value frozen in time.
 */
export interface ServerOverride {
    shape?: ShapeId;
    glow?: Partial<GlowConfig>;
    animation?: Partial<AnimationConfig>;
}

export interface Preset {
    id: string;
    name: string;
    config: ScopeConfig;
}

export interface ProfileConfig {
    enabled: boolean;
    accountPanel: boolean;
    popout: boolean;
    modal: boolean;
    /** apply the shape to avatars too, not just the glow */
    matchShape: boolean;
    shape: ShapeId;
    /** false = inherit the global server glow */
    useOwnGlow: boolean;
    glow: GlowConfig;
}

export type AudioBand = "bass" | "mid" | "treble" | "full";

/**
 * Drives the glow from live audio. The captured signal never leaves the
 * machine - it is reduced to a single 0..1 number per frame and written to one
 * CSS variable.
 */
export interface AudioConfig {
    enabled: boolean;
    /** a deviceId from enumerateDevices, "" for the default input, or "display" */
    source: string;
    /** remembered so the picker can show a name before permission is granted */
    sourceLabel: string;
    band: AudioBand;
    /** multiplier on the measured level */
    gain: number;
    /** 0..0.95, temporal smoothing to stop it looking jittery */
    smoothing: number;
    /** how hard the level pushes brightness */
    amount: number;
    /** px the halo expands at full level */
    spread: number;
    /** degrees of hue shift at full level */
    hueShift: number;
    affectIcons: boolean;
}

export interface PluginConfig {
    version: number;
    global: ScopeConfig;
    perServer: Record<string, ServerOverride>;
    presets: Preset[];
    profile: ProfileConfig;
    /** apply shapes/glow to folder icons as well as plain servers */
    applyToFolders: boolean;
    /** apply to Home / DMs / Discovery / Add-a-Server rail buttons */
    includeHome: boolean;
    /**
     * Extra px added to Discord's own rail width variable. Purely a spacing
     * preference now - the glow is drawn outside the rail, so it no longer
     * needs the rail to be wide.
     */
    railExtraWidth: number;
    /**
     * Draw the part of the glow that reaches past the rail, in an overlay on
     * top of the client. Off by default: it is the most intrusive thing the
     * plugin does, and the glow ending at the rail is the safer look.
     */
    spill: boolean;
    audio: AudioConfig;
}

export const CONFIG_VERSION = 1;

export function defaultGlow(): GlowConfig {
    return {
        enabled: true,
        style: "outlineGlow",
        paintMode: "solid",
        color: "#5865f2",
        gradientStops: ["#5865f2", "#eb459e"],
        gradientAngle: 135,
        intensity: 100,
        spread: 6,
        blur: 7,
        opacity: 0.85,
        thickness: 2,
        hoverBoost: 1.35,
        selectedBoost: 1.2,
        autoColor: false,
        hoverBloom: 4,
        hoverLift: 0.04
    };
}

export function defaultAnimation(): AnimationConfig {
    return {
        enabled: false,
        speed: 4,
        amount: 0.35,
        spin: false,
        spinSpeed: 8,
        hueCycle: false,
        hueSpeed: 12
    };
}

export function defaultScope(): ScopeConfig {
    return {
        shape: "squircle",
        glow: defaultGlow(),
        animation: defaultAnimation()
    };
}

export function defaultProfile(): ProfileConfig {
    return {
        enabled: false,
        accountPanel: true,
        popout: true,
        modal: true,
        matchShape: false,
        shape: "circle",
        useOwnGlow: false,
        glow: defaultGlow()
    };
}

export function defaultAudio(): AudioConfig {
    return {
        enabled: false,
        source: "",
        sourceLabel: "Default input",
        band: "bass",
        gain: 1.6,
        smoothing: 0.7,
        amount: 0.9,
        spread: 8,
        hueShift: 0,
        affectIcons: true
    };
}

export function defaultConfig(): PluginConfig {
    return {
        version: CONFIG_VERSION,
        global: defaultScope(),
        perServer: {},
        presets: [],
        profile: defaultProfile(),
        applyToFolders: true,
        includeHome: false,
        railExtraWidth: 0,
        spill: true,
        audio: defaultAudio()
    };
}
