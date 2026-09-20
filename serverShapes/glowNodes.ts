/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * The node structure both halves of the glow are built from.
 *
 * Why it is nested
 * ----------------
 * CSS applies `filter` to an element *before* `clip-path` and `mask`. Blurring
 * a layer and then masking it to the silhouette therefore re-sharpens the edge
 * the blur just softened, and the halo comes out as a hard-edged inflated
 * silhouette - which is what a "soft glow" looked like here for a long time.
 *
 * So the mask goes on an inner element and the blur on its parent: the child is
 * shaped first, then the parent blurs the already-shaped result.
 *
 *     wrap    sized, blurred, and clipped at the rail edge
 *       fill  inset 0, painted, masked to the silhouette
 *
 * The rim needs no blur and so needs no wrapper, but it is built the same way
 * to keep one layout function for both.
 */

import { maskImageFor } from "./shapes";
import { ShapeId } from "./types";

export interface GlowNodes {
    root: HTMLDivElement;
    haloWrap: HTMLDivElement;
    haloFill: HTMLDivElement;
    rimWrap: HTMLDivElement;
    rimFill: HTMLDivElement;
}

function layer(name: string) {
    const wrap = document.createElement("div");
    wrap.className = "ss-w";
    wrap.dataset.layer = name;

    const fill = document.createElement("div");
    fill.className = "ss-f";
    wrap.appendChild(fill);

    return { wrap, fill };
}

export function buildGlowNodes(rootClass: string): GlowNodes {
    const root = document.createElement("div");
    root.className = rootClass;
    root.setAttribute("aria-hidden", "true");

    const halo = layer("halo");
    const rim = layer("rim");
    root.append(halo.wrap, rim.wrap);

    return {
        root,
        haloWrap: halo.wrap,
        haloFill: halo.fill,
        rimWrap: rim.wrap,
        rimFill: rim.fill
    };
}

export interface LayoutOptions {
    /** icon box, in the coordinate space the root is positioned in */
    x: number;
    y: number;
    width: number;
    height: number;
    /** px each layer inflates past the icon */
    extend: number;
    /** silhouette mask image */
    mask: string;
    shape?: ShapeId;
    fallback?: ShapeId;
    /** px from the layer's left edge to clip away, or 0 for none */
    cut?: number;
}

/**
 * Sizes one layer and its fill.
 *
 * Everything is written as a literal pixel value rather than through a custom
 * property: a `var()` that fails to resolve silently falls back, and for the
 * clip that means no clip at all.
 */
/** The left inset of a clip-path produced by layoutLayer, in px. */
export function readCut(wrap: HTMLElement): number {
    const m = /inset\(([^)]*)\)/.exec(wrap.style.clipPath);
    if (!m) return 0;
    const parts = m[1].trim().split(/\s+/);
    // one value applies to all sides; four are top right bottom left
    return parseFloat(parts.length >= 4 ? parts[3] : parts[0]) || 0;
}

export function layoutLayer(wrap: HTMLDivElement, fill: HTMLDivElement, o: LayoutOptions) {
    const width = o.width + o.extend * 2;
    const height = o.height + o.extend * 2;

    wrap.style.left = `${Math.round(o.x - o.extend)}px`;
    wrap.style.top = `${Math.round(o.y - o.extend)}px`;
    wrap.style.width = `${Math.round(width)}px`;
    wrap.style.height = `${Math.round(height)}px`;

    // Only the left edge is cut. The other three are pushed far outside the
    // box, because blur spreads the fill past the wrapper and clipping at the
    // box edge would slice the soft falloff into hard rectangular sides.
    const cut = Math.max(0, Math.min(width, o.cut ?? 0));
    wrap.style.clipPath = cut > 0
        ? `inset(-1000px -1000px -1000px ${Math.round(cut)}px)`
        : "";

    const mask = o.shape ? maskImageFor(o.shape, o.fallback, o) : o.mask;
    fill.style.setProperty("-webkit-mask-image", mask);
    fill.style.setProperty("mask-image", mask);

    return Math.max(0, width - cut);
}
