/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Turns eveamp's spectrum into the levels the visualizers already draw.
// eveamp sends 10 octave bands, 20 Hz to 20 kHz (band 0 is 20-40 Hz, band 9 is
// 10-20 kHz), as linear magnitudes whose scale depends on the music and on
// eveamp's volume. A per-band automatic gain brings each band to 0..1, so a
// quiet master or a dark mix still moves every bar. Pure functions, so tests
// run without Discord.

export const EVEAMP_BANDS = 10;

// How fast a band's reference peak falls back after a loud moment: it halves
// every PEAK_HALF_LIFE seconds.
const PEAK_HALF_LIFE = 3;
// A band never gains more than 1/PEAK_FLOOR, so near-silence stays near zero
// instead of being amplified into noise.
const PEAK_FLOOR = 0.04;
// Below this summed magnitude a frame counts as silence (paused, stopped).
export const SILENCE = 1e-3;

/** Normalizes raw bands into out (0..1), updating the per-band peaks. */
export function normalizeBands(raw: ArrayLike<number>, peaks: Float32Array, dt: number, out: Float32Array) {
    const fall = Math.pow(0.5, dt / PEAK_HALF_LIFE);
    for (let b = 0; b < EVEAMP_BANDS; b++) {
        const v = Number.isFinite(raw[b]) && raw[b] > 0 ? raw[b] : 0;
        const peak = Math.max(v, peaks[b] * fall);
        peaks[b] = peak;
        out[b] = Math.min(1, v / Math.max(peak, PEAK_FLOOR));
    }
}

/** Reports whether a frame carries sound. */
export function isAudible(raw: ArrayLike<number>): boolean {
    let sum = 0;
    for (let b = 0; b < EVEAMP_BANDS; b++) {
        const v = raw[b];
        if (Number.isFinite(v) && v > 0) sum += v;
    }
    return sum > SILENCE;
}

function avg(n: ArrayLike<number>, from: number, to: number) {
    let s = 0;
    for (let b = from; b <= to; b++) s += n[b];
    return s / (to - from + 1);
}

/**
 * The bass/mid/treble/level the visualizers use, from normalized bands:
 * bass is 20-160 Hz, mid 160 Hz-2.5 kHz, treble 2.5-20 kHz.
 */
export function levelsFromBands(n: ArrayLike<number>) {
    const bass = avg(n, 0, 2);
    const mid = avg(n, 3, 6);
    const treble = avg(n, 7, 9);
    return { bass, mid, treble, level: bass * 0.5 + mid * 0.3 + treble * 0.2 };
}

/** Spreads the bands over out.length bars (0..255) by linear interpolation. */
export function barsFromBands(n: ArrayLike<number>, out: Uint8Array) {
    const last = out.length - 1;
    for (let i = 0; i <= last; i++) {
        const x = last === 0 ? 0 : (i * (EVEAMP_BANDS - 1)) / last;
        const lo = Math.floor(x);
        const hi = Math.min(EVEAMP_BANDS - 1, lo + 1);
        const v = n[lo] + (n[hi] - n[lo]) * (x - lo);
        out[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
}
