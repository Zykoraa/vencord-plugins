/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * The whole visual system is this one stylesheet plus a handful of custom
 * properties set per element. Changing a server's look is therefore an inline
 * variable write, never a stylesheet rebuild.
 *
 * How the glow hugs the silhouette
 * --------------------------------
 * Two pseudo-elements sit *behind* the icon (z-index -1 inside a stacking
 * context on the row), each clipped to the same shape as the icon itself but
 * inflated by a few pixels. Because the icon on top is opaque, only the
 * inflated margin is ever visible - which reads as an outline that traces the
 * exact silhouette, for free, at any shape.
 *
 *   ::after   the crisp rim   (inflated by --ss-rim)
 *   ::before  the soft halo   (inflated by --ss-halo, then blurred)
 *
 * Pseudo-elements are used rather than injected nodes so React never sees a
 * foreign child in its tree, and so removing this stylesheet removes the effect
 * completely.
 *
 * The glow is drawn entirely inside the rail, behind the row's own content, so
 * unread counts, mention badges and voice indicators all paint over it. The
 * rail's scroller clips it at the edge, and the part that would have escaped is
 * drawn separately by overlay.ts, clipped to start where the rail ends.
 */
export const RUNTIME_CSS = `
/* Registered so they interpolate. A plain custom property is a string to the
   animation engine and would jump rather than sweep. */
@property --ss-angle {
    syntax: "<angle>";
    initial-value: 0deg;
    inherits: true;
}

@property --ss-hue {
    syntax: "<angle>";
    initial-value: 0deg;
    inherits: true;
}

[data-ss-item],
[data-ss-avatar],
.ss-g,
.ss-o {
    /* boost is re-pointed by :hover / selected below, and every opacity is
       derived from it so both layers respond together */
    --ss-boost: 1;

    /* re-pointed on hover; 0 and 1 mean "resting" */
    --ss-bloom: 0px;
    --ss-lift: 1;

    /* --ss-audio is written once per frame on :root by the audio engine.
       Folding it in here means one write drives every glow on screen. */
    --ss-rim-op: calc(var(--ss-rim-op-base, 0) * var(--ss-boost) * var(--ss-audio-mul, 1));
    --ss-halo-op: calc(var(--ss-halo-op-base, 0) * var(--ss-boost) * var(--ss-audio-mul, 1));
    --ss-rim-op-lo: calc(var(--ss-rim-op) * (1 - var(--ss-anim-amount, 0)));
    --ss-halo-op-lo: calc(var(--ss-halo-op) * (1 - var(--ss-anim-amount, 0)));

}

[data-ss-item]:hover {
    --ss-boost: var(--ss-hover-boost, 1);
    --ss-bloom: var(--ss-hover-bloom, 0px);
    --ss-lift: var(--ss-hover-lift, 1);
}

[data-ss-item][data-ss-selected="true"] {
    --ss-boost: var(--ss-selected-boost, 1);
}

/* ------------------------------------------------------------ the shape -- */

/* Only reshape when a real shape is chosen; on "Discord Default" the attribute
   is absent and Discord's own squircle mask is left completely alone. */
[data-ss-shaped="true"] [data-ss-icon] {
    clip-path: var(--ss-clip, none);
    -webkit-mask: none !important;
    mask: none !important;
}

/* Replacing Discord's mask also removes their hover shape-morph, so the icon
   would otherwise feel deader than stock. A scale puts that life back. */
[data-ss-icon] {
    transform: scale(var(--ss-lift, 1));
    transform-origin: center;
    transition: transform .18s cubic-bezier(.2, .9, .3, 1.2);
}

/* An <svg> root clips its viewport, which would shear the lifted icon. */
[data-ss-svg] {
    overflow: visible;
}

/* ------------------------------------------------------------- the glow -- */

/* ----------------------------------------------------------- the glow -- */

/*
 * The blur lives on the wrapper and the mask on the fill inside it.
 *
 * CSS applies filter to an element before mask and clip-path, so masking a
 * blurred layer re-sharpens the very edge the blur softened - the halo comes
 * out as a hard-edged inflated silhouette rather than a soft aura. Shaping the
 * child and blurring the parent is what actually produces a glow.
 */
.ss-w {
    position: absolute;
    pointer-events: none;
    animation-timing-function: ease-in-out, linear, linear;
    animation-iteration-count: infinite, infinite, infinite;
}

.ss-f {
    position: absolute;
    inset: 0;
    background: var(--ss-paint, transparent);
    -webkit-mask-size: 100% 100%;
    mask-size: 100% 100%;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
}

.ss-w[data-layer="halo"] {
    opacity: var(--ss-halo-op);
    filter: var(--ss-filter, none) blur(var(--ss-blur, 0px));
    animation-name: var(--ss-anim-name, none), var(--ss-spin-name, none), var(--ss-hue-name, none);
    animation-duration: var(--ss-anim-speed, 0s), var(--ss-spin-speed, 0s), var(--ss-hue-speed, 0s);
}

.ss-w[data-layer="rim"] {
    opacity: var(--ss-rim-op);
    filter: var(--ss-filter, none);
    animation-name: var(--ss-anim-name-rim, none), var(--ss-spin-name, none), var(--ss-hue-name, none);
    animation-duration: var(--ss-anim-speed, 0s), var(--ss-spin-speed, 0s), var(--ss-hue-speed, 0s);
}

/*
 * The in-rail half, attached directly to the positioned rail, so
 * unread counts, mention badges and voice indicators all sit on top of it.
 */
.ss-g,
.ss-preview-glow {
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
}

/*
 * The part that has left the rail. Fixed to the viewport so no ancestor of the
 * rail can clip it, and clipped to start at the rail's edge so it never paints
 * over the rail or the badges on it.
 */
#vc-ss-overlay {
    position: fixed;
    inset: 0;
    pointer-events: none;
    /* high enough that no app container can paint over it; harmless because it
       never takes pointer events */
    z-index: 100000;
}

.ss-o {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    will-change: transform;
}

.ss-g[data-ss-hover="true"],
.ss-o[data-ss-hover="true"] {
    --ss-boost: var(--ss-hover-boost, 1);
}

.ss-g[data-ss-sel="true"],
.ss-o[data-ss-sel="true"] {
    --ss-boost: var(--ss-selected-boost, 1);
}

/* --------------------------------------------------------- the breathing -- */

@keyframes ss-breathe {
    0%, 100% {
        opacity: var(--ss-halo-op-lo);
        transform: scale(1);
    }
    50% {
        opacity: var(--ss-halo-op);
        transform: scale(calc(1 + var(--ss-anim-amount, 0) * 0.09));
    }
}

@keyframes ss-breathe-rim {
    0%, 100% {
        opacity: var(--ss-rim-op-lo);
    }
    50% {
        opacity: var(--ss-rim-op);
    }
}

/* The gradient sweeps around the silhouette. */
@keyframes ss-spin {
    to { --ss-angle: 360deg; }
}

/* A full trip around the colour wheel. */
@keyframes ss-hue {
    to { --ss-hue: 360deg; }
}

@media (prefers-reduced-motion: reduce) {
    .ss-w {
        animation-name: none !important;
    }

    [data-ss-icon] {
        transition: none;
    }
}
`;
