/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* Optional rail widening and lookup of the viewport that clips the in-rail glow.
 * overlay.ts draws the continuation outside that viewport. */

const RAIL_WIDTH_VAR = "--custom-guild-list-width";

/** Elements we set the width variable on, so cleanup can undo exactly that. */
let widened: HTMLElement[] = [];

/** What the current widening was computed from, to avoid redoing it. */
let widenedFor: { rail: Element | null; extra: number; } = { rail: null, extra: -1 };

/**
 * The nearest ancestor that clips horizontally.
 *
 * No longer used to size the glow - only to report, in the settings
 * diagnostics, what would cut it. `overflow-y: auto` computes `overflow-x` to
 * `auto` rather than `visible`, so testing the computed value catches scrollers
 * that never asked to clip horizontally but do anyway.
 */
export function findClipper(el: Element): HTMLElement | null {
    let node: Element | null = el;

    while (node && node !== document.body) {
        const cs = getComputedStyle(node);
        if (cs.overflowX !== "visible" || cs.overflowY !== "visible") return node as HTMLElement;
        node = node.parentElement;
    }

    return null;
}

/**
 * Raises Discord's own rail width variable along the chain above the rail.
 *
 * Memoised on (rail, extra): rail mutations are constant - every unread badge,
 * every reorder - and rewriting ten inline styles on each would thrash layout
 * for nothing.
 */
export function applyRailWidth(rail: Element, extra: number) {
    if (widenedFor.rail === rail && widenedFor.extra === extra) return;

    clearWidening();
    widenedFor = { rail, extra };
    if (extra <= 0) return;

    const base = parseFloat(getComputedStyle(rail).getPropertyValue(RAIL_WIDTH_VAR)) || 72;
    const next = `${Math.round(base + extra)}px`;

    let el: HTMLElement | null = rail as HTMLElement;
    for (let i = 0; i < 10 && el && el !== document.body; i++) {
        el.style.setProperty(RAIL_WIDTH_VAR, next);
        widened.push(el);
        el = el.parentElement;
    }
}

export function clearWidening() {
    widenedFor = { rail: null, extra: -1 };

    for (const el of widened) {
        el.style.removeProperty(RAIL_WIDTH_VAR);
        if (el.getAttribute("style") === "") el.removeAttribute("style");
    }
    widened = [];
}
