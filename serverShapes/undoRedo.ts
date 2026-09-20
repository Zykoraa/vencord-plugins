/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { EditScope, getConfig, setConfig } from "./store";
import { PluginConfig } from "./types";

interface Snapshot {
    config: PluginConfig;
    /** which scope was being edited when this state was produced */
    scope: EditScope;
    label: string;
}

const LIMIT = 100;

let past: Snapshot[] = [];
let future: Snapshot[] = [];
let present: Snapshot | null = null;

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeHistory(fn: Listener) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function notify() {
    for (const fn of [...listeners]) {
        try {
            fn();
        } catch (err) {
            console.error("[ServerShapes] history listener failed", err);
        }
    }
}

function snap(scope: EditScope, label: string): Snapshot {
    return { config: JSON.parse(JSON.stringify(getConfig())), scope, label };
}

/** Seeds the baseline. Called when the settings panel mounts. */
export function initHistory(scope: EditScope) {
    if (present) return;
    present = snap(scope, "Initial");
    past = [];
    future = [];
    notify();
}

/**
 * Records the state *after* an edit. Callers mutate the store first and then
 * commit, so `present` always mirrors what is actually persisted.
 */
export function commit(scope: EditScope, label: string) {
    const next = snap(scope, label);

    if (present) {
        // skip no-op edits so the stack doesn't fill with identical entries
        if (JSON.stringify(present.config) === JSON.stringify(next.config)) return;
        past.push(present);
        if (past.length > LIMIT) past.shift();
    }

    present = next;
    future = [];
    notify();
}

export function canUndo() {
    return past.length > 0;
}

export function canRedo() {
    return future.length > 0;
}

export function undoLabel() {
    return past.length ? present?.label ?? null : null;
}

export function redoLabel() {
    return future[0]?.label ?? null;
}

/** Returns the scope that was active for the restored state, so the panel can follow it. */
export function undo(): EditScope | null {
    if (!past.length || !present) return null;

    future.unshift(present);
    const restored = past.pop()!;
    present = restored;

    setConfig(restored.config);
    notify();
    return restored.scope;
}

export function redo(): EditScope | null {
    if (!future.length || !present) return null;

    past.push(present);
    const restored = future.shift()!;
    present = restored;

    setConfig(restored.config);
    notify();
    return restored.scope;
}

/** Called on plugin stop so a re-enable doesn't inherit a stale stack. */
export function resetHistory() {
    past = [];
    future = [];
    present = null;
    notify();
}
