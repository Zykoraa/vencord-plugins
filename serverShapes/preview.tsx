/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "@webpack/common";

import { buildVars, isGlowing, isShaped } from "./glow";
import { buildGlowNodes, layoutLayer } from "./glowNodes";
import { maskImageFor, PREVIEW_PREFIX, SHAPES } from "./shapes";
import { ScopeConfig } from "./types";

export type SampleId = "vencord" | "gradient" | "avatar" | "acronym";

export const SAMPLES: { id: SampleId; label: string; }[] = [
    { id: "vencord", label: "Vencord" },
    { id: "gradient", label: "Gradient" },
    { id: "avatar", label: "Avatar" },
    { id: "acronym", label: "Acronym" }
];

/**
 * The preview defs are a second copy of the shape library under their own id
 * prefix. The settings panel can be opened while the plugin is disabled - when
 * the runtime defs are not in the document - and the preview still has to draw.
 */
export function PreviewDefs() {
    return (
        <svg aria-hidden width={0} height={0} style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}>
            <defs>
                {SHAPES.filter(s => s.path).map(shape => (
                    <clipPath
                        key={shape.id}
                        id={`${PREVIEW_PREFIX}-${shape.id}`}
                        clipPathUnits="objectBoundingBox"
                    >
                        <path
                            d={shape.path!}
                            clipRule={shape.evenOdd ? "evenodd" : undefined}
                            transform={shape.unitPath ? undefined : "scale(0.01)"}
                        />
                    </clipPath>
                ))}
            </defs>
        </svg>
    );
}

/*
 * Every sample is drawn inline rather than fetched, so the preview renders
 * identically offline and never flashes a broken image while loading.
 */

function VencordSample() {
    return (
        <div className="ss-sample ss-sample-vencord">
            <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden>
                <path
                    d="M13 12 L24 36 L35 12 L29 12 L24 24 L19 12 Z"
                    fill="#fff"
                    opacity={0.95}
                />
            </svg>
        </div>
    );
}

function GradientSample() {
    return <div className="ss-sample ss-sample-gradient" />;
}

function AvatarSample() {
    return (
        <div className="ss-sample ss-sample-avatar">
            <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden>
                <circle cx="24" cy="26" r="13" fill="#f6d5bd" />
                {/* hair */}
                <path d="M10 26 C10 13 38 13 38 26 L38 19 C38 9 10 9 10 19 Z" fill="#3b2a4a" />
                <path d="M10 22 C14 24 18 18 24 18 C30 18 34 24 38 22 L38 17 C38 9 10 9 10 17 Z" fill="#4a3560" />
                {/* eyes */}
                <ellipse cx="19" cy="27" rx="2.2" ry="3" fill="#2b2b3a" />
                <ellipse cx="29" cy="27" rx="2.2" ry="3" fill="#2b2b3a" />
                <circle cx="19.8" cy="26" r="0.8" fill="#fff" />
                <circle cx="29.8" cy="26" r="0.8" fill="#fff" />
                {/* mouth */}
                <path d="M22 32 Q24 34 26 32" stroke="#b9736a" strokeWidth="1.2" fill="none" strokeLinecap="round" />
            </svg>
        </div>
    );
}

function AcronymSample() {
    return <div className="ss-sample ss-sample-acronym">SS</div>;
}

function renderSample(id: SampleId) {
    switch (id) {
        case "vencord": return <VencordSample />;
        case "gradient": return <GradientSample />;
        case "avatar": return <AvatarSample />;
        case "acronym": return <AcronymSample />;
    }
}

interface PreviewProps {
    config: ScopeConfig;
    sample: SampleId;
    selected: boolean;
}

/**
 * Renders through the same attributes and custom properties the live rail uses,
 * against the same stylesheet. The preview therefore cannot drift from the real
 * output - if it looks right here it is because the real rule set produced it.
 */
export function PreviewIcon({ config, sample, selected }: PreviewProps) {
    const vars = { ...buildVars(config, PREVIEW_PREFIX), "--ss-preview-mask": maskImageFor(config.shape) } as React.CSSProperties;
    const hostRef = React.useRef<HTMLDivElement>(null);
    const [hovered, setHovered] = React.useState(false);
    React.useLayoutEffect(() => {
        const host = hostRef.current;
        if (!host || !isGlowing(config)) return;
        const nodes = buildGlowNodes("ss-preview-glow");
        host.prepend(nodes.root);
        const values = buildVars(config, PREVIEW_PREFIX);
        const lift = hovered ? 1 + config.glow.hoverLift : 1;
        const size = 48 * lift;
        const box = { x: (72 - size) / 2, y: (60 - size) / 2, width: size, height: size,
            mask: "none", shape: config.shape };
        layoutLayer(nodes.haloWrap, nodes.haloFill, { ...box,
            extend: parseFloat(values["--ss-halo"]) + (hovered ? config.glow.hoverBloom : 0) });
        layoutLayer(nodes.rimWrap, nodes.rimFill, { ...box, extend: parseFloat(values["--ss-rim"]) });
        return () => nodes.root.remove();
    }, [config, hovered]);

    return (
        <div
            ref={hostRef}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            className="ss-preview-item"
            data-ss-item=""
            data-ss-shaped={String(isShaped(config))}
            data-ss-glow={String(isGlowing(config))}
            data-ss-selected={String(selected)}
            style={vars}
        >
            <div className="ss-preview-icon" data-ss-icon="">
                {renderSample(sample)}
            </div>
        </div>
    );
}

export function PreviewStrip({ config, sample, selected }: PreviewProps) {
    return (
        <div className="ss-preview">
            <div className="ss-preview-rail">
                <PreviewIcon config={config} sample={sample} selected={selected} />
                <PreviewIcon config={config} sample="acronym" selected={false} />
                <PreviewIcon config={config} sample="gradient" selected={false} />
            </div>
            <div className="ss-preview-hint">{config.glow.autoColor ? "Sample colours shown • actual servers use their own icon palette" : "Hover an icon to preview bloom and brightness"}</div>
        </div>
    );
}
