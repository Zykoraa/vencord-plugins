/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { AudioBand, AudioConfig } from "./types";

/*
 * Drives the glow from live audio.
 *
 * Privacy: the captured stream is analysed in-process and reduced to a single
 * 0..1 number per frame. Nothing is recorded, buffered past one FFT window, or
 * sent anywhere - the only output of this module is one CSS custom property.
 * Capture is started only when the user turns the feature on, and the stream is
 * stopped the moment it is turned off or the plugin unloads.
 *
 * That single variable is written to the document root, so one write per frame
 * updates every glow on screen no matter how many servers are visible.
 */

const LEVEL_VAR = "--ss-audio";

/**
 * Called once per analysed frame.
 *
 * Opacity follows the level through a CSS variable on its own, but the size
 * punch is plain-pixel geometry written by the engine, so something has to
 * recompute it each frame. Registered rather than imported to keep audio.ts
 * free of any dependency on the DOM engine.
 */
let onFrame: (() => void) | null = null;

export function setAudioFrameHook(fn: (() => void) | null) {
    onFrame = fn;
}

let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let stream: MediaStream | null = null;
let raf = 0;
let bins: Uint8Array | null = null;

let smoothed = 0;
let active = false;
let currentKey = "";

type StatusListener = (status: AudioStatus) => void;

export interface AudioStatus {
    state: "off" | "starting" | "running" | "error";
    message?: string;
}

let status: AudioStatus = { state: "off" };
const listeners = new Set<StatusListener>();

export function subscribeAudio(fn: StatusListener) {
    listeners.add(fn);
    fn(status);
    return () => {
        listeners.delete(fn);
    };
}

function setStatus(next: AudioStatus) {
    status = next;
    for (const fn of [...listeners]) {
        try {
            fn(next);
        } catch {
            /* a listener failing must not take the audio engine down */
        }
    }
}

export function getAudioStatus() {
    return status;
}

/** Frequency range each band covers, in Hz. */
const BANDS: Record<AudioBand, [number, number]> = {
    bass: [20, 250],
    mid: [250, 2000],
    treble: [2000, 12000],
    full: [20, 16000]
};

function binRange(band: AudioBand, sampleRate: number, binCount: number) {
    const [lo, hi] = BANDS[band];
    const nyquist = sampleRate / 2;
    const first = Math.max(0, Math.floor((lo / nyquist) * binCount));
    const last = Math.min(binCount - 1, Math.ceil((hi / nyquist) * binCount));
    return [first, Math.max(first + 1, last)] as const;
}

/** Everything that changes the capture itself, as opposed to the maths. */
function captureKey(config: AudioConfig) {
    return `${config.source}`;
}

async function openStream(config: AudioConfig): Promise<MediaStream> {
    if (config.source === "display") {
        // Chromium only offers tab/system audio alongside a video track, even
        // though we discard the video immediately.
        const media = await navigator.mediaDevices.getDisplayMedia({
            audio: true,
            video: true
        });
        for (const track of media.getVideoTracks()) track.stop();
        if (!media.getAudioTracks().length) {
            media.getTracks().forEach(t => t.stop());
            throw new Error("That source was shared without audio. Pick a tab or screen and tick \"Share audio\".");
        }
        return media;
    }

    return navigator.mediaDevices.getUserMedia({
        audio: config.source
            ? { deviceId: { exact: config.source }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
            : { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
}

function tick(config: AudioConfig) {
    if (!active || !analyser || !bins) return;

    analyser.getByteFrequencyData(bins as Uint8Array<ArrayBuffer>);

    const [first, last] = binRange(config.band, ctx!.sampleRate, bins.length);
    let sum = 0;
    for (let i = first; i <= last; i++) sum += bins[i];
    const mean = sum / (last - first + 1) / 255;

    // Perceptual curve: a square root opens up the quiet end, which is where
    // most music actually sits once it has been through a limiter.
    const shaped = Math.min(1, Math.sqrt(mean) * config.gain);

    // One-pole smoothing, framed so "smoothing" reads as how sluggish it feels.
    const k = Math.min(0.95, Math.max(0, config.smoothing));
    smoothed = smoothed * k + shaped * (1 - k);

    // Emitted as finished values - a plain multiplier and a plain length - so
    // the stylesheet never has to do arithmetic on a custom property.
    const root = document.documentElement.style;
    root.setProperty(LEVEL_VAR, smoothed.toFixed(4));
    root.setProperty("--ss-audio-mul", (1 + (config.affectIcons ? smoothed * config.amount : 0)).toFixed(4));
    root.setProperty("--ss-audio-px", `${(config.affectIcons ? smoothed * config.spread : 0).toFixed(1)}px`);
    onFrame?.();

    raf = requestAnimationFrame(() => tick(config));
}

export async function startAudio(config: AudioConfig) {
    const key = captureKey(config);

    // Re-tuning gain or band must not tear down a working capture.
    if (active && key === currentKey) return;
    if (active) stopAudio({ keepStatus: true });

    setStatus({ state: "starting" });

    try {
        stream = await openStream(config);
        ctx = new AudioContext();
        // Some clients hand back a suspended context until it is nudged.
        if (ctx.state === "suspended") await ctx.resume();

        analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        // our own smoothing is frame-rate based and easier to reason about
        analyser.smoothingTimeConstant = 0;

        source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);
        // deliberately not connected to the destination: this must never be audible

        bins = new Uint8Array(analyser.frequencyBinCount);
        active = true;
        currentKey = key;

        // If the user revokes the device or stops sharing, wind down cleanly.
        for (const track of stream.getAudioTracks()) {
            track.addEventListener("ended", () => stopAudio());
        }

        setStatus({ state: "running" });
        tick(config);
    } catch (err: any) {
        stopAudio({ keepStatus: true });
        setStatus({
            state: "error",
            message: err?.name === "NotAllowedError"
                ? "Permission denied. Discord must be allowed to use that input."
                : err?.message ?? String(err)
        });
    }
}

export function stopAudio(opts: { keepStatus?: boolean; } = {}) {
    active = false;
    currentKey = "";
    smoothed = 0;

    if (raf) cancelAnimationFrame(raf);
    raf = 0;

    try {
        source?.disconnect();
        analyser?.disconnect();
    } catch {
        /* already torn down */
    }

    stream?.getTracks().forEach(t => t.stop());
    ctx?.close().catch(() => { /* closing a closed context is fine */ });

    source = null;
    analyser = null;
    stream = null;
    ctx = null;
    bins = null;

    document.documentElement.style.removeProperty(LEVEL_VAR);
    document.documentElement.style.removeProperty("--ss-audio-mul");
    document.documentElement.style.removeProperty("--ss-audio-px");
    if (document.documentElement.getAttribute("style") === "") {
        document.documentElement.removeAttribute("style");
    }

    if (!opts.keepStatus) setStatus({ state: "off" });
}

/** Restarts only if the capture source changed; otherwise re-tunes in place. */
export function syncAudio(config: AudioConfig) {
    if (!config.enabled) {
        if (active || status.state !== "off") stopAudio();
        return;
    }

    if (active && captureKey(config) === currentKey) {
        // gain/band/smoothing are read fresh each frame, but the running loop
        // closed over the old object, so restart the loop with the new one
        if (raf) cancelAnimationFrame(raf);
        tick(config);
        return;
    }

    void startAudio(config);
}

export interface AudioSourceOption {
    id: string;
    label: string;
}

/**
 * Lists selectable inputs. Device labels are hidden by the browser until the
 * user has granted microphone access at least once, so before that they appear
 * as numbered inputs.
 */
export async function listAudioSources(): Promise<AudioSourceOption[]> {
    const options: AudioSourceOption[] = [
        { id: "", label: "Default input" },
        { id: "display", label: "System / window audio (pick a source)" }
    ];

    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        let n = 0;
        for (const d of devices) {
            if (d.kind !== "audioinput" || !d.deviceId || d.deviceId === "default") continue;
            n++;
            options.push({ id: d.deviceId, label: d.label || `Input ${n}` });
        }
    } catch {
        /* enumeration blocked: the two defaults above still work */
    }

    return options;
}
