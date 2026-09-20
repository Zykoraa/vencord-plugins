/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ShapeId } from "./types";

/**
 * Every shape is authored in a 0..100 design space and emitted into a
 * `clipPathUnits="objectBoundingBox"` clipPath via `transform="scale(0.01)"`.
 *
 * That combination is what lets a single def clip a 48px rail icon, a 32px
 * account-panel avatar and a 80px profile-modal avatar without any per-size
 * bookkeeping: object bounding box units are relative to whatever element
 * references them.
 *
 * The exception is `squircle`, which is Discord's own path lifted verbatim from
 * their `svg-mask-squircle` mask def and therefore already in 0..1 units.
 */
export interface ShapeDef {
    id: ShapeId;
    label: string;
    /** path data in the 0..100 design space, or null for "leave Discord alone" */
    path: string | null;
    /** true when `path` is already in 0..1 units and must not be scaled */
    unitPath?: boolean;
    /**
     * Use the even-odd fill rule, which makes a second subpath carve a hole
     * instead of uniting with the first. Crescents need this; overlapping
     * subpaths under the default nonzero rule simply merge.
     */
    evenOdd?: boolean;
}

/** Discord's real squircle, taken from their shipped mask definition. */
const DISCORD_SQUIRCLE =
    "M0 0.464C0 0.301585 0 0.220377 0.0316081 0.158343C0.0594114 0.103776 " +
    "0.103776 0.0594114 0.158343 0.0316081C0.220377 0 0.301585 0 0.464 0H0.536" +
    "C0.698415 0 0.779623 0 0.841657 0.0316081C0.896224 0.0594114 0.940589 " +
    "0.103776 0.968392 0.158343C1 0.220377 1 0.301585 1 0.464V0.536C1 0.698415 " +
    "1 0.779623 0.968392 0.841657C0.940589 0.896224 0.896224 0.940589 0.841657 " +
    "0.968392C0.779623 1 0.698415 1 0.536 1H0.464C0.301585 1 0.220377 1 " +
    "0.158343 0.968392C0.103776 0.940589 0.0594114 0.896224 0.0316081 " +
    "0.841657C0 0.779623 0 0.698415 0 0.536V0.464Z";

/** Circle as a path, so shapes can be composed from subpaths. */
function circle(cx: number, cy: number, r: number) {
    return `M${cx - r},${cy} a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 ${-r * 2},0 Z`;
}

export const SHAPES: ShapeDef[] = [
    {
        id: "default",
        label: "Discord Default",
        path: null
    },
    {
        id: "circle",
        label: "Circle",
        path: "M0,50 A50,50 0 1,0 100,50 A50,50 0 1,0 0,50 Z"
    },
    {
        id: "square",
        label: "Square",
        path: "M0,0 H100 V100 H0 Z"
    },
    {
        id: "softSquare",
        label: "Soft Square",
        path:
            "M22,0 H78 A22,22 0 0 1 100,22 V78 A22,22 0 0 1 78,100 " +
            "H22 A22,22 0 0 1 0,78 V22 A22,22 0 0 1 22,0 Z"
    },
    {
        id: "squircle",
        label: "Squircle",
        path: DISCORD_SQUIRCLE,
        unitPath: true
    },
    {
        id: "heart",
        label: "Heart",
        path:
            "M50,97 C50,97 3,63 3,33 C3,15 17,4 31,4 C41,4 48,10 50,17 " +
            "C52,10 59,4 69,4 C83,4 97,15 97,33 C97,63 50,97 50,97 Z"
    },
    {
        id: "star",
        label: "Star",
        path:
            "M50,1 L62.3,33.0 L97.6,34.6 L70.0,56.5 L79.4,90.5 " +
            "L50,71.0 L20.6,90.5 L30.0,56.5 L2.4,34.6 L37.7,33.0 Z"
    },
    {
        id: "hexagon",
        label: "Hexagon",
        path: "M50,0 L93.3,25 L93.3,75 L50,100 L6.7,75 L6.7,25 Z"
    },
    {
        id: "diamond",
        label: "Diamond",
        path: "M50,0 L100,50 L50,100 L0,50 Z"
    },
    {
        id: "octagon",
        label: "Octagon",
        path: "M30,0 H70 L100,30 V70 L70,100 H30 L0,70 V30 Z"
    },
    {
        id: "shield",
        label: "Shield",
        path: "M50,0 L96,17 V52 C96,78 74,93 50,100 C26,93 4,78 4,52 V17 Z"
    },
    {
        // an organic wobble - four uneven corner radii, the "squishy" look
        id: "blob",
        label: "Blob",
        path:
            "M57,1 C82,1 99,19 97,45 C95,68 77,81 58,89 " +
            "C37,98 13,94 5,76 C-2,59 5,36 17,22 C28,9 40,1 57,1 Z"
    },
    {
        id: "leaf",
        label: "Leaf",
        path: "M0,100 C0,45 45,0 100,0 C100,55 55,100 0,100 Z"
    },
    {
        // Overlapping subpaths merge under the default nonzero rule, so four
        // lobes plus a centre block union into a clover.
        id: "clover",
        label: "Clover",
        path: [
            circle(30, 30, 27),
            circle(70, 30, 27),
            circle(30, 70, 27),
            circle(70, 70, 27),
            // must wind the same direction as the lobes or nonzero cancels it
            circle(50, 50, 30)
        ].join(" ")
    },
    {
        id: "gem",
        label: "Gem",
        path: "M28,6 H72 L100,38 L50,98 L0,38 Z"
    },
    {
        id: "triangle",
        label: "Triangle",
        path:
            "M42,6 C47,2 53,2 58,6 L96,74 C100,82 96,92 87,92 " +
            "H13 C4,92 0,82 4,74 Z"
    }
];

export const SHAPE_BY_ID = new Map(SHAPES.map(s => [s.id, s]));

export function isRealShape(id: ShapeId) {
    return id !== "default" && SHAPE_BY_ID.has(id);
}

/**
 * Defs live in two namespaces: the runtime one injected into Discord, and a
 * preview one owned by the settings panel. The panel can be opened while the
 * plugin is disabled, so it cannot rely on the runtime defs existing.
 */
export const RUNTIME_PREFIX = "ss-clip";
export const PREVIEW_PREFIX = "ss-preview-clip";

export function clipIdFor(id: ShapeId, prefix = RUNTIME_PREFIX) {
    return `${prefix}-${id}`;
}

/** `clip-path` value for a shape, or "none" for Discord default. */
export function clipPathValue(id: ShapeId, prefix = RUNTIME_PREFIX) {
    return isRealShape(id) ? `url(#${clipIdFor(id, prefix)})` : "none";
}

/**
 * The `<svg>` defs block injected once at plugin start. Holding every shape at
 * all times costs nothing measurable and means switching shapes is a pure CSS
 * variable change with no def churn.
 */
export function buildSvgDefs(prefix = RUNTIME_PREFIX) {
    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.style.position = "absolute";
    svg.style.pointerEvents = "none";
    svg.style.opacity = "0";

    const defs = document.createElementNS(svgNs, "defs");

    for (const shape of SHAPES) {
        if (!shape.path) continue;

        const clip = document.createElementNS(svgNs, "clipPath");
        clip.setAttribute("id", clipIdFor(shape.id, prefix));
        clip.setAttribute("clipPathUnits", "objectBoundingBox");

        const path = document.createElementNS(svgNs, "path");
        path.setAttribute("d", shape.path);
        if (shape.evenOdd) path.setAttribute("clip-rule", "evenodd");
        if (!shape.unitPath) path.setAttribute("transform", "scale(0.01)");

        clip.appendChild(path);
        defs.appendChild(clip);
    }

    svg.appendChild(defs);
    return svg;
}

/**
 * The shape as a mask image.
 *
 * The glow is shaped by both a clipPath reference and this mask image, because
 * the two are not equally supported on pseudo-elements and between them one
 * always applies.
 *
 * `preserveAspectRatio="none"` lets the single image stretch to whatever box
 * references it, so one definition serves every icon size.
 */
export function maskImageFor(id: ShapeId, fallback: ShapeId = "squircle", box?: { width: number; height: number; extend: number; }): string {
    const shape = SHAPE_BY_ID.get(isRealShape(id) ? id : fallback);
    if (!shape?.path) return "none";

    const pad = box?.extend ?? 0;
    const viewBox = box ? `${-pad} ${-pad} ${box.width + pad * 2} ${box.height + pad * 2}`
        : shape.unitPath ? "0 0 1 1" : "0 0 100 100";
    const units = shape.unitPath ? 1 : 100;
    // Stroke expands the contour evenly; scaling the silhouette pinches concave
    // shapes and gives diagonal edges a different thickness from straight ones.
    const outline = box
        ? ` transform="scale(${box.width / units} ${box.height / units})" stroke="#000" stroke-width="${pad * 2}" stroke-linejoin="round" vector-effect="non-scaling-stroke"`
        : "";
    const rule = shape.evenOdd ? ' fill-rule="evenodd"' : "";
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" preserveAspectRatio="none">` +
        `<path d="${shape.path}" fill="#000"${rule}${outline}/></svg>`;

    // Single quotes: the value is written into style attributes and inline
    // styles, and a double-quoted url() would terminate the attribute.
    // encodeURIComponent escapes the SVG's own quotes, so none survive inside.
    return `url('data:image/svg+xml,${encodeURIComponent(svg)}')`;
}

export function previewClipPath(id: ShapeId) {
    return clipPathValue(id, PREVIEW_PREFIX);
}
