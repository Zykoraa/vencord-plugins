/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { buildGlowNodes, GlowNodes, layoutLayer } from "./glowNodes";
import { maskImageFor } from "./shapes";
import { ScopeConfig, ShapeId } from "./types";

/*
 * Draws the part of the glow that has left the rail.
 *
 * The rail's scroller has `overflow-y: auto`, which forces `overflow-x` to a
 * clipping value, and `overflow-clip-margin` does not apply to scroll
 * containers - so nothing drawn inside the rail can leave it. The glow is
 * therefore split:
 *
 *   inside the rail   the row's own pseudo-elements, behind the row's content,
 *                     so badges and voice indicators paint over it
 *   past the rail     this overlay, fixed to the viewport where no ancestor
 *                     can clip it
 *
 * The overlay is clipped to start exactly at the rail's right edge, so it never
 * paints over the rail itself. That is what keeps decorations clean: they sit
 * outside the icon's silhouette, so an overlay covering the rail would hide
 * them, and identifying every badge in Discord's markup to punch them out would
 * be guesswork.
 *
 * Everything positional is written as a literal pixel value from here rather
 * than derived in CSS. A `var()` that fails to resolve silently falls back -
 * for the clip that means no clip at all, i.e. the overlay washing over the
 * whole rail - and that failure has happened more than once.
 */

const OVERLAY_ID = "vc-ss-overlay";

let overlay: HTMLDivElement | null = null;

interface Entry {
    row: Element;
    icon: Element;
    /** the spill, fixed to the viewport */
    out: GlowNodes;
    /** the in-rail half, attached to the rail outside clipped icon wrappers */
    inner: GlowNodes;
    haloPx: number;
    baseHaloPx: number;
    rimPx: number;
    railRight: number;
    glowing: boolean;
    spill: boolean;
    shape: ShapeId;
}

const glowForRow = new WeakMap<Element, Entry>();
let live: Entry[] = [];

export interface GlowState {
    scope: ScopeConfig;
    /** whether to draw the part that reaches past the rail */
    spill: boolean;
    vars: Record<string, string>;
    glowing: boolean;
    selected: boolean;
    hovered: boolean;
}

function px(value: string | undefined) {
    const n = parseFloat(value ?? "");
    return Number.isFinite(n) ? n : 0;
}

/** Audio push in px, read once per pass rather than per element. */
function audioPush() {
    return px(document.documentElement.style.getPropertyValue("--ss-audio-px"));
}

function ensureOverlay() {
    if (overlay?.isConnected) return overlay;

    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("aria-hidden", "true");
    document.body.appendChild(overlay);
    return overlay;
}

export function upsertGlow(row: Element, icon: Element, state: GlowState, clipRect: DOMRect | null, rail: Element) {
    const root = ensureOverlay();

    let entry = glowForRow.get(row);
    if (!entry || !entry.out.root.isConnected) {
        const out = buildGlowNodes("ss-o");
        root.appendChild(out.root);

        const inner = buildGlowNodes("ss-g");
        entry = { row, icon, out, inner, haloPx: 0, baseHaloPx: 0, rimPx: 0, railRight: 0, glowing: false, spill: false, shape: state.scope.shape };
        glowForRow.set(row, entry);
        live.push(entry);
    }

    entry.icon = icon;

    // Never put a glow inside Discord's masked/overflow-hidden icon wrappers.
    // The rail provides a shared layer behind the rows and their badges.
    if (entry.inner.root.parentElement !== rail) {
        rail.insertBefore(entry.inner.root, rail.firstChild);
    }

    entry.shape = state.scope.shape;
    entry.glowing = state.glowing;
    entry.spill = state.spill;

    for (const [k, v] of Object.entries(state.vars)) {
        entry.out.root.style.setProperty(k, v);
        entry.inner.root.style.setProperty(k, v);
    }

    entry.baseHaloPx = px(state.vars["--ss-halo"]) +
        (state.hovered ? px(state.vars["--ss-hover-bloom"]) : 0);
    entry.rimPx = px(state.vars["--ss-rim"]);

    const mask = maskImageFor(state.scope.shape);
    entry.out.root.style.setProperty("--ss-mask", mask);
    entry.inner.root.style.setProperty("--ss-mask", mask);

    for (const root of [entry.inner.root, entry.out.root]) {
        root.dataset.ssSel = String(state.selected);
        root.dataset.ssHover = String(state.hovered);
    }

    updateEntry(entry, clipRect);
}

/**
 * Lays out both halves of one glow.
 *
 * The in-rail nodes are positioned relative to their shared rail layer; the spill is positioned
 * in viewport coordinates and clipped to start where the rail ends, so the two
 * meet exactly at the rail's edge without overlapping.
 */
function layoutEntry(entry: Entry, rect: DOMRect) {
    const mask = entry.out.root.style.getPropertyValue("--ss-mask");
    const layerRect = entry.inner.root.getBoundingClientRect();

    // Reading the layer's viewport box accounts for its host's scroll and borders.
    const inX = rect.left - layerRect.left;
    const inY = rect.top - layerRect.top;
    layoutLayer(entry.inner.haloWrap, entry.inner.haloFill,
        { x: inX, y: inY, width: rect.width, height: rect.height, extend: entry.haloPx, mask, shape: entry.shape });
    layoutLayer(entry.inner.rimWrap, entry.inner.rimFill,
        { x: inX, y: inY, width: rect.width, height: rect.height, extend: entry.rimPx, mask, shape: entry.shape });

    // Clip the stationary root after its children have blurred/animated.
    // Clipping an animated layer moves the cutoff as it scales, creating a seam.
    // Do not clamp to the layer width: the blurred tail extends beyond that box.
    const cut = entry.railRight - rect.left;
    entry.out.root.style.clipPath = `inset(-1000px -1000px -1000px ${cut}px)`;

    // spill: same geometry in viewport coordinates
    position(entry.out.root, rect);
    layoutLayer(entry.out.haloWrap, entry.out.haloFill,
        { x: 0, y: 0, width: rect.width, height: rect.height, extend: entry.haloPx, mask, shape: entry.shape });
    layoutLayer(entry.out.rimWrap, entry.out.rimFill,
        { x: 0, y: 0, width: rect.width, height: rect.height, extend: entry.rimPx, mask, shape: entry.shape });
}

function position(el: HTMLElement, rect: DOMRect) {
    el.style.width = `${Math.round(rect.width)}px`;
    el.style.height = `${Math.round(rect.height)}px`;
    el.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`;
}

/** Visibility is derived from state each time, so scrolling can restore a glow. */
function updateEntry(entry: Entry, clipRect: DOMRect | null) {
    const rect = entry.icon.getBoundingClientRect();
    const visible = entry.glowing && entry.row.isConnected && rect.width > 0 && rect.height > 0 &&
        (!clipRect || (rect.bottom > clipRect.top && rect.top < clipRect.bottom));
    entry.inner.root.style.display = visible ? "" : "none";
    entry.out.root.style.display = visible && entry.spill ? "" : "none";
    if (!visible) return;

    // Rows (especially folder children) can be narrower than their scroller.
    entry.railRight = clipRect?.right ?? entry.row.getBoundingClientRect().right;
    entry.haloPx = entry.baseHaloPx + audioPush();
    layoutEntry(entry, rect);

    // Both copies must sample the same animation phase at the rail boundary.
    const innerAnimations = entry.inner.root.getAnimations({ subtree: true });
    const outerAnimations = entry.out.root.getAnimations({ subtree: true });
    outerAnimations.forEach((animation, index) => {
        const time = innerAnimations[index]?.currentTime;
        if (time != null) animation.currentTime = time;
    });
}

/** Moves existing glows, for scrolling and resizing, including hidden entries. */
export function repositionGlows(clipRect: DOMRect | null) {
    for (const entry of live) updateEntry(entry, clipRect);
}

export function pruneGlows(seen: Set<Element>) {
    live = live.filter(entry => {
        if (seen.has(entry.row) && entry.row.isConnected) return true;
        entry.out.root.remove();
        entry.inner.root.remove();
        glowForRow.delete(entry.row);
        return false;
    });
}

export function clearOverlay() {
    for (const entry of live) {
        entry.out.root.remove();
        entry.inner.root.remove();
    }
    live = [];
    overlay?.remove();
    overlay = null;

    // anything left from a previous session
    for (const el of document.querySelectorAll(".ss-g, .ss-o")) el.remove();
}

export function overlayCount() {
    return live.filter(e => e.out.root.style.display !== "none").length;
}

/** px of glow visible past the rail on the first drawn glow, for diagnostics. */
export function overlaySpill(): number | null {
    const entry = live.find(e => e.out.root.style.display !== "none");
    if (!entry) return null;

    const width = px(entry.out.haloWrap.style.width);
    return Math.max(0, width + 3 * px(entry.out.root.style.getPropertyValue("--ss-blur")) -
        (entry.railRight - (entry.icon.getBoundingClientRect().left - entry.haloPx)));
}
