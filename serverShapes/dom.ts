/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { SelectedGuildStore } from "@webpack/common";

import { setAudioFrameHook } from "./audio";
import { clearPaletteCache, getPalette, normaliseIconUrl, requestPalette } from "./autoColor";
import { applyVars, buildAutoPaint, buildVars, clearVars, isGlowing, isShaped } from "./glow";
import { buildGlowNodes, GlowNodes, layoutLayer } from "./glowNodes";
import { clearOverlay, overlayCount, overlaySpill, pruneGlows, repositionGlows, upsertGlow } from "./overlay";
import { applyRailWidth, clearWidening, findClipper } from "./room";
import { buildSvgDefs, maskImageFor } from "./shapes";
import { getConfig, resolveProfileScope, resolveScope } from "./store";
import { ScopeConfig, ShapeId } from "./types";

/*
 * Targeting strategy
 * ------------------
 * Everything below anchors on markup Discord generates from stable, semantic
 * identifiers rather than on build-hashed class names:
 *
 *   [data-list-id="guildsnav"]           the rail, a literal in their list code
 *   [data-list-item-id="guildsnav___ID"] one rail row; the format is built by
 *                                        `${listId}___${itemId}` in their list
 *                                        module, so the ID is parseable
 *   foreignObject                        an SVG tag name - Discord renders every
 *                                        masked avatar/icon through one
 *
 * Class names like `.listItem__650eb` carry a per-build hash and are avoided.
 * Where no semantic anchor exists at all (the account panel), we match on the
 * *prefix* of a class name, which survives rebuilds even though the hash does not.
 */

const RAIL_SELECTOR = '[data-list-id="guildsnav"]';
const ITEM_PREFIX = "guildsnav___";
const ITEM_SELECTOR = `[data-list-item-id^="${ITEM_PREFIX}"]`;

const STYLE_ID = "vc-server-shapes-style";
const DEFS_ID = "vc-server-shapes-defs";

const ATTR_ITEM = "data-ss-item";
const ATTR_ICON = "data-ss-icon";
const ATTR_KIND = "data-ss-kind";
const ATTR_SELECTED = "data-ss-selected";
const ATTR_AVATAR = "data-ss-avatar";
const ATTR_SHAPED = "data-ss-shaped";
const ATTR_GLOW = "data-ss-glow";
const ATTR_POS = "data-ss-pos";
const ATTR_SVG = "data-ss-svg";

const profileGlows = new Map<HTMLElement, GlowNodes>();

let styleEl: HTMLStyleElement | null = null;
let defsEl: SVGSVGElement | null = null;

let railObserver: MutationObserver | null = null;
let layerObserver: MutationObserver | null = null;
let bootstrapObserver: MutationObserver | null = null;
let resizeObserver: ResizeObserver | null = null;
let safetyTimer: number | null = null;
let fluxUnsub: (() => void) | null = null;

let railEl: Element | null = null;
/** guild under the cursor, so the overlay can mirror the row's :hover */
let hoveredGuild: string | null = null;
let scrollTarget: Element | null = null;
let repositionQueued = false;
let layerEl: Element | null = null;
let running = false;

let scanQueued = false;

/** last var signature applied per element, so a rescan does no redundant work */
const appliedSignature = new WeakMap<HTMLElement, string>();

/* ------------------------------------------------------------ scheduling -- */

function scheduleScan(extraPasses = 0) {
    if (!running || scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(() => {
        scanQueued = false;
        if (!running) return;
        try {
            scan();
        } catch (err) {
            console.error("[ServerShapes] scan failed", err);
        }
        // Popout/modal content mounts a tick or two after its layer appears, so
        // a couple of trailing passes catch avatars the first pass was too early for.
        if (extraPasses > 0) {
            setTimeout(() => scheduleScan(extraPasses - 1), 80);
        }
    });
}

/* -------------------------------------------------------------- classify -- */

type ItemKind = "guild" | "folder" | "special";

function classify(rawId: string): { kind: ItemKind; guildId: string | null; } {
    if (/^\d+$/.test(rawId)) return { kind: "guild", guildId: rawId };
    if (rawId.startsWith("folder-")) return { kind: "folder", guildId: null };
    return { kind: "special", guildId: null };
}

/* ------------------------------------------------------------- measuring -- */

/**
 * Records where the icon sits inside its row, in that row's own coordinates.
 *
 * The glow is drawn by pseudo-elements on the row (which is already
 * position:relative and never clips), so it needs to know the icon box rather
 * than the row box - rows are 72px wide while icons are 48px, and folders and
 * avatars differ again.
 */
function measure(item: HTMLElement, icon: Element) {
    const itemRect = item.getBoundingClientRect();
    const iconRect = icon.getBoundingClientRect();

    // A virtualised or hidden row measures as zero; keep the last good numbers.
    if (iconRect.width === 0 || iconRect.height === 0) return;

    item.style.setProperty("--ss-size", `${Math.round(iconRect.width)}px`);
    item.style.setProperty("--ss-size-y", `${Math.round(iconRect.height)}px`);
    item.style.setProperty("--ss-x", `${Math.round(iconRect.left - itemRect.left)}px`);
    item.style.setProperty("--ss-y", `${Math.round(iconRect.top - itemRect.top)}px`);
}

/*
 * Bounds for something that can sensibly be treated as a rail icon.
 *
 * A clipPath in objectBoundingBox units scales to whatever it is applied to, so
 * clipping a *container* rather than an icon produces one enormous shape
 * swallowing everything inside it - which is exactly what a folder looks like
 * when its wrapper gets picked instead of its icon box.
 */
const MIN_ICON_PX = 12;
const MAX_ICON_PX = 96;

/** Set when a candidate could not be measured yet, to force another pass. */
let remeasureWanted = false;

function isPlausibleIcon(el: Element): boolean {
    const r = el.getBoundingClientRect();

    // Not laid out yet: refuse for now rather than risk tagging a container,
    // and ask for another scan once layout has settled.
    if (r.width === 0 || r.height === 0) {
        remeasureWanted = true;
        return false;
    }

    if (r.width < MIN_ICON_PX || r.height < MIN_ICON_PX) return false;
    if (r.width > MAX_ICON_PX || r.height > MAX_ICON_PX) return false;

    // Rail icons are square. A tall or wide box is a container, not an icon.
    const ratio = r.width / r.height;
    return ratio > 0.6 && ratio < 1.7;
}

/**
 * The icon element to clip. Discord renders masked icons as
 * `<svg><foreignObject mask="url(#svg-mask-squircle)">`, so the foreignObject is
 * both the thing to reshape and the exact icon box.
 *
 * `row` scopes the search: a folder row contains the rows of the servers inside
 * it, and borrowing a child's icon would give the folder a second, misplaced
 * glow on top of the one that child already draws for itself.
 */
function findIcon(root: Element, row?: Element): Element | null {
    const selector = 'foreignObject, img[src*="/icons/"], img[src*="/avatars/"], img[src*="/guilds/"]';

    for (const candidate of root.querySelectorAll(selector)) {
        // belongs to a nested rail row, not this one
        if (row && candidate.closest(ITEM_SELECTOR) !== row) continue;
        if (!isPlausibleIcon(candidate)) continue;
        return candidate;
    }

    return null;
}

/* ----------------------------------------------------------------- apply -- */

function signature(scope: ScopeConfig, selected: boolean) {
    return `${JSON.stringify(scope)}|${selected}`;
}

/**
 * The glow's `z-index: -1` only stays inside the row if the row is a stacking
 * context, and the pseudo-elements only position correctly against a positioned
 * host. Both are nudged only when they aren't already satisfied, so an element
 * Discord had absolutely positioned is never yanked out of place.
 */
function ensurePositioned(el: HTMLElement) {
    if (el.hasAttribute(ATTR_POS)) return;

    const cs = getComputedStyle(el);
    let touched = "";

    if (cs.position === "static") {
        el.style.position = "relative";
        touched += "p";
    }
    if (cs.zIndex === "auto") {
        el.style.zIndex = "0";
        touched += "z";
    }

    el.setAttribute(ATTR_POS, touched);
}

/**
 * Applies a scope to an element and returns the variables used.
 *
 * The values are returned as well as written so callers can reuse them without
 * reading them back out of the DOM.
 */
function applyScope(
    host: HTMLElement,
    scope: ScopeConfig,
    selected: boolean,
    /** silhouette the glow traces when the user kept Discord's own shape */
    defaultSilhouette: ShapeId = "squircle",
    paintOverride?: string | null
): Record<string, string> {
    const vars = buildVars(scope, undefined, defaultSilhouette);
    if (paintOverride) vars["--ss-paint"] = paintOverride;
    // the glow silhouette, as an image alongside the clip-path form
    vars["--ss-mask"] = maskImageFor(scope.shape, defaultSilhouette);

    const sig = `${signature(scope, selected)}|${defaultSilhouette}|${paintOverride ?? ""}`;
    if (appliedSignature.get(host) !== sig) {
        appliedSignature.set(host, sig);
        host.setAttribute(ATTR_SHAPED, String(isShaped(scope)));
        host.setAttribute(ATTR_GLOW, String(isGlowing(scope)));
        applyVars(host, vars);
    }

    return vars;
}

function releaseElement(el: Element) {
    const host = el as HTMLElement;
    profileGlows.get(host)?.root.remove();
    profileGlows.delete(host);
    clearVars(host);

    const touched = host.getAttribute(ATTR_POS);
    if (touched?.includes("p")) host.style.removeProperty("position");
    if (touched?.includes("z")) host.style.removeProperty("z-index");

    for (const attr of [ATTR_ITEM, ATTR_KIND, ATTR_SELECTED, ATTR_AVATAR, ATTR_SHAPED, ATTR_GLOW, ATTR_POS]) {
        host.removeAttribute(attr);
    }

    appliedSignature.delete(host);
    if (host.getAttribute("style") === "") host.removeAttribute("style");
}

/* ------------------------------------------------------------ auto colour -- */

/**
 * Repaints one row from colours sampled off its own icon.
 *
 * Runs after applyScope, which has just written the configured paint, so this
 * only ever overrides a value that is already valid - if sampling fails or the
 * server has no icon, the configured colour simply stays.
 */
/**
 * Paint sampled from a server's own icon, or null to keep the configured one.
 *
 * Returns rather than writes, so it can be folded into the variables applied in
 * one pass instead of overwriting one of them afterwards.
 */
function resolveAutoPaint(node: HTMLElement, scope: ScopeConfig): string | null {
    if (!scope.glow.autoColor || !scope.glow.enabled) return null;

    const img = node.querySelector("img");
    if (!img?.src) return null;

    const url = normaliseIconUrl(img.src);
    const palette = getPalette(url);

    if (palette === null) {
        // Not sampled yet. Drop the cached signature when it lands so the next
        // scan re-applies this row with its real colours.
        requestPalette(url, () => {
            appliedSignature.delete(node);
            scheduleScan();
        });
        return null;
    }

    return palette.length ? buildAutoPaint(palette, scope.glow) : null;
}

/* ------------------------------------------------------- hover + scroll -- */

/* The overlay is outside the rail, so it cannot use :hover on the row. */
function onPointerOver(e: Event) {
    const row = (e.target as Element)?.closest?.(ITEM_SELECTOR);
    const raw = row?.getAttribute("data-list-item-id")?.slice(ITEM_PREFIX.length) ?? null;
    const next = raw;

    if (next !== hoveredGuild) {
        hoveredGuild = next;
        scheduleScan();
    }
}

function onPointerLeave() {
    if (hoveredGuild === null) return;
    hoveredGuild = null;
    scheduleScan();
}

/** The rail's visible box, for culling rows scrolled out of view. */
function clipRect(): DOMRect | null {
    if (!railEl) return null;
    return (findClipper(railEl) ?? railEl).getBoundingClientRect();
}

function scheduleReposition() {
    if (!running || repositionQueued) return;
    repositionQueued = true;
    requestAnimationFrame(() => {
        repositionQueued = false;
        if (running) repositionGlows(clipRect());
    });
}

function detachRailListeners() {
    railEl?.removeEventListener("pointerover", onPointerOver);
    railEl?.removeEventListener("pointerleave", onPointerLeave);
    scrollTarget?.removeEventListener("scroll", scheduleReposition, true);
    scrollTarget = null;
}

/* ------------------------------------------------------------------ scan -- */

function scanRail() {
    if (!railEl?.isConnected) return;

    ensurePositioned(railEl as HTMLElement);
    const config = getConfig();
    const selectedGuildId = (() => {
        try {
            return SelectedGuildStore?.getGuildId?.() ?? null;
        } catch {
            return null;
        }
    })();

    const seen = new Set<Element>();
    const box = clipRect();

    for (const node of railEl.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) {
        const raw = node.getAttribute("data-list-item-id")!.slice(ITEM_PREFIX.length);
        const { kind, guildId } = classify(raw);

        const wanted =
            kind === "guild" ||
            (kind === "folder" && config.applyToFolders) ||
            (kind === "special" && config.includeHome);

        if (!wanted) {
            if (node.hasAttribute(ATTR_ITEM)) releaseElement(node);
            continue;
        }

        const icon = findIcon(node, node);
        if (!icon) {
            if (node.hasAttribute(ATTR_ITEM)) releaseElement(node);
            continue;
        }

        const isNew = !node.hasAttribute(ATTR_ITEM);
        if (isNew) {
            node.setAttribute(ATTR_ITEM, "");
            node.setAttribute(ATTR_KIND, kind);
            ensurePositioned(node);
            resizeObserver?.observe(node);
        }

        if (!icon.hasAttribute(ATTR_ICON)) icon.setAttribute(ATTR_ICON, "");

        // the <svg> root clips its viewport, which would shear a lifted icon
        const svg = icon.closest("svg");
        if (svg && !svg.hasAttribute(ATTR_SVG)) svg.setAttribute(ATTR_SVG, "");

        const scope = resolveScope(guildId);
        const selected = Boolean(guildId) && guildId === selectedGuildId;

        node.setAttribute(ATTR_SELECTED, String(selected));
        const vars = applyScope(node, scope, selected, "squircle", resolveAutoPaint(node, scope));

        if (isNew) measure(node, icon);

        seen.add(node);
        upsertGlow(node, icon, {
            scope,
            vars,
            glowing: isGlowing(scope),
            spill: config.spill,
            selected,
            hovered: raw === hoveredGuild
        }, box, railEl);
    }

    pruneGlows(seen);
}

/**
 * Profile surfaces. The account panel has no semantic anchor of its own, so it
 * is matched on the stable *prefix* of its class name; popouts and modals are
 * found the same way inside the layer container.
 */
const PROFILE_TARGETS: { key: "accountPanel" | "popout" | "modal"; selector: string; }[] = [
    { key: "accountPanel", selector: '[class*="panels_"] [class*="avatarWrapper"], section[class*="panels_"]' },
    { key: "popout", selector: '[class*="userPopout"], [class*="userPopoutOuter"]' },
    { key: "modal", selector: '[class*="userProfileModal"], [class*="userProfileOuter"], [class*="fullSizeModal"]' }
];

function scanProfiles() {
    const config = getConfig();
    const { profile } = config;

    // Clear any previous tagging when the feature is switched off.
    if (!profile.enabled) {
        for (const el of document.querySelectorAll(`[${ATTR_AVATAR}]`)) releaseElement(el);
        return;
    }

    const seen = new Set<HTMLElement>();
    const scope = resolveProfileScope();

    for (const target of PROFILE_TARGETS) {
        if (!profile[target.key]) continue;

        for (const container of document.querySelectorAll(target.selector)) {
            const icon = findIcon(container);
            if (!icon) continue;

            // Host the glow on the icon's nearest HTML ancestor: an <svg> cannot
            // render pseudo-elements, and we must not insert nodes into React's tree.
            const svg = icon.closest("svg");
            const host = (svg?.parentElement ?? icon.parentElement) as HTMLElement | null;
            if (!host) continue;

            const isNew = !host.hasAttribute(ATTR_AVATAR);
            if (isNew) {
                host.setAttribute(ATTR_AVATAR, target.key);
                ensurePositioned(host);
                resizeObserver?.observe(host);
            }

            if (!icon.hasAttribute(ATTR_ICON)) icon.setAttribute(ATTR_ICON, "");

            seen.add(host);
            const vars = applyScope(host, scope, false, "circle");
            if (isNew) measure(host, icon);
            let nodes = profileGlows.get(host);
            if (!nodes) {
                nodes = buildGlowNodes("ss-preview-glow");
                profileGlows.set(host, nodes);
            }
            if (nodes.root.parentElement !== host) host.prepend(nodes.root);
            nodes.root.style.display = isGlowing(scope) ? "" : "none";
            const rect = icon.getBoundingClientRect();
            const origin = nodes.root.getBoundingClientRect();
            const box = { x: rect.left - origin.left, y: rect.top - origin.top,
                width: rect.width, height: rect.height, mask: "none", shape: scope.shape, fallback: "circle" as ShapeId };
            layoutLayer(nodes.haloWrap, nodes.haloFill, { ...box, extend: parseFloat(vars["--ss-halo"]) });
            layoutLayer(nodes.rimWrap, nodes.rimFill, { ...box, extend: parseFloat(vars["--ss-rim"]) });
        }
    }
    for (const host of profileGlows.keys()) {
        if (!seen.has(host)) releaseElement(host);
    }
}

/**
 * Audio reactivity is expressed as two inherited variables on the document
 * root, so the per-frame level written by the audio engine reaches every glow
 * without touching a single element per frame.
 */
function applyAudioVars() {
    const { audio } = getConfig();
    const on = audio.enabled && audio.affectIcons;
    const root = document.documentElement;

    root.style.setProperty("--ss-audio-amount", on ? String(audio.amount) : "0");
    root.style.setProperty("--ss-audio-spread", on ? `${audio.spread}px` : "0px");
}

function clearAudioVars() {
    const root = document.documentElement;
    root.style.removeProperty("--ss-audio-amount");
    root.style.removeProperty("--ss-audio-spread");
    if (root.getAttribute("style") === "") root.removeAttribute("style");
}

function scan() {
    remeasureWanted = false;

    ensureAttached();
    if (railEl) applyRailWidth(railEl, getConfig().railExtraWidth);
    applyAudioVars();
    scanRail();
    scanProfiles();

    // Something was mid-layout; come back once it has settled rather than
    // leaving those rows permanently unstyled.
    if (remeasureWanted) setTimeout(() => scheduleScan(), 250);
}

/* ------------------------------------------------------------- observers -- */

function ensureAttached() {
    const rail = document.querySelector(RAIL_SELECTOR);
    if (rail && rail !== railEl) {
        railObserver?.disconnect();
        detachRailListeners();

        railEl = rail;
        railObserver = new MutationObserver(() => scheduleScan());
        railObserver.observe(rail, { childList: true, subtree: true });

        rail.addEventListener("pointerover", onPointerOver);
        rail.addEventListener("pointerleave", onPointerLeave);

        // the glow is placed in viewport coordinates, so it must follow scrolling
        scrollTarget = document.documentElement;
        scrollTarget.addEventListener("scroll", scheduleReposition, { passive: true, capture: true });

    }

    const layer = document.querySelector('[class*="layerContainer"]') ?? document.getElementById("app-mount");
    if (layer && layer !== layerEl) {
        layerObserver?.disconnect();
        layerEl = layer;
        // Popouts and modals are added as whole subtrees, so childList on the
        // container is enough - no need to watch every node inside it.
        layerObserver = new MutationObserver(() => scheduleScan(2));
        layerObserver.observe(layer, { childList: true });
    }

    // Once both are wired, the broad bootstrap watcher has done its job.
    if (railEl && layerEl && bootstrapObserver) {
        bootstrapObserver.disconnect();
        bootstrapObserver = null;
    }
}

/* ---------------------------------------------------------- diagnostics -- */

export interface Diagnostics {
    running: boolean;
    railFound: boolean;
    railItems: number;
    tagged: number;
    glowing: number;
    iconKind: "foreignObject" | "img" | "none";
    clipper: string | null;
    overlayGlows: number;
    spillPx: number | null;
    styleInjected: boolean;
    defsInjected: boolean;
}

/**
 * A snapshot of what the engine can actually see. Rendered in the settings
 * panel so "there is no glow" can be diagnosed from one screenshot instead of
 * a round trip through the devtools console.
 */
export function diagnose(): Diagnostics {
    const rail = document.querySelector(RAIL_SELECTOR);
    const rows = rail ? Array.from(rail.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) : [];
    const tagged = rows.filter(r => r.hasAttribute(ATTR_ITEM));
    const firstTagged = tagged[0] ?? null;
    const icon = firstTagged ? findIcon(firstTagged) : null;

    return {
        running,
        railFound: !!rail,
        railItems: rows.length,
        tagged: tagged.length,
        glowing: tagged.filter(r => r.getAttribute(ATTR_GLOW) === "true").length,
        iconKind: icon ? (icon.tagName.toLowerCase() === "foreignobject" ? "foreignObject" : "img") : "none",
        clipper: railEl ? (findClipper(railEl)?.tagName.toLowerCase() ?? null) : null,
        overlayGlows: overlayCount(),
        spillPx: overlaySpill(),
        styleInjected: !!document.getElementById(STYLE_ID),
        defsInjected: !!document.getElementById(DEFS_ID)
    };
}

/* ------------------------------------------------------------ public API -- */

export function injectStyle(css: string) {
    if (styleEl) return;
    styleEl = document.createElement("style");
    styleEl.id = STYLE_ID;
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
}

export function start(css: string) {
    if (running) return;
    running = true;
    setAudioFrameHook(scheduleReposition);

    injectStyle(css);

    defsEl = buildSvgDefs();
    defsEl.id = DEFS_ID;
    document.body.appendChild(defsEl);

    resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
            const host = entry.target as HTMLElement;
            const icon = findIcon(host);
            if (icon) measure(host, icon);
        }
        scheduleReposition();
    });

    bootstrapObserver = new MutationObserver(() => scheduleScan());
    bootstrapObserver.observe(document.body, { childList: true, subtree: true });

    window.addEventListener("resize", scheduleReposition, { passive: true });


    // Selected-server boost needs to follow navigation.
    try {
        const handler = () => scheduleScan();
        SelectedGuildStore?.addChangeListener?.(handler);
        fluxUnsub = () => SelectedGuildStore?.removeChangeListener?.(handler);
    } catch {
        fluxUnsub = null;
    }

    // Cheap net for a full client remount detaching the rail.
    safetyTimer = window.setInterval(() => {
        if (!railEl?.isConnected || !layerEl?.isConnected) scheduleScan();
    }, 5000);

    scheduleScan(2);
}

/** Re-applies every tagged element. Called whenever settings change. */
export function refresh() {
    if (!running) return;
    // Drop cached signatures so the next scan definitely rewrites the variables.
    for (const el of document.querySelectorAll<HTMLElement>(`[${ATTR_ITEM}], [${ATTR_AVATAR}]`)) {
        appliedSignature.delete(el);
    }
    scheduleScan();
}

export function stop() {
    running = false;
    setAudioFrameHook(null);
    scanQueued = false;

    railObserver?.disconnect();
    layerObserver?.disconnect();
    bootstrapObserver?.disconnect();
    resizeObserver?.disconnect();
    railObserver = layerObserver = bootstrapObserver = null;
    resizeObserver = null;

    if (safetyTimer !== null) {
        clearInterval(safetyTimer);
        safetyTimer = null;
    }

    fluxUnsub?.();
    fluxUnsub = null;

    window.removeEventListener("resize", scheduleReposition);
    detachRailListeners();
    clearOverlay();
    for (const host of profileGlows.keys()) releaseElement(host);
    hoveredGuild = null;


    // Undo every mark this plugin made, so nothing visual is left behind.
    for (const el of document.querySelectorAll(`[${ATTR_ITEM}], [${ATTR_AVATAR}], [${ATTR_POS}]`)) releaseElement(el);
    for (const el of document.querySelectorAll(`[${ATTR_ICON}]`)) el.removeAttribute(ATTR_ICON);
    for (const el of document.querySelectorAll(`[${ATTR_SVG}]`)) el.removeAttribute(ATTR_SVG);

    clearWidening();
    clearAudioVars();
    clearPaletteCache();

    styleEl?.remove();
    styleEl = null;

    defsEl?.remove();
    defsEl = null;

    railEl = null;
    layerEl = null;
}
