/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { EveampClient } from "./eveampClient";

const eveamp = new EveampClient();

/** eveamp's runtime snapshot, or null when eveamp is not running. */
export async function eveampState(_: any): Promise<any | null> {
    const res = await eveamp.call("state.get", 1000);
    return res?.ok ? res.snapshot ?? null : null;
}

export function eveampDisconnect(_: any) {
    eveamp.close();
}
