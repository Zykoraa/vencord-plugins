/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Derives a glow palette from a server's own icon, so every server lights up in
 * its own colours with nothing to configure.
 *
 * Sampling happens once per icon URL and is cached for the session. A failure
 * (a tainted canvas, an icon that never loads, a server with no icon at all) is
 * not an error condition - it just means that server keeps the configured
 * colour, so the feature degrades to exactly the previous behaviour.
 */

/** url -> palette, or null while a sample is still in flight */
const cache = new Map<string, string[]>();
const inFlight = new Map<string, Promise<string[]>>();

const SAMPLE_SIZE = 24;
const LOAD_TIMEOUT = 6000;

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;

    if (max === min) return [0, 0, l];

    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    let h: number;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;

    return [h * 360, s, l];
}

function hslCss(h: number, s: number, l: number) {
    return `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}

/**
 * Picks the two most prominent vibrant hues.
 *
 * Weighting by saturation rather than raw pixel count matters: most server
 * icons are mostly flat background, and an unweighted average of those pixels
 * lands on a muddy grey that makes a poor light source.
 */
export function extractPalette(data: Uint8ClampedArray): string[] {
    const BINS = 12;
    const weight = new Float64Array(BINS);
    const hueSum = new Float64Array(BINS);
    const satSum = new Float64Array(BINS);
    const lumSum = new Float64Array(BINS);

    let fallbackR = 0, fallbackG = 0, fallbackB = 0, fallbackN = 0;

    for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a < 128) continue;

        const r = data[i], g = data[i + 1], b = data[i + 2];
        fallbackR += r; fallbackG += g; fallbackB += b; fallbackN++;

        const [h, s, l] = rgbToHsl(r, g, b);
        // ignore near-black, near-white and near-grey: they carry no hue
        if (s < 0.18 || l < 0.12 || l > 0.93) continue;

        const bin = Math.min(BINS - 1, Math.floor((h / 360) * BINS));
        const w = s * (1 - Math.abs(l - 0.5));
        weight[bin] += w;
        hueSum[bin] += h * w;
        satSum[bin] += s * w;
        lumSum[bin] += l * w;
    }

    const ranked = Array.from({ length: BINS }, (_, i) => i)
        .filter(i => weight[i] > 0)
        .sort((a, b) => weight[b] - weight[a]);

    if (!ranked.length) {
        // A greyscale or monochrome icon: build a tasteful two-tone from its
        // average brightness rather than giving up.
        if (!fallbackN) return [];
        const [h, s] = rgbToHsl(fallbackR / fallbackN, fallbackG / fallbackN, fallbackB / fallbackN);
        return [hslCss(h, Math.max(s, 0.15), 0.72), hslCss(h, Math.max(s, 0.15), 0.45)];
    }

    const colorOf = (bin: number) => {
        const w = weight[bin];
        const h = hueSum[bin] / w;
        // push saturation and lightness up: a light source should read brighter
        // than the artwork it was taken from
        const s = Math.min(1, (satSum[bin] / w) * 1.25 + 0.1);
        const l = Math.min(0.72, Math.max(0.45, (lumSum[bin] / w) * 1.1));
        return hslCss(h, s, l);
    };

    const primary = colorOf(ranked[0]);

    // A second hue only helps if it is actually a different colour; otherwise
    // shade the primary so the sweep still has somewhere to travel.
    if (ranked.length > 1 && weight[ranked[1]] > weight[ranked[0]] * 0.25) {
        return [primary, colorOf(ranked[1])];
    }

    const w = weight[ranked[0]];
    const h = hueSum[ranked[0]] / w;
    const s = Math.min(1, (satSum[ranked[0]] / w) * 1.25 + 0.1);
    return [primary, hslCss((h + 24) % 360, s, 0.52)];
}

function loadAndSample(url: string): Promise<string[]> {
    return new Promise(resolve => {
        const img = new Image();
        // required for a readable canvas; Discord's CDN serves images CORS-enabled
        img.crossOrigin = "anonymous";

        let settled = false;
        const finish = (palette: string[]) => {
            if (settled) return;
            settled = true;
            resolve(palette);
        };

        const timer = setTimeout(() => finish([]), LOAD_TIMEOUT);

        img.onload = () => {
            clearTimeout(timer);
            try {
                const canvas = document.createElement("canvas");
                canvas.width = canvas.height = SAMPLE_SIZE;
                const ctx = canvas.getContext("2d", { willReadFrequently: true });
                if (!ctx) return finish([]);

                ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
                finish(extractPalette(ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data));
            } catch {
                // tainted canvas: fall back to the configured colour
                finish([]);
            }
        };

        img.onerror = () => {
            clearTimeout(timer);
            finish([]);
        };

        img.src = url;
    });
}

/** Cached palette for an icon URL, or null if it hasn't been sampled yet. */
export function getPalette(url: string): string[] | null {
    return cache.get(url) ?? null;
}

/**
 * Requests a palette. `onReady` fires only when a sample completes for the
 * first time, which is the signal to re-apply that one element.
 */
export function requestPalette(url: string, onReady: () => void) {
    if (cache.has(url) || inFlight.has(url)) return;

    const task = loadAndSample(url).then(palette => {
        cache.set(url, palette);
        inFlight.delete(url);
        onReady();
        return palette;
    });

    inFlight.set(url, task);
}

/**
 * Normalises a Discord CDN icon URL to a small, cacheable size. Sampling a
 * 24px canvas from a 512px source is wasted bandwidth and decode time.
 */
export function normaliseIconUrl(src: string): string {
    try {
        const url = new URL(src, location.href);
        url.searchParams.set("size", "64");
        return url.toString();
    } catch {
        return src;
    }
}

export function clearPaletteCache() {
    cache.clear();
    inFlight.clear();
}
