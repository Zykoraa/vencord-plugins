/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";

import { logger } from "./connection";

const POSITION_KEY = "VoiceQualityHUD_position";
const COLLAPSED_KEY = "VoiceQualityHUD_collapsed";

export interface Position {
    x: number;
    y: number;
}

const subscribers = new Set<() => void>();
let dismissed = false;

function emit() {
    subscribers.forEach(fn => fn());
}

export function subscribe(fn: () => void) {
    subscribers.add(fn);
    return () => void subscribers.delete(fn);
}

/** The toolbox toggle - hides the HUD until the next call, or brings it back. */
export function toggleDismissed() {
    dismissed = !dismissed;
    emit();
    return dismissed;
}

export function setDismissed(value: boolean) {
    if (dismissed === value) return;
    dismissed = value;
    emit();
}

export function isDismissed() {
    return dismissed;
}

export async function loadPosition(): Promise<Position | null> {
    try {
        return (await DataStore.get<Position>(POSITION_KEY)) ?? null;
    } catch (err) {
        logger.error("Failed to load the saved position", err);
        return null;
    }
}

export function savePosition(position: Position) {
    DataStore.set(POSITION_KEY, position).catch(err => logger.error("Failed to save the position", err));
}

export async function loadCollapsed(): Promise<boolean> {
    try {
        return (await DataStore.get<boolean>(COLLAPSED_KEY)) ?? false;
    } catch {
        return false;
    }
}

export function saveCollapsed(collapsed: boolean) {
    DataStore.set(COLLAPSED_KEY, collapsed).catch(err => logger.error("Failed to save the collapsed state", err));
}
