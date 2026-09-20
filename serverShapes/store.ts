/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { settings } from "./pluginSettings";
import { findPreset } from "./presets";
import {
    AnimationConfig,
    AudioConfig,
    CONFIG_VERSION,
    defaultAnimation,
    defaultAudio,
    defaultConfig,
    defaultGlow,
    defaultProfile,
    defaultScope,
    GlowConfig,
    PluginConfig,
    Preset,
    ScopeConfig,
    ServerOverride,
    ShapeId
} from "./types";

type Listener = (config: PluginConfig) => void;

const listeners = new Set<Listener>();

export function subscribe(fn: Listener) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function notify(config: PluginConfig) {
    for (const fn of [...listeners]) {
        try {
            fn(config);
        } catch (err) {
            console.error("[ServerShapes] listener failed", err);
        }
    }
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

/**
 * Stored config may predate a field (or be hand-edited). Folding it over the
 * defaults means a missing key is a default rather than an `undefined` that
 * would surface as a broken CSS variable.
 */
function normalize(raw: any): PluginConfig {
    const base = defaultConfig();
    if (!raw || typeof raw !== "object") return base;

    const glowOf = (g: any): GlowConfig => ({ ...defaultGlow(), ...(g ?? {}) });
    const animOf = (a: any): AnimationConfig => ({ ...defaultAnimation(), ...(a ?? {}) });

    const scopeOf = (s: any): ScopeConfig => {
        const d = defaultScope();
        return {
            shape: s?.shape ?? d.shape,
            glow: glowOf(s?.glow),
            animation: animOf(s?.animation)
        };
    };

    const perServer: Record<string, ServerOverride> = {};
    for (const [id, ov] of Object.entries(raw.perServer ?? {})) {
        if (!ov || typeof ov !== "object") continue;
        const o = ov as ServerOverride;
        const next: ServerOverride = {};
        if (o.shape) next.shape = o.shape;
        if (o.glow && Object.keys(o.glow).length) next.glow = { ...o.glow };
        if (o.animation && Object.keys(o.animation).length) next.animation = { ...o.animation };
        if (Object.keys(next).length) perServer[id] = next;
    }

    const presets: Preset[] = (Array.isArray(raw.presets) ? raw.presets : [])
        .filter((p: any) => p && typeof p.id === "string" && typeof p.name === "string")
        .map((p: any) => ({ id: p.id, name: p.name, config: scopeOf(p.config) }));

    return {
        version: CONFIG_VERSION,
        global: scopeOf(raw.global),
        perServer,
        presets,
        profile: { ...defaultProfile(), ...(raw.profile ?? {}), glow: glowOf(raw.profile?.glow) },
        applyToFolders: raw.applyToFolders ?? base.applyToFolders,
        includeHome: raw.includeHome ?? base.includeHome,
        railExtraWidth: raw.railExtraWidth ?? base.railExtraWidth,
        spill: raw.spill ?? base.spill,
        audio: { ...defaultAudio(), ...(raw.audio ?? {}) }
    };
}

export function getConfig(): PluginConfig {
    return normalize(settings.store.config);
}

/**
 * Always writes a fresh object. Vencord's settings proxy persists on
 * assignment, so replacing the whole blob is what guarantees a write actually
 * hits disk rather than silently mutating in place.
 */
export function setConfig(next: PluginConfig, opts: { silent?: boolean; } = {}) {
    const normalized = normalize(next);
    settings.store.config = clone(normalized) as any;
    if (!opts.silent) notify(normalized);
    return normalized;
}

export function updateConfig(
    mutate: (draft: PluginConfig) => void,
    opts: { silent?: boolean; } = {}
) {
    const draft = clone(getConfig());
    mutate(draft);
    return setConfig(draft, opts);
}

/* ---------------------------------------------------------------- scopes -- */

/**
 * The merge that makes per-server overrides work: an absent override key falls
 * through to global, so editing a global value still moves every server that
 * hasn't explicitly pinned that one field.
 */
export function resolveScope(guildId?: string | null): ScopeConfig {
    const config = getConfig();
    if (!guildId) return config.global;

    const override = config.perServer[guildId];
    if (!override) return config.global;

    return {
        shape: override.shape ?? config.global.shape,
        glow: { ...config.global.glow, ...(override.glow ?? {}) },
        animation: { ...config.global.animation, ...(override.animation ?? {}) }
    };
}

export function hasOverride(guildId: string) {
    return Boolean(getConfig().perServer[guildId]);
}

/* --------------------------------------------------------------- editing -- */

export type EditScope = { kind: "global"; } | { kind: "server"; guildId: string; };

export function readScope(scope: EditScope): ScopeConfig {
    return scope.kind === "global" ? getConfig().global : resolveScope(scope.guildId);
}

/** Writes a whole scope. For a server this records every field as an override. */
export function writeScope(scope: EditScope, value: ScopeConfig) {
    return updateConfig(draft => {
        if (scope.kind === "global") {
            draft.global = clone(value);
        } else {
            draft.perServer[scope.guildId] = {
                shape: value.shape,
                glow: clone(value.glow),
                animation: clone(value.animation)
            };
        }
    });
}

export function setShape(scope: EditScope, shape: ShapeId) {
    return updateConfig(draft => {
        if (scope.kind === "global") {
            draft.global.shape = shape;
        } else {
            const ov = (draft.perServer[scope.guildId] ??= {});
            ov.shape = shape;
        }
    });
}

export function patchGlow(scope: EditScope, patch: Partial<GlowConfig>) {
    return updateConfig(draft => {
        if (scope.kind === "global") {
            Object.assign(draft.global.glow, patch);
        } else {
            const ov = (draft.perServer[scope.guildId] ??= {});
            ov.glow = { ...(ov.glow ?? {}), ...patch };
        }
    });
}

export function patchAnimation(scope: EditScope, patch: Partial<AnimationConfig>) {
    return updateConfig(draft => {
        if (scope.kind === "global") {
            Object.assign(draft.global.animation, patch);
        } else {
            const ov = (draft.perServer[scope.guildId] ??= {});
            ov.animation = { ...(ov.animation ?? {}), ...patch };
        }
    });
}

/* --------------------------------------------------------------- resets --- */

export type ResetKind = "shape" | "glow" | "gradient" | "animation" | "scope";

export function resetPart(scope: EditScope, kind: ResetKind) {
    return updateConfig(draft => {
        if (scope.kind === "global") {
            const d = defaultScope();
            switch (kind) {
                case "shape": draft.global.shape = d.shape; break;
                case "glow": draft.global.glow = d.glow; break;
                case "gradient":
                    draft.global.glow.paintMode = d.glow.paintMode;
                    draft.global.glow.gradientStops = [...d.glow.gradientStops];
                    draft.global.glow.gradientAngle = d.glow.gradientAngle;
                    break;
                case "animation": draft.global.animation = d.animation; break;
                case "scope": draft.global = d; break;
            }
            return;
        }

        // For a server, resetting means dropping the override so global shows
        // through again - not writing today's global value into the override.
        const ov = draft.perServer[scope.guildId];
        if (!ov) return;

        switch (kind) {
            case "shape": delete ov.shape; break;
            case "glow": delete ov.glow; break;
            case "gradient":
                if (ov.glow) {
                    delete ov.glow.paintMode;
                    delete ov.glow.gradientStops;
                    delete ov.glow.gradientAngle;
                    if (!Object.keys(ov.glow).length) delete ov.glow;
                }
                break;
            case "animation": delete ov.animation; break;
            case "scope": delete draft.perServer[scope.guildId]; return;
        }

        if (!Object.keys(ov).length) delete draft.perServer[scope.guildId];
    });
}

export function resetServerToGlobal(guildId: string) {
    return updateConfig(draft => {
        delete draft.perServer[guildId];
    });
}

export function resetEverything() {
    return setConfig(defaultConfig());
}

/* -------------------------------------------------------------- presets --- */

export function savePreset(name: string, config: ScopeConfig): Preset {
    const preset: Preset = {
        id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        name: name.trim() || "Untitled",
        config: clone(config)
    };
    updateConfig(draft => {
        draft.presets.push(preset);
    });
    return preset;
}

export function deletePreset(id: string) {
    return updateConfig(draft => {
        draft.presets = draft.presets.filter(p => p.id !== id);
    });
}

export function renamePreset(id: string, name: string) {
    return updateConfig(draft => {
        const p = draft.presets.find(p => p.id === id);
        if (p) p.name = name.trim() || p.name;
    });
}

export function applyPreset(scope: EditScope, presetId: string) {
    const preset = findPreset(presetId, getConfig().presets);
    if (!preset) return null;
    return writeScope(scope, preset.config);
}

/* -------------------------------------------------------------- profile --- */

export function patchProfile(patch: Partial<PluginConfig["profile"]>) {
    return updateConfig(draft => {
        Object.assign(draft.profile, patch);
    });
}

export function patchProfileGlow(patch: Partial<GlowConfig>) {
    return updateConfig(draft => {
        Object.assign(draft.profile.glow, patch);
    });
}

/** The glow actually used for avatars, honouring "inherit from servers". */
export function resolveProfileScope(): ScopeConfig {
    const config = getConfig();
    const { profile } = config;
    return {
        shape: profile.matchShape ? profile.shape : "default",
        glow: profile.useOwnGlow ? profile.glow : config.global.glow,
        animation: config.global.animation
    };
}

/* ----------------------------------------------------------------- audio -- */

export function patchAudio(patch: Partial<AudioConfig>) {
    return updateConfig(draft => {
        Object.assign(draft.audio, patch);
    });
}

/* --------------------------------------------------------------- global --- */

export function patchRoot(
    patch: Partial<Pick<PluginConfig, "applyToFolders" | "includeHome" | "railExtraWidth" | "spill">>
) {
    return updateConfig(draft => {
        Object.assign(draft, patch);
    });
}
