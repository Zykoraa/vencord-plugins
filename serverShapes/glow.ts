/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { clipPathValue, RUNTIME_PREFIX } from "./shapes";
import { GlowConfig, GlowStyleId, PaintMode, ScopeConfig, ShapeId } from "./types";

export interface GlowStyleDef {
    id: GlowStyleId;
    label: string;
    description: string;
}

export const GLOW_STYLES: GlowStyleDef[] = [
    {
        id: "outline",
        label: "Outline Only",
        description: "A crisp rim that traces the silhouette, no bloom."
    },
    {
        id: "softGlow",
        label: "Soft Outer Glow",
        description: "A blurred aura behind the icon, no hard edge."
    },
    {
        id: "outlineGlow",
        label: "Outline + Outer Glow",
        description: "A crisp rim with a soft aura behind it."
    },
    {
        id: "neon",
        label: "Neon Glow",
        description: "A bright rim with a wide, saturated bloom."
    }
];

export const PAINT_MODES: { id: PaintMode; label: string; }[] = [
    { id: "solid", label: "Solid Colour" },
    { id: "linear", label: "Linear Gradient" },
    { id: "conic", label: "Conic Gradient" }
];

/**
 * Which of the two layers a style lights up. The layers themselves are always
 * present in CSS; a style simply zeroes the opacity of the one it doesn't want,
 * which keeps switching styles free of any DOM or stylesheet work.
 */
function layerWeights(style: GlowStyleId) {
    switch (style) {
        case "outline":
            return { rim: 1, halo: 0, blurScale: 0, spreadScale: 0, extraBright: 0 };
        case "softGlow":
            return { rim: 0, halo: 1, blurScale: 1, spreadScale: 1, extraBright: 0 };
        case "outlineGlow":
            return { rim: 1, halo: 0.85, blurScale: 1, spreadScale: 1, extraBright: 0 };
        case "neon":
            return { rim: 1, halo: 1, blurScale: 1.7, spreadScale: 1.35, extraBright: 0.25 };
    }
}

/**
 * Builds the CSS paint used by both glow layers.
 *
 * This is the reason the glow is a filled element rather than a `drop-shadow`:
 * a drop-shadow can only ever be one flat colour, so gradient glow would have
 * had to be faked. A filled, clipped layer takes any background value.
 */
export function buildPaint(glow: GlowConfig): string {
    const stops = glow.gradientStops.filter(Boolean);

    // --ss-angle is a registered <angle> property: 0deg when still, animated
    // 0->360deg when spin is on. Folding it in here means one paint string
    // serves both states, and the rotation is done by the compositor.
    const angle = `calc(${glow.gradientAngle}deg + var(--ss-angle, 0deg))`;

    switch (glow.paintMode) {
        case "linear": {
            if (stops.length < 2) return stops[0] ?? glow.color;
            return `linear-gradient(${angle}, ${stops.join(", ")})`;
        }
        case "conic": {
            if (stops.length < 2) return stops[0] ?? glow.color;
            // repeat the first stop so the wheel closes without a visible seam
            return `conic-gradient(from ${angle}, ${[...stops, stops[0]].join(", ")})`;
        }
        case "solid":
        default:
            return glow.color;
    }
}

/**
 * Paint built from colours sampled off a server's own icon. Auto-colour always
 * produces a gradient, because a two-tone sweep reads far better as an edge
 * light than the single averaged colour would.
 */
export function buildAutoPaint(colors: readonly string[], glow: GlowConfig): string {
    if (!colors.length) return buildPaint(glow);
    if (colors.length === 1) return colors[0];

    const angle = `calc(${glow.gradientAngle}deg + var(--ss-angle, 0deg))`;
    return glow.paintMode === "conic"
        ? `conic-gradient(from ${angle}, ${[...colors, colors[0]].join(", ")})`
        : `linear-gradient(${angle}, ${colors.join(", ")})`;
}

function clamp(n: number, lo: number, hi: number) {
    return Math.min(hi, Math.max(lo, n));
}

/**
 * Turns a resolved scope config into the flat set of custom properties the
 * static stylesheet reads. Everything that varies per server lives here, so a
 * per-server override is just a different inline style on one element.
 */
export function buildVars(
    config: ScopeConfig,
    clipPrefix = RUNTIME_PREFIX,
    /**
     * Silhouette the glow falls back to on "Discord Default", where we
     * deliberately leave the icon's own mask alone. Without this the glow layer
     * would be an unclipped rectangle - a generic box shadow rather than an
     * edge light. Rail icons are squircles; avatars are round.
     */
    defaultSilhouette: ShapeId = "squircle"
): Record<string, string> {
    const { glow, animation, shape } = config;
    const w = layerWeights(glow.style);

    const intensity = clamp(glow.intensity, 0, 200) / 100;
    const saturate = (0.6 + 0.7 * intensity).toFixed(3);
    const brightness = (0.8 + 0.35 * intensity + w.extraBright).toFixed(3);

    const opacity = clamp(glow.opacity, 0, 1);
    const on = glow.enabled ? 1 : 0;

    const vars: Record<string, string> = {
        // the icon: "none" on Discord Default, so their mask keeps working
        "--ss-clip": clipPathValue(shape, clipPrefix),
        // the glow layers: always a real silhouette to trace
        "--ss-glow-clip": clipPathValue(shape === "default" ? defaultSilhouette : shape, clipPrefix),
        "--ss-paint": buildPaint(glow),

        "--ss-rim": `${clamp(glow.thickness, 0, 20)}px`,
        "--ss-halo": `${clamp(glow.spread, 0, 60) * w.spreadScale}px`,
        "--ss-blur": `${clamp(glow.blur, 0, 80) * w.blurScale}px`,

        "--ss-filter": `saturate(${saturate}) brightness(${brightness}) hue-rotate(var(--ss-hue, 0deg))`,

        "--ss-rim-op-base": String(+(opacity * w.rim * on).toFixed(3)),
        "--ss-halo-op-base": String(+(opacity * w.halo * on).toFixed(3)),

        "--ss-hover-boost": String(clamp(glow.hoverBoost, 1, 3)),
        "--ss-selected-boost": String(clamp(glow.selectedBoost, 1, 3)),

        "--ss-hover-bloom": `${clamp(glow.hoverBloom, 0, 20)}px`,
        "--ss-hover-lift": String(1 + clamp(glow.hoverLift, 0, 0.3))
    };

    if (animation.enabled && glow.enabled) {
        vars["--ss-anim-amount"] = String(clamp(animation.amount, 0, 1));
        vars["--ss-anim-speed"] = `${clamp(animation.speed, 0.5, 20)}s`;
        // the two layers breathe on separate keyframes because each interpolates
        // its own opacity variable
        vars["--ss-anim-name"] = w.halo > 0 ? "ss-breathe" : "none";
        vars["--ss-anim-name-rim"] = w.rim > 0 ? "ss-breathe-rim" : "none";
    } else {
        // amount 0 keeps the lo/hi calcs valid even while the animation is off
        vars["--ss-anim-amount"] = "0";
        vars["--ss-anim-speed"] = "0s";
        vars["--ss-anim-name"] = "none";
        vars["--ss-anim-name-rim"] = "none";
    }

    // Spin and hue ride alongside the breathe animation rather than replacing
    // it, so a glow can pulse, rotate and cycle colour at the same time.
    const spinning = animation.spin && glow.enabled && glow.paintMode !== "solid";
    vars["--ss-spin-name"] = spinning ? "ss-spin" : "none";
    vars["--ss-spin-speed"] = `${clamp(animation.spinSpeed, 1, 60)}s`;

    const cycling = animation.hueCycle && glow.enabled;
    vars["--ss-hue-name"] = cycling ? "ss-hue" : "none";
    vars["--ss-hue-speed"] = `${clamp(animation.hueSpeed, 1, 60)}s`;

    return vars;
}

/** Whether a scope actually reshapes the icon (vs. leaving Discord's mask). */
export function isShaped(config: ScopeConfig) {
    return config.shape !== "default";
}

/** Whether a scope draws any glow at all. */
export function isGlowing(config: ScopeConfig) {
    const w = layerWeights(config.glow.style);
    return config.glow.enabled && config.glow.opacity > 0 && (w.rim > 0 || w.halo > 0);
}

/** Applies vars to an element, and records the keys so cleanup can undo it. */
export function applyVars(el: HTMLElement, vars: Record<string, string>) {
    for (const [key, value] of Object.entries(vars)) {
        el.style.setProperty(key, value);
    }
}

export function clearVars(el: HTMLElement) {
    for (let i = el.style.length - 1; i >= 0; i--) {
        const prop = el.style[i];
        if (prop.startsWith("--ss-")) el.style.removeProperty(prop);
    }
}

/** Inline `style` object for React (the settings preview), same vars. */
export function varsAsReactStyle(config: ScopeConfig, clipPrefix?: string): Record<string, string> {
    return buildVars(config, clipPrefix);
}
