/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { FormSwitch } from "@components/FormSwitch";
import { GuildStore, React, Select, TextInput, useEffect, useMemo, useState } from "@webpack/common";

import { AudioSourceOption, getAudioStatus, listAudioSources, subscribeAudio } from "./audio";
import { diagnose } from "./dom";
import { GLOW_STYLES, PAINT_MODES } from "./glow";
import { PANEL_CSS } from "./panelCss";
import { registerPanel } from "./pluginSettings";
import { BUILTIN_PRESETS } from "./presets";
import { PreviewStrip, SampleId, SAMPLES } from "./preview";
import { RUNTIME_CSS } from "./runtimeCss";
import { maskImageFor, SHAPES } from "./shapes";
import {
    applyPreset,
    deletePreset,
    EditScope,
    getConfig,
    patchAnimation,
    patchAudio,
    patchGlow,
    patchProfile,
    patchProfileGlow,
    patchRoot,
    readScope,
    resetEverything,
    resetPart,
    resetServerToGlobal,
    savePreset,
    setShape,
    subscribe,
    writeScope
} from "./store";
import { ShapeId } from "./types";
import {
    canRedo,
    canUndo,
    commit,
    initHistory,
    redo,
    redoLabel,
    subscribeHistory,
    undo,
    undoLabel
} from "./undoRedo";

const PANEL_STYLE_ID = "vc-server-shapes-panel-style";
let panelStyleUsers = 0;

/**
 * The panel can be opened while the plugin is disabled, so it brings its own
 * copy of the runtime rules. That is also what makes the preview trustworthy:
 * it renders through the very same stylesheet the live rail uses.
 */
function usePanelStyles() {
    useEffect(() => {
        panelStyleUsers++;
        let el = document.getElementById(PANEL_STYLE_ID) as HTMLStyleElement | null;
        if (!el) {
            el = document.createElement("style");
            el.id = PANEL_STYLE_ID;
            el.textContent = `${RUNTIME_CSS}\n${PANEL_CSS}`;
            document.head.appendChild(el);
        }
        return () => {
            if (--panelStyleUsers === 0) el?.remove();
        };
    }, []);
}

/** Re-renders the panel whenever the stored config or the history changes. */
function useStoreTick() {
    const [, setTick] = useState(0);
    useEffect(() => {
        const bump = () => setTick(t => t + 1);
        const offStore = subscribe(bump);
        const offHistory = subscribeHistory(bump);
        return () => {
            offStore();
            offHistory();
        };
    }, []);
}

/* ------------------------------------------------------------- primitives -- */

function Section({ title, children }: React.PropsWithChildren<{ title: string; }>) {
    return (
        <div className="ss-section">
            <h3 className="ss-section-title">{title}</h3>
            {children}
        </div>
    );
}

interface NumRowProps {
    label: string;
    sub?: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    /** bumped from outside to remount the uncontrolled slider after undo/preset */
    revision: number;
    onChange(v: number): void;
    render?(v: number): string;
}

function NumRow({ label, sub, value, min, max, step, revision, onChange, render }: NumRowProps) {
    const id = React.useId();
    const [draft, setDraft] = useState(String(value));
    useEffect(() => setDraft(String(+value.toFixed(3))), [value, revision]);
    function applyNumber() {
        const parsed = Number(draft);
        if (draft.trim() && Number.isFinite(parsed)) onChange(Math.min(max, Math.max(min, parsed)));
        else setDraft(String(value));
    }
    return (
        <div className="ss-field">
            <div className="ss-number-heading">
                <label htmlFor={id} className="ss-row-label">
                    {label}
                    {sub && <div className="ss-row-sub">{sub}</div>}
                </label>
                <output className="ss-value" htmlFor={id}>{render ? render(value) : +value.toFixed(2)}</output>
            </div>
            <div className="ss-number-controls">
                <input id={id} className="ss-range" type="range" min={min} max={max}
                    step={step ?? "any"} value={value} onChange={e => onChange(Number(e.currentTarget.value))} />
                <input className="ss-number" type="number" aria-label={`${label}: exact value`}
                    min={min} max={max} step={step ?? "any"} value={draft}
                    onChange={e => setDraft(e.currentTarget.value)} onBlur={applyNumber}
                    onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} />
            </div>
        </div>
    );
}

function Chips<T extends string>({
    options,
    value,
    onChange
}: {
    options: { id: T; label: string; }[];
    value: T;
    onChange(v: T): void;
}) {
    return (
        <div className="ss-chiprow">
            {options.map(opt => (
                <button
                    key={opt.id}
                    className="ss-chip"
                    data-active={String(opt.id === value)}
                    aria-pressed={opt.id === value}
                    onClick={() => onChange(opt.id)}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    );
}

/** Two-step confirm: no browser dialogs, which would freeze the client. */
function ConfirmButton({
    label,
    confirmLabel,
    onConfirm,
    variant = "dangerSecondary"
}: {
    label: string;
    confirmLabel: string;
    onConfirm(): void;
    variant?: "dangerPrimary" | "dangerSecondary" | "secondary";
}) {
    const [armed, setArmed] = useState(false);

    useEffect(() => {
        if (!armed) return;
        const t = setTimeout(() => setArmed(false), 4000);
        return () => clearTimeout(t);
    }, [armed]);

    return (
        <Button
            size="small"
            variant={armed ? "dangerPrimary" : variant}
            onClick={() => {
                if (armed) {
                    onConfirm();
                    setArmed(false);
                } else {
                    setArmed(true);
                }
            }}
        >
            {armed ? confirmLabel : label}
        </Button>
    );
}

/** Subscribes to the audio engine's status. */
function useAudioStatus() {
    const [status, setStatus] = useState(getAudioStatus());
    useEffect(() => subscribeAudio(setStatus), []);
    return status;
}

/** Live engine state, refreshed while the panel is open. */
function DiagnosticsReadout({ revision }: { revision: number; }) {
    const audioStatus = useAudioStatus();
    const [info, setInfo] = useState(() => diagnose());

    useEffect(() => {
        setInfo(diagnose());
        const id = setInterval(() => setInfo(diagnose()), 1500);
        return () => clearInterval(id);
    }, [revision]);

    const rows: [string, string, boolean][] = [
        ["Plugin running", info.running ? "yes" : "no", info.running],
        ["Server rail found", info.railFound ? "yes" : "no", info.railFound],
        ["Rows seen / styled", `${info.railItems} / ${info.tagged}`, info.tagged > 0],
        ["Rows with glow on", String(info.glowing), info.glowing > 0],
        ["Icon element", info.iconKind, info.iconKind !== "none"],
        ["Stylesheet + shapes injected", info.styleInjected && info.defsInjected ? "yes" : "no",
            info.styleInjected && info.defsInjected],
        ["Audio capture", audioStatus.state === "error"
            ? `error: ${audioStatus.message ?? "unknown"}`
            : audioStatus.state,
            audioStatus.state !== "error"],
        ["Audio level", document.documentElement.style.getPropertyValue("--ss-audio") || "not running",
            true]
    ];

    return (
        <div className="ss-list">
            {rows.map(([label, value, ok]) => (
                <div className="ss-list-row" key={label}>
                    <span>{label}</span>
                    <span className={ok ? "ss-muted" : "ss-danger"}>{value}</span>
                </div>
            ))}
        </div>
    );
}

/* ------------------------------------------------------------------ panel -- */

type TabId = "appearance" | "custom" | "effects" | "servers" | "profiles" | "presets";

const TABS: { id: TabId; label: string; }[] = [
    { id: "appearance", label: "Appearance" },
    { id: "custom", label: "Colour & motion" },
    { id: "effects", label: "Audio" },
    { id: "servers", label: "Servers" },
    { id: "profiles", label: "Avatars" },
    { id: "presets", label: "Presets" }
];

export function SettingsPanel({ initialScope }: { initialScope?: EditScope; } = {}) {
    usePanelStyles();
    useStoreTick();

    const [tab, setTab] = useState<TabId>("appearance");
    const [scope, setScope] = useState<EditScope>(initialScope ?? { kind: "global" });
    const [sample, setSample] = useState<SampleId>("vencord");
    const [previewSelected, setPreviewSelected] = useState(false);
    const [presetName, setPresetName] = useState("");
    // bumped whenever values change from outside the inputs themselves
    const [revision, setRevision] = useState(0);

    const [audioSources, setAudioSources] = useState<AudioSourceOption[]>([]);
    const [audioStatus, setAudioStatus] = useState(getAudioStatus());

    useEffect(() => subscribeAudio(setAudioStatus), []);
    useEffect(() => {
        let alive = true;
        void listAudioSources().then(list => alive && setAudioSources(list));
        return () => { alive = false; };
    }, [revision]);

    useEffect(() => initHistory(scope), []);

    const config = getConfig();
    const current = readScope(scope);

    const guilds = useMemo(() => {
        try {
            return Object.values(GuildStore.getGuilds() ?? {})
                .map((g: any) => ({ id: g.id as string, name: g.name as string }))
                .sort((a, b) => a.name.localeCompare(b.name));
        } catch {
            return [] as { id: string; name: string; }[];
        }
    }, [revision, tab]);

    const guildName = (id: string) => guilds.find(g => g.id === id)?.name ?? `Server ${id}`;

    /** Every mutation goes through here so history and the UI stay in step. */
    function edit(label: string, fn: () => void, external = false) {
        fn();
        commit(scope, label);
        if (external) setRevision(r => r + 1);
    }

    function doUndo() {
        const restored = undo();
        if (restored) setScope(restored);
        setRevision(r => r + 1);
    }

    function doRedo() {
        const restored = redo();
        if (restored) setScope(restored);
        setRevision(r => r + 1);
    }

    const { glow } = current;
    const scopeLabel = scope.kind === "global" ? "Global defaults" : guildName(scope.guildId);

    /* ------------------------------------------------------------ sections -- */

    const shapeSection = (
        <Section title="Shape">
            <div className="ss-shape-grid">
                {SHAPES.map(shape => (
                    <button
                        key={shape.id}
                        className="ss-shape-btn"
                        data-active={String(current.shape === shape.id)}
                        aria-pressed={current.shape === shape.id}
                        onClick={() => edit(`Shape: ${shape.label}`, () => setShape(scope, shape.id))}
                    >
                        <div
                            className="ss-shape-swatch"
                            data-default={String(shape.id === "default")}
                            style={{ maskImage: maskImageFor(shape.id) }}
                        />
                        {shape.label}
                    </button>
                ))}
            </div>
            <div className="ss-muted">
                Discord Default leaves Discord's own squircle mask untouched. Every other shape clips the
                real icon.
            </div>
        </Section>
    );

    const glowSection = (
        <Section title="Glow">
            <FormSwitch
                title="Enable glow"
                description="Draws an edge light behind the icon that follows the shape silhouette."
                value={glow.enabled}
                onChange={v => edit(v ? "Glow on" : "Glow off", () => patchGlow(scope, { enabled: v }))}
                hideBorder
            />

            <FormSwitch
                title="Match each server's own colours"
                description="Samples the server's icon and lights it in its own palette. Overrides the colour below, per server."
                value={glow.autoColor}
                onChange={v => edit(v ? "Auto colour on" : "Auto colour off", () => patchGlow(scope, { autoColor: v }), true)}
                hideBorder
            />

            <div className="ss-field">
                <div className="ss-row-label">Glow style</div>
                <Chips
                    options={GLOW_STYLES.map(s => ({ id: s.id, label: s.label }))}
                    value={glow.style}
                    onChange={v => edit(`Glow style: ${v}`, () => patchGlow(scope, { style: v }), true)}
                />
                <div className="ss-muted">
                    {GLOW_STYLES.find(s => s.id === glow.style)?.description}
                </div>
            </div>

            <NumRow
                label="Intensity" sub="Saturation and brightness of the light"
                value={glow.intensity} min={0} max={200} step={5} revision={revision}
                onChange={v => edit("Intensity", () => patchGlow(scope, { intensity: v }))}
                render={v => `${Math.round(v)}%`}
            />
            <NumRow
                label="Spread"
                sub="How far the soft halo reaches past the icon"
                value={glow.spread} min={0} max={60} step={2} revision={revision}
                onChange={v => edit("Spread", () => patchGlow(scope, { spread: v }))}
                render={v => `${Math.round(v)}px`}
            />
            <NumRow
                label="Blur"
                value={glow.blur} min={0} max={80} step={2} revision={revision}
                onChange={v => edit("Blur", () => patchGlow(scope, { blur: v }))}
                render={v => `${Math.round(v)}px`}
            />
            <NumRow
                label="Opacity"
                value={glow.opacity} min={0} max={1} step={0.05} revision={revision}
                onChange={v => edit("Opacity", () => patchGlow(scope, { opacity: v }))}
                render={v => `${Math.round(v * 100)}%`}
            />
            <NumRow
                label="Outline thickness"
                value={glow.thickness} min={0} max={20} step={1} revision={revision}
                onChange={v => edit("Thickness", () => patchGlow(scope, { thickness: v }))}
                render={v => `${Math.round(v)}px`}
            />
            <NumRow
                label="Hover boost"
                value={glow.hoverBoost} min={1} max={3} step={0.05} revision={revision}
                onChange={v => edit("Hover boost", () => patchGlow(scope, { hoverBoost: v }))}
                render={v => `${v.toFixed(2)}x`}
            />
            <NumRow
                label="Selected-server boost"
                value={glow.selectedBoost} min={1} max={3} step={0.05} revision={revision}
                onChange={v => edit("Selected boost", () => patchGlow(scope, { selectedBoost: v }))}
                render={v => `${v.toFixed(2)}x`}
            />
            <NumRow
                label="Hover bloom" sub="Extra px the halo swells to under the cursor"
                value={glow.hoverBloom} min={0} max={20} step={1} revision={revision}
                onChange={v => edit("Hover bloom", () => patchGlow(scope, { hoverBloom: v }))}
                render={v => `${Math.round(v)}px`}
            />
            <NumRow
                label="Hover lift" sub="Reshaping replaces Discord's hover morph; this puts the motion back"
                value={glow.hoverLift} min={0} max={0.2} step={0.01} revision={revision}
                onChange={v => edit("Hover lift", () => patchGlow(scope, { hoverLift: v }))}
                render={v => (v === 0 ? "off" : `+${Math.round(v * 100)}%`)}
            />
        </Section>
    );

    const gradientSection = (
        <Section title="Gradient">
            <div className="ss-field">
                <div className="ss-row-label">Paint mode</div>
                <Chips
                    options={PAINT_MODES.map(m => ({ id: m.id, label: m.label }))}
                    value={glow.paintMode}
                    onChange={v => edit(`Paint: ${v}`, () => patchGlow(scope, { paintMode: v }), true)}
                />
            </div>

            {glow.paintMode === "solid" ? (
                <div className="ss-row">
                    <div className="ss-row-label">Colour</div>
                    <input
                        className="ss-color"
                        type="color"
                        value={glow.color}
                        onChange={e => edit("Colour", () => patchGlow(scope, { color: e.target.value }))}
                    />
                </div>
            ) : (
                <>
                    <div className="ss-field">
                        <div className="ss-row-label">Gradient stops</div>
                        <div className="ss-stops">
                            {glow.gradientStops.map((stop, i) => (
                                <div className="ss-stop" key={i}>
                                    <input
                                        className="ss-color"
                                        type="color"
                                        value={stop}
                                        onChange={e => {
                                            const next = [...glow.gradientStops];
                                            next[i] = e.target.value;
                                            edit("Gradient stop", () => patchGlow(scope, { gradientStops: next }));
                                        }}
                                    />
                                    {glow.gradientStops.length > 2 && (
                                        <Button
                                            size="min"
                                            variant="secondary"
                                            onClick={() => {
                                                const next = glow.gradientStops.filter((_, j) => j !== i);
                                                edit("Remove stop", () => patchGlow(scope, { gradientStops: next }), true);
                                            }}
                                        >
                                            x
                                        </Button>
                                    )}
                                </div>
                            ))}
                            {glow.gradientStops.length < 6 && (
                                <Button
                                    size="small"
                                    variant="secondary"
                                    onClick={() => {
                                        const next = [...glow.gradientStops, "#ffffff"];
                                        edit("Add stop", () => patchGlow(scope, { gradientStops: next }), true);
                                    }}
                                >
                                    Add stop
                                </Button>
                            )}
                        </div>
                    </div>

                    <NumRow
                        label="Angle"
                        sub={glow.paintMode === "conic" ? "Where the colour wheel starts" : "Direction of the gradient"}
                        value={glow.gradientAngle} min={0} max={360} step={5} revision={revision}
                        onChange={v => edit("Angle", () => patchGlow(scope, { gradientAngle: v }))}
                        render={v => `${Math.round(v)}°`}
                    />
                </>
            )}

            <div className="ss-muted">
                Gradients are painted onto the glow layer itself, so they work in every glow style. A
                gradient with fewer than two stops falls back to a solid colour.
                {glow.autoColor && " Match-server-colours is on, so these colours are only used for servers whose icon can't be read."}
            </div>
        </Section>
    );

    const animationSection = (
        <Section title="Animation">
            <FormSwitch
                title="Breathing glow"
                description="Slowly pulses the glow. Respects your system's reduced-motion setting."
                value={current.animation.enabled}
                onChange={v => edit(v ? "Animation on" : "Animation off", () => patchAnimation(scope, { enabled: v }))}
                hideBorder
            />
            <NumRow
                label="Cycle length"
                value={current.animation.speed} min={1} max={12} step={0.5} revision={revision}
                onChange={v => edit("Animation speed", () => patchAnimation(scope, { speed: v }))}
                render={v => `${v.toFixed(1)}s`}
            />
            <NumRow
                label="Depth" sub="How far the glow dips at the bottom of each breath"
                value={current.animation.amount} min={0} max={1} step={0.05} revision={revision}
                onChange={v => edit("Animation depth", () => patchAnimation(scope, { amount: v }))}
                render={v => `${Math.round(v * 100)}%`}
            />

            <FormSwitch
                title="Rotate the gradient"
                description={
                    glow.paintMode === "solid"
                        ? "Needs a gradient paint mode - a solid colour has nothing to rotate."
                        : "Sweeps the gradient around the silhouette."
                }
                value={current.animation.spin}
                disabled={glow.paintMode === "solid"}
                onChange={v => edit(v ? "Spin on" : "Spin off", () => patchAnimation(scope, { spin: v }), true)}
                hideBorder
            />
            {current.animation.spin && glow.paintMode !== "solid" && (
                <NumRow
                    label="Rotation time"
                    value={current.animation.spinSpeed} min={2} max={30} step={1} revision={revision}
                    onChange={v => edit("Spin speed", () => patchAnimation(scope, { spinSpeed: v }))}
                    render={v => `${Math.round(v)}s / turn`}
                />
            )}

            <FormSwitch
                title="Cycle through colours"
                description="Rotates the whole glow around the colour wheel."
                value={current.animation.hueCycle}
                onChange={v => edit(v ? "Hue cycle on" : "Hue cycle off", () => patchAnimation(scope, { hueCycle: v }), true)}
                hideBorder
            />
            {current.animation.hueCycle && (
                <NumRow
                    label="Colour cycle time"
                    value={current.animation.hueSpeed} min={2} max={60} step={1} revision={revision}
                    onChange={v => edit("Hue speed", () => patchAnimation(scope, { hueSpeed: v }))}
                    render={v => `${Math.round(v)}s / loop`}
                />
            )}
        </Section>
    );

    const { profile } = config;
    const profileSection = (
        <Section title="Profile avatars">
            <FormSwitch
                title="Glow on profile avatars"
                description="Applies the same edge light to avatar areas, independently of server icons."
                value={profile.enabled}
                onChange={v => edit(v ? "Profile glow on" : "Profile glow off", () => patchProfile({ enabled: v }))}
                hideBorder
            />

            {profile.enabled && (
                <>
                    <FormSwitch
                        title="Account panel (bottom left)"
                        value={profile.accountPanel}
                        onChange={v => edit("Profile: account panel", () => patchProfile({ accountPanel: v }))}
                        hideBorder
                    />
                    <FormSwitch
                        title="Profile popout"
                        value={profile.popout}
                        onChange={v => edit("Profile: popout", () => patchProfile({ popout: v }))}
                        hideBorder
                    />
                    <FormSwitch
                        title="Full profile modal"
                        value={profile.modal}
                        onChange={v => edit("Profile: modal", () => patchProfile({ modal: v }))}
                        hideBorder
                    />

                    <FormSwitch
                        title="Use a separate glow for avatars"
                        description="Off means avatars follow the global server glow."
                        value={profile.useOwnGlow}
                        onChange={v => edit("Profile glow source", () => patchProfile({ useOwnGlow: v }), true)}
                        hideBorder
                    />

                    {profile.useOwnGlow && (
                        <>
                            <div className="ss-row">
                                <div className="ss-row-label">Avatar glow colour</div>
                                <input
                                    className="ss-color"
                                    type="color"
                                    value={profile.glow.color}
                                    onChange={e => edit("Avatar colour", () => patchProfileGlow({
                                        color: e.target.value,
                                        paintMode: "solid"
                                    }))}
                                />
                            </div>
                            <NumRow
                                label="Avatar spread"
                                value={profile.glow.spread} min={0} max={24} step={1} revision={revision}
                                onChange={v => edit("Avatar spread", () => patchProfileGlow({ spread: v }))}
                                render={v => `${Math.round(v)}px`}
                            />
                            <NumRow
                                label="Avatar blur"
                                value={profile.glow.blur} min={0} max={40} step={1} revision={revision}
                                onChange={v => edit("Avatar blur", () => patchProfileGlow({ blur: v }))}
                                render={v => `${Math.round(v)}px`}
                            />
                            <NumRow
                                label="Avatar thickness"
                                value={profile.glow.thickness} min={0} max={12} step={1} revision={revision}
                                onChange={v => edit("Avatar thickness", () => patchProfileGlow({ thickness: v }))}
                                render={v => `${Math.round(v)}px`}
                            />
                        </>
                    )}

                    <FormSwitch
                        title="Reshape avatars too"
                        description="Off by default: Discord's avatar mask also cuts the hole for the status dot, so reshaping can overlap it."
                        value={profile.matchShape}
                        onChange={v => edit("Avatar shape matching", () => patchProfile({ matchShape: v }), true)}
                        hideBorder
                    />

                    {profile.matchShape && (
                        <div className="ss-field">
                            <div className="ss-row-label">Avatar shape</div>
                            <Chips
                                options={SHAPES.map(s => ({ id: s.id, label: s.label }))}
                                value={profile.shape}
                                onChange={v => edit(`Avatar shape: ${v}`, () => patchProfile({ shape: v as ShapeId }), true)}
                            />
                        </div>
                    )}
                </>
            )}
        </Section>
    );

    const overriddenIds = Object.keys(config.perServer);
    const serversSection = (
        <Section title="Servers">
            <FormSwitch
                title="Apply to folder icons"
                value={config.applyToFolders}
                onChange={v => edit("Folders", () => patchRoot({ applyToFolders: v }))}
                hideBorder
            />
            <FormSwitch
                title="Apply to Home, DMs and Discovery buttons"
                description="Off by default: these are Discord's own buttons rather than servers."
                value={config.includeHome}
                onChange={v => edit("Home buttons", () => patchRoot({ includeHome: v }))}
                hideBorder
            />

            <FormSwitch
                title="Let the glow spill past the rail"
                description="Lets the soft glow extend into the channel sidebar without cutting off at the server rail. Turn off to keep it inside the rail."
                value={config.spill}
                onChange={v => edit(v ? "Spill on" : "Spill off", () => patchRoot({ spill: v }), true)}
                hideBorder
            />

            <NumRow
                label="Rail breathing room"
                sub="Extra space around the server icons. The glow is drawn outside the rail, so this is only a spacing preference."
                value={config.railExtraWidth} min={0} max={96} step={4} revision={revision}
                onChange={v => edit("Rail width", () => patchRoot({ railExtraWidth: v }))}
                render={v => (v === 0 ? "off" : `+${Math.round(v)}px`)}
            />

            <div className="ss-field">
                <div className="ss-row-label">Customise a specific server</div>
                <Select
                    placeholder="Pick a server to edit"
                    options={[
                        { label: "Global defaults", value: "__global__" },
                        ...guilds.map(g => ({
                            label: config.perServer[g.id] ? `${g.name}  (customised)` : g.name,
                            value: g.id
                        }))
                    ]}
                    maxVisibleItems={8}
                    closeOnSelect
                    select={(v: string) => {
                        setScope(v === "__global__" ? { kind: "global" } : { kind: "server", guildId: v });
                        setRevision(r => r + 1);
                    }}
                    isSelected={(v: string) =>
                        scope.kind === "global" ? v === "__global__" : v === scope.guildId}
                    serialize={(v: string) => v}
                />
                <div className="ss-muted">
                    You can also right-click any server in the rail for the same options.
                </div>
            </div>

            <div className="ss-field">
                <div className="ss-row-label">Servers with their own look ({overriddenIds.length})</div>
                {overriddenIds.length === 0 ? (
                    <div className="ss-muted">None yet. Everything follows the global defaults.</div>
                ) : (
                    <div className="ss-list">
                        {overriddenIds.map(id => (
                            <div
                                className="ss-list-row"
                                key={id}
                                data-active={String(scope.kind === "server" && scope.guildId === id)}
                            >
                                <span>{guildName(id)}</span>
                                <div className="ss-btnrow">
                                    <Button
                                        size="small"
                                        variant="secondary"
                                        onClick={() => {
                                            setScope({ kind: "server", guildId: id });
                                            setTab("appearance");
                                            setRevision(r => r + 1);
                                        }}
                                    >
                                        Edit
                                    </Button>
                                    <Button
                                        size="small"
                                        variant="dangerSecondary"
                                        onClick={() => {
                                            edit("Reset server", () => resetServerToGlobal(id), true);
                                            if (scope.kind === "server" && scope.guildId === id) {
                                                setScope({ kind: "global" });
                                            }
                                        }}
                                    >
                                        Reset
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </Section>
    );

    const presetsSection = (
        <Section title="Presets">
            <div className="ss-row">
                <TextInput
                    className="ss-inline-input"
                    placeholder="Preset name"
                    value={presetName}
                    onChange={(v: string) => setPresetName(v)}
                />
                <Button
                    size="small"
                    onClick={() => {
                        edit("Save preset", () => savePreset(presetName || `Preset ${config.presets.length + 1}`, current));
                        setPresetName("");
                    }}
                >
                    Save current
                </Button>
            </div>
            <div className="ss-muted">
                A preset stores the shape, glow, gradient and animation of whatever you are editing now
                ({scopeLabel}).
            </div>

            <div className="ss-field">
                <div className="ss-row-label">Built in</div>
                <div className="ss-list">
                    {BUILTIN_PRESETS.map(preset => (
                        <div className="ss-list-row" key={preset.id}>
                            <span>{preset.name}</span>
                            <div className="ss-btnrow">
                                <Button
                                    size="small"
                                    variant="secondary"
                                    onClick={() => edit(`Apply preset: ${preset.name}`, () => applyPreset(scope, preset.id), true)}
                                >
                                    Apply to {scope.kind === "global" ? "global" : "this server"}
                                </Button>
                                {scope.kind !== "global" && (
                                    <Button
                                        size="small"
                                        variant="secondary"
                                        onClick={() => edit(`Apply preset globally: ${preset.name}`, () => applyPreset({ kind: "global" }, preset.id), true)}
                                    >
                                        Globally
                                    </Button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="ss-row-label">Your presets</div>
            {config.presets.length === 0 ? (
                <div className="ss-muted">No presets saved yet.</div>
            ) : (
                <div className="ss-list">
                    {config.presets.map(preset => (
                        <div className="ss-list-row" key={preset.id}>
                            <span>{preset.name}</span>
                            <div className="ss-btnrow">
                                <Button
                                    size="small"
                                    variant="secondary"
                                    onClick={() => edit(`Apply preset: ${preset.name}`, () => applyPreset(scope, preset.id), true)}
                                >
                                    Apply to {scope.kind === "global" ? "global" : "this server"}
                                </Button>
                                {scope.kind !== "global" && (
                                    <Button
                                        size="small"
                                        variant="secondary"
                                        onClick={() => edit(`Apply preset globally: ${preset.name}`, () => applyPreset({ kind: "global" }, preset.id), true)}
                                    >
                                        Apply globally
                                    </Button>
                                )}
                                <ConfirmButton
                                    label="Delete"
                                    confirmLabel="Really delete?"
                                    onConfirm={() => edit("Delete preset", () => deletePreset(preset.id), true)}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </Section>
    );

    const diagnosticsSection = (
        <Section title="Diagnostics">
            <div className="ss-muted">
                What the engine can actually see right now. If the glow is missing, this says why.
            </div>
            <DiagnosticsReadout revision={revision} />
        </Section>
    );

    const resetSection = (
        <Section title="Reset">
            <div className="ss-muted">These act on what you are editing now: {scopeLabel}.</div>
            <div className="ss-btnrow">
                <Button size="small" variant="secondary" onClick={() => edit("Reset shape", () => resetPart(scope, "shape"), true)}>
                    Reset shape
                </Button>
                <Button size="small" variant="secondary" onClick={() => edit("Reset glow", () => resetPart(scope, "glow"), true)}>
                    Reset glow
                </Button>
                <Button size="small" variant="secondary" onClick={() => edit("Reset gradient", () => resetPart(scope, "gradient"), true)}>
                    Reset gradient
                </Button>
                <Button size="small" variant="secondary" onClick={() => edit("Reset animation", () => resetPart(scope, "animation"), true)}>
                    Reset animation
                </Button>
            </div>

            <div className="ss-btnrow">
                <ConfirmButton
                    label={scope.kind === "global" ? "Reset global to defaults" : "Reset this server to global"}
                    confirmLabel="Click again to confirm"
                    onConfirm={() => edit("Reset scope", () => resetPart(scope, "scope"), true)}
                />
                <ConfirmButton
                    label="Reset everything"
                    confirmLabel="Wipe all settings?"
                    variant="dangerPrimary"
                    onConfirm={() => {
                        edit("Reset everything", () => resetEverything(), true);
                        setScope({ kind: "global" });
                    }}
                />
            </div>
            <div className="ss-muted ss-danger">
                "Reset everything" also clears every per-server override and saved preset.
            </div>
        </Section>
    );


    /* ------------------------------------------------- window + audio -- */

    const { audio } = config;
    const audioSection = (
        <Section title="Audio reactive">
            <FormSwitch
                title="React to audio"
                description="Drives the glow from a live audio level. The signal is analysed locally and reduced to one number per frame - nothing is recorded or sent anywhere."
                value={audio.enabled}
                onChange={v => edit(v ? "Audio on" : "Audio off", () => patchAudio({ enabled: v }), true)}
                hideBorder
            />

            {audio.enabled && (
                <>
                    <div className="ss-field">
                        <div className="ss-row-label">Source</div>
                        <Select
                            placeholder="Choose an audio source"
                            options={audioSources.map(o => ({ label: o.label, value: o.id }))}
                            maxVisibleItems={6}
                            closeOnSelect
                            select={(v: string) => {
                                const label = audioSources.find(o => o.id === v)?.label ?? "Input";
                                edit("Audio source", () => patchAudio({ source: v, sourceLabel: label }), true);
                            }}
                            isSelected={(v: string) => v === audio.source}
                            serialize={(v: string) => v}
                        />
                        <div className="ss-muted">
                            {audioStatus.state === "running" && "Listening."}
                            {audioStatus.state === "starting" && "Starting..."}
                            {audioStatus.state === "error" && <span className="ss-danger">{audioStatus.message}</span>}
                            {audioStatus.state === "off" && "Not capturing yet."}
                            {" "}Device names only appear after you have allowed microphone access once.
                            Picking system audio opens Discord's own share picker - tick "Share audio" there.
                        </div>
                    </div>

                    <div className="ss-field">
                        <div className="ss-row-label">Frequency range</div>
                        <Chips
                            options={[
                                { id: "bass", label: "Bass" },
                                { id: "mid", label: "Mid" },
                                { id: "treble", label: "Treble" },
                                { id: "full", label: "Everything" }
                            ]}
                            value={audio.band}
                            onChange={v => edit("Audio band", () => patchAudio({ band: v as typeof audio.band }), true)}
                        />
                    </div>

                    <NumRow
                        label="Sensitivity"
                        value={audio.gain} min={0.2} max={4} step={0.1} revision={revision}
                        onChange={v => edit("Audio gain", () => patchAudio({ gain: v }))}
                        render={v => `${v.toFixed(1)}x`}
                    />
                    <NumRow
                        label="Smoothing" sub="Higher is calmer, lower snaps to the beat"
                        value={audio.smoothing} min={0} max={0.95} step={0.05} revision={revision}
                        onChange={v => edit("Audio smoothing", () => patchAudio({ smoothing: v }))}
                        render={v => `${Math.round(v * 100)}%`}
                    />
                    <NumRow
                        label="Brightness punch" sub="How much the level lifts the glow"
                        value={audio.amount} min={0} max={3} step={0.1} revision={revision}
                        onChange={v => edit("Audio amount", () => patchAudio({ amount: v }))}
                        render={v => `${v.toFixed(1)}x`}
                    />
                    <NumRow
                        label="Size punch" sub="Extra px the glow expands on a peak"
                        value={audio.spread} min={0} max={60} step={2} revision={revision}
                        onChange={v => edit("Audio spread", () => patchAudio({ spread: v }))}
                        render={v => `${Math.round(v)}px`}
                    />

                    <FormSwitch
                        title="Drive the server icons"
                        value={audio.affectIcons}
                        onChange={v => edit("Audio icons", () => patchAudio({ affectIcons: v }), true)}
                        hideBorder
                    />
                    <div className="ss-muted">
                        The glow is drawn outside the rail, so the size punch is free to
                        spill across the rest of the client.
                    </div>
                </>
            )}
        </Section>
    );

    /* ---------------------------------------------------------------- render -- */

    return (
        <div className="ss-panel">
            <div className="ss-panel-heading">
                <h2>Make your server list yours</h2>
                <p>Choose a shape, tune its light, and see changes instantly.</p>
            </div>
            <div className="ss-preview-dock">
            <PreviewStrip config={current} sample={sample} selected={previewSelected} />

            <div className="ss-row">
                <Chips
                    options={SAMPLES.map(s => ({ id: s.id, label: s.label }))}
                    value={sample}
                    onChange={v => setSample(v as SampleId)}
                />
                <Button
                    size="small"
                    variant={previewSelected ? "primary" : "secondary"}
                    onClick={() => setPreviewSelected(s => !s)}
                >
                    {previewSelected ? "Selected state: on" : "Selected state: off"}
                </Button>
            </div>

            </div>

            <div className="ss-scope-bar">
                <div>
                    <div className="ss-row-label">Editing: {scopeLabel}</div>
                    {scope.kind === "server" && (
                        <div className="ss-row-sub">Overrides the global defaults for this server only.</div>
                    )}
                </div>
                <div className="ss-btnrow">
                    <Button
                        size="small"
                        variant="secondary"
                        disabled={!canUndo()}
                        onClick={doUndo}
                    >
                        Undo{undoLabel() ? `: ${undoLabel()}` : ""}
                    </Button>
                    <Button
                        size="small"
                        variant="secondary"
                        disabled={!canRedo()}
                        onClick={doRedo}
                    >
                        Redo{redoLabel() ? `: ${redoLabel()}` : ""}
                    </Button>
                    {scope.kind === "server" && (
                        <Button size="small" variant="secondary" onClick={() => setScope({ kind: "global" })}>
                            Back to global
                        </Button>
                    )}
                </div>
            </div>

            <div className="ss-tabs">
                {TABS.map(t => (
                    <button
                        key={t.id}
                        className="ss-tab"
                        data-active={String(tab === t.id)}
                        aria-pressed={tab === t.id}
                        onClick={() => setTab(t.id)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {tab === "appearance" && (
                <>
                    {shapeSection}
                    {glowSection}
                </>
            )}

            {tab === "custom" && (
                <>
                    {gradientSection}
                    {animationSection}
                </>
            )}

            {tab === "effects" && (
                <>
                    {audioSection}
                </>
            )}

            {tab === "profiles" && profileSection}
            {tab === "presets" && <>{presetsSection}{resetSection}</>}
            {tab === "servers" && (
                <>
                    {serversSection}
                    <details className="ss-advanced">
                        <summary>Troubleshooting</summary>
                        {diagnosticsSection}
                    </details>
                </>
            )}
        </div>
    );
}

/**
 * Hands the renderer to the settings definition. Doing it here rather than
 * importing this file from pluginSettings keeps the module graph acyclic.
 */
export function registerSettingsPanel() {
    registerPanel(() => <SettingsPanel />);
}

// re-exported so the context menu can reuse the same write path
export { writeScope };
