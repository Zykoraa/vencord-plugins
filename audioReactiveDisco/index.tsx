/*
 * Vencord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { SettingsStore } from "@api/Settings";
import { PluginNative } from "@utils/types";
import definePlugin from "@utils/types";
import {
    settings,
    ReactiveMode,
    ColorTheme,
    VisualReactionStyle,
    onSettingChange
} from "./settings";
import managedStyle from "./styles.css?managed";

const Native = (VencordNative.pluginHelpers as any)?.AudioReactiveDisco as PluginNative<typeof import("./native")> | undefined;

function log(msg: string) {
    console.log("[AudioReactiveDisco]", msg);
    try {
        void Native?.logDebug?.(msg);
    } catch { }
}

let audioContext: AudioContext | null = null;
let analyserNode: AnalyserNode | null = null;
let mediaStream: MediaStream | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let animationFrameId: number | null = null;
let cleanupSettingsListener: (() => void) | null = null;

let windowAuraElement: HTMLDivElement | null = null;
let ambientAuroraElement: HTMLDivElement | null = null;
let viewportCanvas: HTMLCanvasElement | null = null;
let viewportCtx: CanvasRenderingContext2D | null = null;

let hudContainerElement: HTMLDivElement | null = null;
let hudTitleElement: HTMLDivElement | null = null;
let hudCanvas: HTMLCanvasElement | null = null;
let hudCtx: CanvasRenderingContext2D | null = null;
let hudFpsBadge: HTMLDivElement | null = null;
let hudDeviceBadge: HTMLDivElement | null = null;
let hudStyleBadge: HTMLDivElement | null = null;
let hudModeBadge: HTMLDivElement | null = null;

let cachedGrad: CanvasGradient | null = null;
let lastGradPrimary = "";
let lastGradSecondary = "";
let lastGradHeight = 0;

let smoothedBass = 0;
let smoothedMid = 0;
let smoothedTreble = 0;
let smoothedLevel = 0;
let rainbowHue = 180;

let lastFrameTime = performance.now();
let lastFPSCalcTime = performance.now();
let frameCount = 0;
let measuredFPS = 240;

// Pre-allocated typed arrays (ZERO garbage collection in hot path)
// fftSize 256 gives 128 frequency bins (0 to 127) for high-precision audio analysis
const rawFreqBuffer = new Uint8Array(128);
const rawWaveBuffer = new Uint8Array(128);
const barDataBuffer = new Uint8Array(16);
const peakHeights = new Float32Array(16);
const viewportPeakHeights = new Float32Array(32);
const waveXPoints = new Float32Array(160);
const waveYPoints = new Float32Array(160);
const waveY2Points = new Float32Array(160);
let viewportWavePhase = 0;
let viewportWavePhase2 = 0;
let hudWavePhase = 0;

// 16 EQ bands mapped from 128 FFT bins with logarithmic distribution
const EQ_BAND_RANGES: readonly [number, number][] = [
    [0, 1],   [2, 3],   [4, 5],   [6, 7],
    [8, 10],  [11, 14], [15, 19], [20, 25],
    [26, 32], [33, 40], [41, 49], [50, 60],
    [61, 72], [73, 86], [87, 103], [104, 124]
];

interface AudioDeviceOption {
    id: string;
    label: string;
    shortLabel: string;
    isBetterBanana: boolean;
    priority: number;
}

let availableDevices: AudioDeviceOption[] = [];
let activeDeviceLabel = "🍌 Spotify (C1)";
let currentDeviceIndex = 0;

function ensureAudioContext(): AudioContext | null {
    if (!audioContext || audioContext.state === "closed") {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return null;
        audioContext = new AudioCtx();
        log(`AudioContext created, state: ${audioContext.state}`);
    }
    if (audioContext.state === "suspended") {
        void audioContext.resume().then(() => log(`AudioContext resumed, state: ${audioContext?.state}`));
    }
    return audioContext;
}

function onPointerDown() {
    if (audioContext && audioContext.state === "suspended") {
        void audioContext.resume().then(() => log(`AudioContext resumed on pointerdown, state: ${audioContext?.state}`));
    }
}

function onDeviceChange() {
    log("Audio hardware devicechange event detected, refreshing sources...");
    void discoverAudioDevices();
}

async function discoverAudioDevices(): Promise<AudioDeviceOption[]> {
    log("discoverAudioDevices: querying PipeWire sources...");
    try {
        await Native?.ensureBetterBananaSources?.();
    } catch { }

    try {
        let devices = await navigator.mediaDevices.enumerateDevices();
        let inputs = devices.filter(d => d.kind === "audioinput");
        log(`Initial enumerateDevices: found ${inputs.length} inputs (${inputs.map(i => i.label || "<no-label>").join(", ")})`);

        // If ANY input lacks a label, unlock all labels via temporary stream
        if (inputs.length > 0 && inputs.some(d => !d.label || d.label === "Audio Input")) {
            try {
                log("Requesting temporary getUserMedia to unlock hardware device labels...");
                const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                tempStream.getTracks().forEach(t => t.stop());
                devices = await navigator.mediaDevices.enumerateDevices();
                inputs = devices.filter(d => d.kind === "audioinput");
                log(`Refreshed inputs after unlock: ${inputs.map(i => `${i.label} [${i.deviceId.slice(0, 8)}]`).join(", ")}`);
            } catch (err) {
                log(`Warning: Failed to unlock labels: ${err}`);
            }
        }

        const rawList: AudioDeviceOption[] = [];

        for (const input of inputs) {
            // Ignore generic "default" duplicate if specific devices exist
            if (input.deviceId === "default" && inputs.length > 1) {
                continue;
            }

            const rawLabel = input.label || "Audio Input";
            const lower = rawLabel.toLowerCase();

            let shortLabel = rawLabel;
            let isBB = false;
            let priority = 100;

            if (lower.includes("spotify") || lower.includes("cable1") || lower.includes("cable 1") || lower.includes("cable_1")) {
                shortLabel = "🍌 Spotify (C1)";
                isBB = true;
                priority = 1;
            } else if (lower.includes("stream")) {
                shortLabel = "🍌 BB Stream";
                isBB = true;
                priority = 2;
            } else if (lower.includes("vaio")) {
                shortLabel = "🍌 BB VAIO";
                isBB = true;
                priority = 3;
            } else if (lower.includes("aux")) {
                shortLabel = "🍌 BB AUX";
                isBB = true;
                priority = 4;
            } else if (lower.includes("betterbanana") || lower.includes("bb_")) {
                shortLabel = `🍌 ${rawLabel.replace(/BetterBanana_?/i, "").trim() || "BB Bus"}`;
                isBB = true;
                priority = 5;
            } else if (lower.includes("umc202hd") || lower.includes("mic") || lower.includes("microphone")) {
                shortLabel = "🎙️ Mic";
                priority = 10;
            } else {
                shortLabel = rawLabel.length > 14 ? rawLabel.slice(0, 12) + "…" : rawLabel;
                priority = 50;
            }

            rawList.push({
                id: input.deviceId,
                label: rawLabel,
                shortLabel,
                isBetterBanana: isBB,
                priority
            });
        }

        // Deduplicate by shortLabel so cycling through devices is completely distinct and never repeats identical names
        const uniqueMap = new Map<string, AudioDeviceOption>();
        for (const item of rawList) {
            if (!uniqueMap.has(item.shortLabel)) {
                uniqueMap.set(item.shortLabel, item);
            }
        }

        const result = Array.from(uniqueMap.values());
        result.sort((a, b) => a.priority - b.priority);

        availableDevices = result;
        log(`Final availableDevices list (${result.length}): ${result.map(r => r.shortLabel).join(" -> ")}`);
        return result;
    } catch (err) {
        log(`Error enumerating devices: ${err}`);
        return [];
    }
}

async function switchAudioDevice(targetDeviceId?: string, shortLabel?: string) {
    log(`switchAudioDevice -> target: "${shortLabel || "auto"}" (id: ${targetDeviceId ? targetDeviceId.slice(0, 8) : "default"})`);
    teardownAudioSource();

    const ctx = ensureAudioContext();
    if (!ctx) {
        log("Error: No AudioContext available");
        return;
    }

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.3;

    if (shortLabel) {
        activeDeviceLabel = shortLabel;
        updateDeviceBadgeLabel();
    }

    const audioConstraints: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
    };

    if (targetDeviceId && targetDeviceId !== "default" && targetDeviceId !== "betterbanana_auto") {
        // Try exact binding first to force Chromium to use this exact source node
        audioConstraints.deviceId = { exact: targetDeviceId };
    }

    try {
        log(`Calling getUserMedia with constraints: ${JSON.stringify(audioConstraints)}`);
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
        const track = mediaStream.getAudioTracks()[0];
        log(`Stream acquired! Active track: "${track?.label}", readyState=${track?.readyState}, muted=${track?.muted}`);

        sourceNode = ctx.createMediaStreamSource(mediaStream);
        analyserNode = analyser;
        sourceNode.connect(analyserNode);
        log("sourceNode connected to analyserNode!");
    } catch (err: any) {
        log(`Targeted getUserMedia with exact deviceId failed (${err.name}: ${err.message}), trying ideal constraint...`);
        try {
            const fallbackConstraints = { ...audioConstraints };
            if (targetDeviceId) fallbackConstraints.deviceId = { ideal: targetDeviceId };
            mediaStream = await navigator.mediaDevices.getUserMedia({ audio: fallbackConstraints });
            sourceNode = ctx.createMediaStreamSource(mediaStream);
            analyserNode = analyser;
            sourceNode.connect(analyserNode);
            log(`Fallback to ideal deviceId succeeded with track: "${mediaStream.getAudioTracks()[0]?.label}"`);
        } catch (innerErr: any) {
            log(`Ideal deviceId failed (${innerErr.name}), trying refreshed device list...`);
            try {
                const refreshed = await discoverAudioDevices();
                const matched = (shortLabel && refreshed.find(d => d.shortLabel === shortLabel)) ||
                                refreshed.find(d => d.isBetterBanana) ||
                                refreshed[0];
                if (matched && matched.id !== targetDeviceId) {
                    log(`Retrying with refreshed device "${matched.label}" [${matched.id.slice(0, 8)}]`);
                    mediaStream = await navigator.mediaDevices.getUserMedia({
                        audio: { ...audioConstraints, deviceId: { exact: matched.id } }
                    });
                    sourceNode = ctx.createMediaStreamSource(mediaStream);
                    analyserNode = analyser;
                    sourceNode.connect(analyserNode);
                    log(`Refreshed device retry succeeded! Track: "${mediaStream.getAudioTracks()[0]?.label}"`);
                    return;
                }
            } catch (refreshErr) {
                log(`Refreshed device retry failed: ${refreshErr}`);
            }

            try {
                mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                sourceNode = ctx.createMediaStreamSource(mediaStream);
                analyserNode = analyser;
                sourceNode.connect(analyserNode);
                log(`Default input fallback succeeded with track: "${mediaStream.getAudioTracks()[0]?.label}"`);
            } catch (lastErr: any) {
                log(`FATAL: All audio stream requests rejected: ${lastErr}`);
            }
        }
    }
}

async function setupAudioSource(mode: ReactiveMode) {
    log(`setupAudioSource called with mode="${mode}"`);
    if (mode === ReactiveMode.SynthwaveBeat) {
        teardownAudioSource();
        return;
    }

    const devList = await discoverAudioDevices();
    const chosenSetting = settings.store.audioDevice;
    log(`Current chosenSetting in store: "${chosenSetting}"`);

    let targetId: string | undefined;
    let chosenLabel = "🍌 Spotify (C1)";

    if (chosenSetting === "betterbanana_auto" || chosenSetting === "spotify") {
        const spotifyDev = devList.find(d => d.shortLabel.includes("Spotify") || d.label.toLowerCase().includes("spotify"));
        const anyBBDev = spotifyDev || devList.find(d => d.isBetterBanana);
        if (anyBBDev) {
            targetId = anyBBDev.id;
            chosenLabel = anyBBDev.shortLabel;
            currentDeviceIndex = devList.indexOf(anyBBDev);
            log(`Found Spotify / BetterBanana source: "${anyBBDev.label}" [${targetId.slice(0, 8)}]`);
        } else {
            log("Warning: No Spotify / BetterBanana source found in devList");
        }
    } else if (chosenSetting) {
        const match = devList.find(d => d.id === chosenSetting || d.shortLabel === chosenSetting || d.label === chosenSetting);
        if (match) {
            targetId = match.id;
            chosenLabel = match.shortLabel;
            currentDeviceIndex = devList.indexOf(match);
            log(`Matched explicit setting: "${match.label}" [${targetId.slice(0, 8)}]`);
        } else {
            // Fallback in case deviceId hash changed between browser sessions
            const spotifyDev = devList.find(d => d.shortLabel.includes("Spotify") || d.label.toLowerCase().includes("spotify"));
            if (spotifyDev) {
                targetId = spotifyDev.id;
                chosenLabel = spotifyDev.shortLabel;
                currentDeviceIndex = devList.indexOf(spotifyDev);
                log(`Fell back stale deviceId to current Spotify source: "${spotifyDev.label}" [${targetId.slice(0, 8)}]`);
            }
        }
    }

    if (currentDeviceIndex < 0 && devList.length > 0) {
        currentDeviceIndex = 0;
        targetId = devList[0].id;
        chosenLabel = devList[0].shortLabel;
    }

    await switchAudioDevice(targetId, chosenLabel);
}

function teardownAudioSource() {
    if (sourceNode) {
        try { sourceNode.disconnect(); } catch { }
        sourceNode = null;
    }
    if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop());
        mediaStream = null;
    }
    analyserNode = null;
}

function updateDeviceBadgeLabel() {
    if (hudDeviceBadge) {
        hudDeviceBadge.textContent = activeDeviceLabel;
    }
}

async function cycleAudioDevice() {
    if (availableDevices.length <= 1) {
        await discoverAudioDevices();
    }
    if (availableDevices.length === 0) return;

    // Force mode to Mic / Live Audio when cycling audio inputs
    if (settings.store.mode !== ReactiveMode.Mic) {
        settings.store.mode = ReactiveMode.Mic;
        if (hudModeBadge) hudModeBadge.textContent = "LIVE";
    }

    let curIdx = availableDevices.findIndex(d => d.id === settings.store.audioDevice || d.shortLabel === activeDeviceLabel);
    if (curIdx === -1) curIdx = currentDeviceIndex;
    currentDeviceIndex = (curIdx + 1) % availableDevices.length;
    const nextDev = availableDevices[currentDeviceIndex];

    settings.store.audioDevice = nextDev.id;
    activeDeviceLabel = nextDev.shortLabel;
    updateDeviceBadgeLabel();

    await switchAudioDevice(nextDev.id, nextDev.shortLabel);
}

function getColors(theme: ColorTheme, bass: number): { primary: string; secondary: string; dim: string } {
    switch (theme) {
        case ColorTheme.Rainbow: {
            rainbowHue = (rainbowHue + (bass * 3.5 + 0.6)) % 360;
            const secHue = (rainbowHue + 75) % 360;
            return {
                primary: `hsl(${rainbowHue.toFixed(0)}, 100%, 65%)`,
                secondary: `hsl(${secHue.toFixed(0)}, 100%, 60%)`,
                dim: `hsla(${rainbowHue.toFixed(0)}, 100%, 65%, ${(0.14 + bass * 0.45).toFixed(2)})`
            };
        }
        case ColorTheme.Cyberpunk:
            return {
                primary: "#00f0ff",
                secondary: "#ff0055",
                dim: `rgba(0, 240, 255, ${(0.14 + bass * 0.45).toFixed(2)})`
            };
        case ColorTheme.Synthwave:
            return {
                primary: "#ff7700",
                secondary: "#a000ff",
                dim: `rgba(160, 0, 255, ${(0.15 + bass * 0.45).toFixed(2)})`
            };
        case ColorTheme.Matrix:
            return {
                primary: "#00ff66",
                secondary: "#88ff00",
                dim: `rgba(0, 255, 102, ${(0.14 + bass * 0.45).toFixed(2)})`
            };
        case ColorTheme.ElectricBlue:
        default:
            return {
                primary: "#0088ff",
                secondary: "#bd00ff",
                dim: `rgba(0, 136, 255, ${(0.15 + bass * 0.45).toFixed(2)})`
            };
    }
}

function computeProceduralBeat(t: number): { bass: number; mid: number; treble: number; level: number } {
    const beatPhase = (t % 0.4615) / 0.4615;
    const barPhase = (t % 1.846) / 1.846;

    const kick = Math.pow(Math.max(0, 1 - beatPhase * 3.4), 2.2);
    const hat = Math.pow(Math.max(0, 1 - Math.abs(beatPhase - 0.5) * 6.5), 2) * 0.8;
    const snare = (Math.exp(-Math.abs(barPhase - 0.25) * 32) + Math.exp(-Math.abs(barPhase - 0.75) * 32)) * 0.9;

    const bass = Math.min(1, kick * 0.98 + 0.04);
    const mid = Math.min(1, snare * 0.85 + 0.06);
    const treble = Math.min(1, hat * 0.88 + 0.05);
    const level = (bass * 0.55 + mid * 0.3 + treble * 0.15);

    for (let i = 0; i < 16; i++) {
        if (i < 4) {
            barDataBuffer[i] = Math.min(255, Math.round(bass * 255 * (1 - i * 0.12)));
        } else if (i < 10) {
            barDataBuffer[i] = Math.min(255, Math.round(mid * 240 * (1 - (i - 4) * 0.08)));
        } else {
            barDataBuffer[i] = Math.min(255, Math.round(treble * 220));
        }
    }

    return { bass, mid, treble, level };
}

function renderFrame(now: DOMHighResTimeStamp) {
    animationFrameId = requestAnimationFrame(renderFrame);

    // Target Framerate throttling (if user chooses 60 or 144)
    const targetFPS = settings.store.targetFPS ?? 240;
    if (targetFPS > 0 && targetFPS < 240) {
        const frameInterval = 1000 / targetFPS;
        if (now - lastFrameTime < frameInterval - 0.75) {
            return;
        }
    }

    const dt = Math.min(0.05, (now - (lastFrameTime || now)) / 1000);
    lastFrameTime = now;

    // Fast FPS Meter
    frameCount++;
    const fpsElapsed = now - lastFPSCalcTime;
    if (fpsElapsed >= 400) {
        measuredFPS = Math.round((frameCount * 1000) / fpsElapsed);
        frameCount = 0;
        lastFPSCalcTime = now;

        if (hudFpsBadge && settings.store.showFPSCounter) {
            hudFpsBadge.textContent = `${measuredFPS} FPS`;
            hudFpsBadge.style.color = measuredFPS >= 200 ? "#00ff88" : measuredFPS >= 120 ? "#00e1ff" : "#ffaa00";
        }
    }

    // Auto-resume audio context if suspended (check once every ~240 frames)
    if (frameCount % 240 === 0 && audioContext && audioContext.state === "suspended") {
        void audioContext.resume();
    }

    const currentMode = settings.store.mode;
    const intensity = settings.store.intensity;
    const snappiness = settings.store.snappiness;
    const nowSec = now / 1000;

    let bass = 0;
    let mid = 0;
    let treble = 0;
    let level = 0;

    if (currentMode === ReactiveMode.SynthwaveBeat) {
        const synth = computeProceduralBeat(nowSec);
        bass = synth.bass;
        mid = synth.mid;
        treble = synth.treble;
        level = synth.level;
    } else if (analyserNode) {
        analyserNode.getByteFrequencyData(rawFreqBuffer);

        let sumBass = 0;
        for (let i = 0; i <= 3; i++) sumBass += rawFreqBuffer[i];
        bass = (sumBass / 4) / 255;

        let sumMid = 0;
        for (let i = 4; i <= 25; i++) sumMid += rawFreqBuffer[i];
        mid = (sumMid / 22) / 255;

        let sumTreble = 0;
        for (let i = 26; i <= 80; i++) sumTreble += rawFreqBuffer[i];
        treble = (sumTreble / 55) / 255;

        let sumAll = 0;
        for (let i = 0; i < 128; i++) sumAll += rawFreqBuffer[i];
        level = (sumAll / 128) / 255;

        if (frameCount % 480 === 0) {
            log(`renderFrame live audio: sumAll=${sumAll.toFixed(1)}, bass=${bass.toFixed(2)}, mid=${mid.toFixed(2)}, treb=${treble.toFixed(2)}`);
        }

        // 16 EQ bands with logarithmic frequency binning & high-freq auditory compensation
        for (let b = 0; b < 16; b++) {
            const [start, end] = EQ_BAND_RANGES[b];
            let sum = 0;
            for (let k = start; k <= end; k++) {
                sum += rawFreqBuffer[k];
            }
            const avg = sum / (end - start + 1);
            const hfBoost = 1.0 + (b * 0.05);
            barDataBuffer[b] = Math.min(255, Math.round(avg * hfBoost));
        }
    } else {
        const breath = (Math.sin(nowSec * 3.0) + 1) * 0.12;
        bass = breath;
        mid = breath * 0.8;
        treble = breath * 0.5;
        level = breath;
        barDataBuffer.fill(Math.round(breath * 255));
    }

    // Delta-Time Exponential Decay (Silky 240Hz physics)
    const decay = Math.exp(- (14 * (snappiness / 3)) * dt);
    smoothedBass = Math.max(bass, smoothedBass * decay);
    smoothedMid = Math.max(mid, smoothedMid * decay);
    smoothedTreble = Math.max(treble, smoothedTreble * decay);
    smoothedLevel = Math.max(level, smoothedLevel * decay);

    const colors = getColors(settings.store.colorTheme, smoothedBass);
    const style = settings.store.reactionStyle;

    // 1. Ambient Window Edge Glow (Edge Dancing Aura)
    const wantsEdgeGlow = style === VisualReactionStyle.EdgeGlow ||
                          style === VisualReactionStyle.FullCyberDeck ||
                          settings.store.glowWindow;

    if (wantsEdgeGlow) {
        if (!windowAuraElement || !windowAuraElement.isConnected) {
            mountWindowAura();
        }
        if (windowAuraElement) {
            const edgeAlpha = Math.min(1, (0.05 + smoothedLevel * 1.8) * (intensity / 3));
            windowAuraElement.style.opacity = edgeAlpha.toFixed(2);
            windowAuraElement.style.borderColor = colors.primary;
            windowAuraElement.style.boxShadow = `inset 0 0 32px ${colors.dim}`;
        }
    } else if (windowAuraElement) {
        unmountWindowAura();
    }

    // 2. Draw Canvas HUD at 240 FPS
    if (settings.store.showVisualizerHUD) {
        const bottomPanels = document.querySelector<HTMLElement>('section[class*="panels"]');
        if (bottomPanels && (!hudContainerElement || !hudContainerElement.isConnected || hudContainerElement.parentElement !== bottomPanels)) {
            mountHUD(bottomPanels);
        }
        if (hudCanvas && hudCtx) {
            drawHUDCanvas(
                colors.primary,
                colors.secondary,
                dt,
                style,
                smoothedBass,
                smoothedMid,
                smoothedTreble,
                smoothedLevel,
                intensity
            );
        }
    }

    // 3. Viewport 240 FPS Visualizer (Sleek Bottom Edge Dock)
    const needsViewportCanvas = style === VisualReactionStyle.NeonSpectrum ||
                                style === VisualReactionStyle.MirrorSpectrum ||
                                style === VisualReactionStyle.CyberWaveform ||
                                style === VisualReactionStyle.FullCyberDeck;

    if (needsViewportCanvas) {
        if (!viewportCanvas || !viewportCanvas.isConnected) {
            mountViewportCanvas();
        }
        if (style === VisualReactionStyle.NeonSpectrum || style === VisualReactionStyle.FullCyberDeck) {
            drawViewportSpectrum(colors.primary, colors.secondary, dt);
        } else if (style === VisualReactionStyle.MirrorSpectrum) {
            drawViewportMirror(colors.primary, colors.secondary, dt);
        } else if (style === VisualReactionStyle.CyberWaveform) {
            drawViewportWaveform(
                colors.primary,
                colors.secondary,
                dt,
                smoothedBass,
                smoothedMid,
                smoothedTreble,
                smoothedLevel,
                intensity
            );
        }
    } else if (viewportCanvas) {
        unmountViewportCanvas();
    }

    // 4. Ambient Aurora Bloom (Soft, diffuse background glow)
    const wantsAurora = (style === VisualReactionStyle.FullCyberDeck || style === VisualReactionStyle.AmbientAurora) && settings.store.ambientAurora;
    if (wantsAurora) {
        if (!ambientAuroraElement || !ambientAuroraElement.isConnected) {
            mountAmbientAurora();
        }
        if (ambientAuroraElement) {
            const auroraAlpha = Math.min(0.65, smoothedLevel * 1.8 * (intensity / 3));
            ambientAuroraElement.style.opacity = auroraAlpha.toFixed(2);
            ambientAuroraElement.style.setProperty("--vc-ar-aurora-color", colors.primary);
        }
    } else if (ambientAuroraElement) {
        unmountAmbientAurora();
    }

    if (hudTitleElement) {
        hudTitleElement.style.color = colors.primary;
    }
}

function drawHUDCanvas(
    primaryColor: string,
    secondaryColor: string,
    dt: number,
    style: VisualReactionStyle,
    smoothedBass: number,
    smoothedMid: number,
    smoothedTreble: number,
    smoothedLevel: number,
    intensity: number
) {
    if (!hudCanvas || !hudCtx) return;

    const width = hudCanvas.width;
    const height = hudCanvas.height;
    hudCtx.clearRect(0, 0, width, height);

    if (style === VisualReactionStyle.CyberWaveform) {
        // Draw 240 FPS Fluid Neon Oscilloscope Waveform inside HUD
        const flowSpeed = 2.5 + (smoothedBass * 6.0) + (smoothedLevel * 3.5);
        hudWavePhase += flowSpeed * dt;

        if (analyserNode) {
            analyserNode.getByteTimeDomainData(rawWaveBuffer);
        } else {
            const nowSec = performance.now() / 1000;
            for (let i = 0; i < 128; i++) {
                rawWaveBuffer[i] = 128 + Math.sin(nowSec * 8 + i * 0.15) * 45 * smoothedLevel;
            }
        }

        const numPoints = 48;
        const yCenter = height / 2;
        const aMax = (height / 2) - 3;
        const intensityMul = intensity / 3;

        // Draw flowing neon wave in HUD
        hudCtx.beginPath();
        hudCtx.strokeStyle = primaryColor;
        hudCtx.lineWidth = 2;
        hudCtx.shadowBlur = 6;
        hudCtx.shadowColor = primaryColor;

        for (let i = 0; i < numPoints; i++) {
            const u = i / (numPoints - 1);
            const x = u * width;
            let envelope = 1.0;
            if (u < 0.1) envelope = 0.5 * (1 - Math.cos((u / 0.1) * Math.PI));
            else if (u > 0.9) envelope = 0.5 * (1 - Math.cos(((1 - u) / 0.1) * Math.PI));

            const waveBass = Math.sin(u * (Math.PI * 4) - hudWavePhase) * (smoothedBass * 1.3 + 0.12);
            const waveMid = Math.sin(u * (Math.PI * 8) + hudWavePhase * 1.4) * (smoothedMid * 0.9 + 0.08);
            const sampleIdx = Math.min(127, Math.floor(u * 128));
            const rawSample = (rawWaveBuffer[sampleIdx] - 128) / 128.0;
            const rawMod = rawSample * (smoothedLevel * 2.0 + 0.35);

            const waveSum = (waveBass * 0.5 + waveMid * 0.3 + rawMod * 0.4) * intensityMul;
            const clamped = Math.max(-1.0, Math.min(1.0, waveSum));
            const y = yCenter - (clamped * aMax * envelope);

            if (i === 0) hudCtx.moveTo(x, y);
            else hudCtx.lineTo(x, y);
        }
        hudCtx.stroke();
        hudCtx.shadowBlur = 0;
        return;
    }

    // Gradient Cache (zero GC allocation per frame)
    if (!cachedGrad || lastGradPrimary !== primaryColor || lastGradSecondary !== secondaryColor || lastGradHeight !== height) {
        cachedGrad = hudCtx.createLinearGradient(0, 0, 0, height);
        cachedGrad.addColorStop(0, primaryColor);
        cachedGrad.addColorStop(1, secondaryColor);
        lastGradPrimary = primaryColor;
        lastGradSecondary = secondaryColor;
        lastGradHeight = height;
    }
    hudCtx.fillStyle = cachedGrad;

    // Mirror Spectrum (Center-Out Symmetrical Equalizer in HUD)
    if (style === VisualReactionStyle.MirrorSpectrum) {
        const halfBars = 8;
        const totalBars = 16;
        const gap = 2.5;
        const barWidth = (width - (totalBars - 1) * gap) / totalBars;
        const midX = width / 2;
        const peakFallSpeed = 40;

        for (let i = 0; i < halfBars; i++) {
            const rawVal = barDataBuffer[i] / 255;
            const barHeight = Math.max(2, rawVal * (height - 3));

            if (barHeight >= peakHeights[i]) {
                peakHeights[i] = barHeight;
            } else {
                peakHeights[i] = Math.max(0, peakHeights[i] - peakFallSpeed * dt);
            }

            const xRight = midX + gap / 2 + i * (barWidth + gap);
            const xLeft = midX - gap / 2 - (i + 1) * barWidth - i * gap;
            const y = height - barHeight;

            if ((hudCtx as any).roundRect) {
                hudCtx.beginPath();
                (hudCtx as any).roundRect(xRight, y, barWidth, barHeight, [2, 2, 0, 0]);
                (hudCtx as any).roundRect(xLeft, y, barWidth, barHeight, [2, 2, 0, 0]);
                hudCtx.fill();
            } else {
                hudCtx.fillRect(xRight, y, barWidth, barHeight);
                hudCtx.fillRect(xLeft, y, barWidth, barHeight);
            }

            if (peakHeights[i] > 3) {
                hudCtx.fillStyle = "#ffffff";
                const peakY = Math.max(0, height - peakHeights[i] - 1.5);
                if ((hudCtx as any).roundRect) {
                    hudCtx.beginPath();
                    (hudCtx as any).roundRect(xRight, peakY, barWidth, 1.5, 1);
                    (hudCtx as any).roundRect(xLeft, peakY, barWidth, 1.5, 1);
                    hudCtx.fill();
                } else {
                    hudCtx.fillRect(xRight, peakY, barWidth, 1.5);
                    hudCtx.fillRect(xLeft, peakY, barWidth, 1.5);
                }
                hudCtx.fillStyle = cachedGrad;
            }
        }
        return;
    }

    // Standard Spectrum Bars
    const numBars = 16;
    const gap = 3;
    const barWidth = (width - (numBars - 1) * gap) / numBars;
    const peakFallSpeed = style === VisualReactionStyle.Stealth ? 60 : 40;
    const maxH = style === VisualReactionStyle.Stealth ? height * 0.5 : height - 3;

    for (let i = 0; i < numBars; i++) {
        const rawVal = barDataBuffer[i] / 255;
        const barHeight = Math.max(2, rawVal * maxH);
        const x = i * (barWidth + gap);
        const y = height - barHeight;

        if (barHeight >= peakHeights[i]) {
            peakHeights[i] = barHeight;
        } else {
            peakHeights[i] = Math.max(0, peakHeights[i] - peakFallSpeed * dt);
        }

        if ((hudCtx as any).roundRect) {
            hudCtx.beginPath();
            (hudCtx as any).roundRect(x, y, barWidth, barHeight, [2, 2, 0, 0]);
            hudCtx.fill();
        } else {
            hudCtx.fillRect(x, y, barWidth, barHeight);
        }

        if (peakHeights[i] > 3) {
            hudCtx.fillStyle = "#ffffff";
            const peakY = Math.max(0, height - peakHeights[i] - 1.5);
            if ((hudCtx as any).roundRect) {
                hudCtx.beginPath();
                (hudCtx as any).roundRect(x, peakY, barWidth, 1.5, 1);
                hudCtx.fill();
            } else {
                hudCtx.fillRect(x, peakY, barWidth, 1.5);
            }
            hudCtx.fillStyle = cachedGrad;
        }
    }

    // If FullCyberDeck, add a subtle flowing waveform beam overlay on top of the bars
    if (style === VisualReactionStyle.FullCyberDeck) {
        const flowSpeed = 2.5 + (smoothedBass * 6.0) + (smoothedLevel * 3.5);
        hudWavePhase += flowSpeed * dt;

        if (analyserNode) {
            analyserNode.getByteTimeDomainData(rawWaveBuffer);
        }

        hudCtx.beginPath();
        hudCtx.strokeStyle = "rgba(255, 255, 255, 0.45)";
        hudCtx.lineWidth = 1.5;
        const numPoints = 48;
        const yCenter = height / 2;
        const aMax = (height / 2) - 3;
        const intensityMul = intensity / 3;

        for (let i = 0; i < numPoints; i++) {
            const u = i / (numPoints - 1);
            const x = u * width;
            let envelope = 1.0;
            if (u < 0.1) envelope = 0.5 * (1 - Math.cos((u / 0.1) * Math.PI));
            else if (u > 0.9) envelope = 0.5 * (1 - Math.cos(((1 - u) / 0.1) * Math.PI));

            const waveBass = Math.sin(u * (Math.PI * 4) - hudWavePhase) * (smoothedBass * 1.2 + 0.1);
            const waveMid = Math.sin(u * (Math.PI * 8) + hudWavePhase * 1.3) * (smoothedMid * 0.8 + 0.05);
            const sampleIdx = Math.min(127, Math.floor(u * 128));
            const rawSample = (rawWaveBuffer[sampleIdx] - 128) / 128.0;
            const rawMod = rawSample * (smoothedLevel * 1.5 + 0.2);

            const waveSum = (waveBass * 0.5 + waveMid * 0.3 + rawMod * 0.4) * intensityMul;
            const clamped = Math.max(-1.0, Math.min(1.0, waveSum));
            const y = yCenter - (clamped * aMax * envelope);

            if (i === 0) hudCtx.moveTo(x, y);
            else hudCtx.lineTo(x, y);
        }
        hudCtx.stroke();
    }
}

function drawViewportSpectrum(primaryColor: string, secondaryColor: string, dt: number) {
    if (!viewportCanvas || !viewportCtx) return;

    if (viewportCanvas.width !== window.innerWidth) {
        viewportCanvas.width = window.innerWidth;
    }

    const w = viewportCanvas.width;
    const h = viewportCanvas.height;
    viewportCtx.clearRect(0, 0, w, h);

    const numBars = 24;
    const gap = 4;
    const totalBarsWidth = Math.min(w * 0.75, 900); // Clean centered dock (max 900px)
    const startX = (w - totalBarsWidth) / 2;
    const barW = (totalBarsWidth - (numBars - 1) * gap) / numBars;
    const peakFallSpeed = 45;

    const grad = viewportCtx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, primaryColor);
    grad.addColorStop(1, secondaryColor);
    viewportCtx.fillStyle = grad;

    for (let i = 0; i < numBars; i++) {
        const freqIdx = Math.min(15, Math.floor((i / numBars) * 16));
        const val = barDataBuffer[freqIdx] / 255;
        const barH = Math.max(2, val * (h - 6));
        const x = startX + i * (barW + gap);
        const y = h - barH;

        if (barH >= viewportPeakHeights[i]) {
            viewportPeakHeights[i] = barH;
        } else {
            viewportPeakHeights[i] = Math.max(0, viewportPeakHeights[i] - peakFallSpeed * dt);
        }

        if ((viewportCtx as any).roundRect) {
            viewportCtx.beginPath();
            (viewportCtx as any).roundRect(x, y, barW, barH, [3, 3, 0, 0]);
            viewportCtx.fill();
        } else {
            viewportCtx.fillRect(x, y, barW, barH);
        }

        if (viewportPeakHeights[i] > 3) {
            viewportCtx.fillStyle = "#ffffff";
            const peakY = Math.max(0, h - viewportPeakHeights[i] - 2);
            if ((viewportCtx as any).roundRect) {
                viewportCtx.beginPath();
                (viewportCtx as any).roundRect(x, peakY, barW, 2, 1);
                viewportCtx.fill();
            } else {
                viewportCtx.fillRect(x, peakY, barW, 2);
            }
            viewportCtx.fillStyle = grad;
        }
    }
}

function drawViewportMirror(primaryColor: string, secondaryColor: string, dt: number) {
    if (!viewportCanvas || !viewportCtx) return;

    if (viewportCanvas.width !== window.innerWidth) {
        viewportCanvas.width = window.innerWidth;
    }

    const w = viewportCanvas.width;
    const h = viewportCanvas.height;
    viewportCtx.clearRect(0, 0, w, h);

    const halfBars = 12;
    const totalBars = 24;
    const gap = 4;
    const totalBarsWidth = Math.min(w * 0.75, 900);
    const midX = w / 2;
    const barW = (totalBarsWidth - (totalBars - 1) * gap) / totalBars;
    const peakFallSpeed = 45;

    const grad = viewportCtx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, primaryColor);
    grad.addColorStop(1, secondaryColor);
    viewportCtx.fillStyle = grad;

    for (let i = 0; i < halfBars; i++) {
        const val = barDataBuffer[i] / 255;
        const barH = Math.max(2, val * (h - 6));

        if (barH >= viewportPeakHeights[i]) {
            viewportPeakHeights[i] = barH;
        } else {
            viewportPeakHeights[i] = Math.max(0, viewportPeakHeights[i] - peakFallSpeed * dt);
        }

        const xRight = midX + gap / 2 + i * (barW + gap);
        const xLeft = midX - gap / 2 - (i + 1) * barW - i * gap;
        const y = h - barH;

        if ((viewportCtx as any).roundRect) {
            viewportCtx.beginPath();
            (viewportCtx as any).roundRect(xRight, y, barW, barH, [3, 3, 0, 0]);
            (viewportCtx as any).roundRect(xLeft, y, barW, barH, [3, 3, 0, 0]);
            viewportCtx.fill();
        } else {
            viewportCtx.fillRect(xRight, y, barW, barH);
            viewportCtx.fillRect(xLeft, y, barW, barH);
        }

        if (viewportPeakHeights[i] > 3) {
            viewportCtx.fillStyle = "#ffffff";
            const peakY = Math.max(0, h - viewportPeakHeights[i] - 2);
            if ((viewportCtx as any).roundRect) {
                viewportCtx.beginPath();
                (viewportCtx as any).roundRect(xRight, peakY, barW, 2, 1);
                (viewportCtx as any).roundRect(xLeft, peakY, barW, 2, 1);
                viewportCtx.fill();
            } else {
                viewportCtx.fillRect(xRight, peakY, barW, 2);
                viewportCtx.fillRect(xLeft, peakY, barW, 2);
            }
            viewportCtx.fillStyle = grad;
        }
    }
}

function drawViewportWaveform(
    primaryColor: string,
    secondaryColor: string,
    dt: number,
    smoothedBass: number,
    smoothedMid: number,
    smoothedTreble: number,
    smoothedLevel: number,
    intensity: number
) {
    if (!viewportCanvas || !viewportCtx) return;

    if (viewportCanvas.width !== window.innerWidth) {
        viewportCanvas.width = window.innerWidth;
    }

    const w = viewportCanvas.width;
    const h = viewportCanvas.height;
    viewportCtx.clearRect(0, 0, w, h);

    // Audio-reactive phase advance (surges and accelerates on bass drops)
    const flowSpeed = 2.5 + (smoothedBass * 6.0) + (smoothedLevel * 3.5);
    viewportWavePhase += flowSpeed * dt;
    viewportWavePhase2 += (flowSpeed * 0.75) * dt;

    if (analyserNode) {
        analyserNode.getByteTimeDomainData(rawWaveBuffer);
    } else {
        const nowSec = performance.now() / 1000;
        for (let i = 0; i < 128; i++) {
            rawWaveBuffer[i] = 128 + Math.sin(nowSec * 8 + i * 0.15) * 45 * smoothedLevel;
        }
    }

    const numPoints = 160;
    const yCenter = h / 2;
    const aMax = (h / 2) - 4;
    const intensityMul = intensity / 3;

    for (let i = 0; i < numPoints; i++) {
        const u = i / (numPoints - 1);
        waveXPoints[i] = u * w;

        // Smooth Tukey edge envelope (zero at window edges, full amplitude across 84% center)
        let envelope = 1.0;
        if (u < 0.08) {
            envelope = 0.5 * (1 - Math.cos((u / 0.08) * Math.PI));
        } else if (u > 0.92) {
            envelope = 0.5 * (1 - Math.cos(((1 - u) / 0.08) * Math.PI));
        }

        // Bass wave: large, rolling foundational swells traveling right
        const waveBass = Math.sin(u * (Math.PI * 4) - viewportWavePhase) * (smoothedBass * 1.3 + 0.12);
        // Mid wave: melodic undulating ripple
        const waveMid = Math.sin(u * (Math.PI * 8) + viewportWavePhase * 1.4) * (smoothedMid * 0.9 + 0.08);
        // Treble wave: rapid shimmering crest ripples
        const waveTreb = Math.sin(u * (Math.PI * 16) - viewportWavePhase * 2.2) * (smoothedTreble * 0.6);

        // Instantaneous acoustic sample modulation from live Spotify stream
        const sampleIdx = Math.min(127, Math.floor(u * 128));
        const rawSample = (rawWaveBuffer[sampleIdx] - 128) / 128.0;
        const rawMod = rawSample * (smoothedLevel * 2.0 + 0.35);

        // Combined primary wave
        const waveSum = (waveBass * 0.45 + waveMid * 0.30 + waveTreb * 0.15 + rawMod * 0.35) * intensityMul;
        const clamped = Math.max(-1.0, Math.min(1.0, waveSum));
        waveYPoints[i] = yCenter - (clamped * aMax * envelope);

        // Secondary harmonic companion wave
        const waveBass2 = Math.sin(u * (Math.PI * 4.5) - viewportWavePhase2 + 1.2) * (smoothedBass * 1.1 + 0.1);
        const waveMid2 = Math.sin(u * (Math.PI * 7) + viewportWavePhase2 * 1.2 - 0.8) * (smoothedMid * 0.8 + 0.06);
        const waveSum2 = (waveBass2 * 0.55 + waveMid2 * 0.45 - rawMod * 0.2) * intensityMul;
        const clamped2 = Math.max(-1.0, Math.min(1.0, waveSum2));
        waveY2Points[i] = yCenter - (clamped2 * (aMax * 0.85) * envelope);
    }

    // 1. Layer 1: Ambient Neon Underglow Fill
    const fillGrad = viewportCtx.createLinearGradient(0, yCenter, 0, h);
    fillGrad.addColorStop(0, primaryColor);
    fillGrad.addColorStop(1, "transparent");
    viewportCtx.fillStyle = fillGrad;
    viewportCtx.globalAlpha = Math.min(0.25, 0.05 + smoothedLevel * 0.3);
    viewportCtx.beginPath();
    viewportCtx.moveTo(0, h);
    for (let i = 0; i < numPoints; i++) {
        viewportCtx.lineTo(waveXPoints[i], waveYPoints[i]);
    }
    viewportCtx.lineTo(w, h);
    viewportCtx.closePath();
    viewportCtx.fill();

    // 2. Layer 2: Secondary Harmonic Wave Ribbon
    viewportCtx.beginPath();
    viewportCtx.strokeStyle = secondaryColor;
    viewportCtx.lineWidth = 1.5;
    viewportCtx.globalAlpha = 0.5;
    for (let i = 0; i < numPoints; i++) {
        if (i === 0) viewportCtx.moveTo(waveXPoints[i], waveY2Points[i]);
        else viewportCtx.lineTo(waveXPoints[i], waveY2Points[i]);
    }
    viewportCtx.stroke();
    viewportCtx.globalAlpha = 1.0;

    // 3. Layer 3: Primary Laser Neon Wave
    viewportCtx.beginPath();
    viewportCtx.strokeStyle = primaryColor;
    viewportCtx.lineWidth = 2.5;
    viewportCtx.shadowBlur = 10;
    viewportCtx.shadowColor = primaryColor;
    for (let i = 0; i < numPoints; i++) {
        if (i === 0) viewportCtx.moveTo(waveXPoints[i], waveYPoints[i]);
        else viewportCtx.lineTo(waveXPoints[i], waveYPoints[i]);
    }
    viewportCtx.stroke();
    viewportCtx.shadowBlur = 0;
}

function mountWindowAura() {
    if (windowAuraElement && windowAuraElement.isConnected) return;
    windowAuraElement?.remove();

    const aura = document.createElement("div");
    aura.className = "vc-ar-window-aura";
    document.body.appendChild(aura);
    windowAuraElement = aura;
}

function unmountWindowAura() {
    windowAuraElement?.remove();
    windowAuraElement = null;
}

function mountViewportCanvas() {
    if (viewportCanvas && viewportCanvas.isConnected) return;
    viewportCanvas?.remove();

    const canvas = document.createElement("canvas");
    canvas.className = "vc-ar-viewport-canvas";
    canvas.width = window.innerWidth;
    canvas.height = 54;
    document.body.appendChild(canvas);
    viewportCanvas = canvas;
    viewportCtx = canvas.getContext("2d");
}

function unmountViewportCanvas() {
    viewportCanvas?.remove();
    viewportCanvas = null;
    viewportCtx = null;
}

function mountAmbientAurora() {
    if (ambientAuroraElement && ambientAuroraElement.isConnected) return;
    ambientAuroraElement?.remove();

    const aurora = document.createElement("div");
    aurora.className = "vc-ar-ambient-aurora";
    document.body.appendChild(aurora);
    ambientAuroraElement = aurora;
}

function unmountAmbientAurora() {
    ambientAuroraElement?.remove();
    ambientAuroraElement = null;
}

function getStyleShortLabel(style: VisualReactionStyle): string {
    switch (style) {
        case VisualReactionStyle.EdgeGlow: return "🌌 EDGE GLOW";
        case VisualReactionStyle.FullCyberDeck: return "🌟 FULL DECK";
        case VisualReactionStyle.NeonSpectrum: return "📊 SPECTRUM";
        case VisualReactionStyle.MirrorSpectrum: return "🪞 MIRROR";
        case VisualReactionStyle.CyberWaveform: return "⚡ WAVEFORM";
        case VisualReactionStyle.AmbientAurora: return "🌊 AURORA";
        case VisualReactionStyle.Stealth: return "🎛️ STEALTH";
        default: return "STYLE";
    }
}

function cycleReactionStyle() {
    const styles = [
        VisualReactionStyle.EdgeGlow,
        VisualReactionStyle.FullCyberDeck,
        VisualReactionStyle.NeonSpectrum,
        VisualReactionStyle.MirrorSpectrum,
        VisualReactionStyle.CyberWaveform,
        VisualReactionStyle.AmbientAurora,
        VisualReactionStyle.Stealth
    ];
    const curIdx = styles.indexOf(settings.store.reactionStyle);
    const nextStyle = styles[(curIdx + 1) % styles.length];
    settings.store.reactionStyle = nextStyle;
    if (hudStyleBadge) {
        hudStyleBadge.textContent = getStyleShortLabel(nextStyle);
    }
    applyReactionToggles();
}

function applyReactionToggles() {
    const style = settings.store.reactionStyle;
    const wantsEdgeGlow = style === VisualReactionStyle.EdgeGlow ||
                          style === VisualReactionStyle.FullCyberDeck ||
                          settings.store.glowWindow;
    const wantsAurora = (style === VisualReactionStyle.FullCyberDeck || style === VisualReactionStyle.AmbientAurora) && settings.store.ambientAurora;
    const needsViewportCanvas = style === VisualReactionStyle.NeonSpectrum ||
                                style === VisualReactionStyle.MirrorSpectrum ||
                                style === VisualReactionStyle.CyberWaveform ||
                                style === VisualReactionStyle.FullCyberDeck;

    if (wantsEdgeGlow) {
        mountWindowAura();
    } else {
        unmountWindowAura();
    }

    if (wantsAurora) {
        mountAmbientAurora();
    } else {
        unmountAmbientAurora();
    }

    if (needsViewportCanvas) {
        mountViewportCanvas();
    } else {
        unmountViewportCanvas();
    }

    if (hudStyleBadge) {
        hudStyleBadge.textContent = getStyleShortLabel(style);
    }
}

function mountHUD(targetPanels?: HTMLElement | null) {
    const bottomPanels = targetPanels || document.querySelector<HTMLElement>('section[class*="panels"]');
    if (!bottomPanels) return;
    if (hudContainerElement && hudContainerElement.isConnected && hudContainerElement.parentElement === bottomPanels) return;

    hudContainerElement?.remove();

    const hud = document.createElement("div");
    hud.className = "vc-ar-hud-container";

    const header = document.createElement("div");
    header.className = "vc-ar-hud-header";

    const title = document.createElement("div");
    title.className = "vc-ar-hud-title";
    title.innerHTML = `<span>⚡ DISCO RADAR</span>`;
    title.title = "Click to cycle color theme";
    title.addEventListener("click", () => {
        const themes = [
            ColorTheme.Rainbow,
            ColorTheme.Cyberpunk,
            ColorTheme.Synthwave,
            ColorTheme.Matrix,
            ColorTheme.ElectricBlue
        ];
        const curIdx = themes.indexOf(settings.store.colorTheme);
        settings.store.colorTheme = themes[(curIdx + 1) % themes.length];
    });
    hudTitleElement = title;

    const actions = document.createElement("div");
    actions.className = "vc-ar-hud-actions";

    const fpsBadge = document.createElement("div");
    fpsBadge.className = "vc-ar-hud-fps";
    fpsBadge.textContent = "240 FPS";
    fpsBadge.title = "Target FPS (Click to cycle 240 / 144 / 60 / Uncapped)";
    fpsBadge.addEventListener("click", () => {
        const fpsList = [240, 144, 60, 0];
        const curFps = settings.store.targetFPS ?? 240;
        const curIdx = fpsList.indexOf(curFps);
        const nextFps = fpsList[(curIdx + 1) % fpsList.length];
        settings.store.targetFPS = nextFps;
        fpsBadge.textContent = nextFps === 0 ? "UNCAPPED" : `${nextFps} FPS`;
    });
    hudFpsBadge = fpsBadge;

    const deviceBadge = document.createElement("div");
    deviceBadge.className = "vc-ar-hud-device";
    deviceBadge.textContent = activeDeviceLabel;
    deviceBadge.title = "Audio Input (Click to cycle Spotify / Mic / BetterBanana)";
    deviceBadge.addEventListener("click", () => {
        void cycleAudioDevice();
    });
    hudDeviceBadge = deviceBadge;

    const styleBadge = document.createElement("div");
    styleBadge.className = "vc-ar-hud-style";
    styleBadge.textContent = getStyleShortLabel(settings.store.reactionStyle);
    styleBadge.title = "Visual Reaction Style (Click to cycle Edge Glow / Full Deck / Spectrum / Mirror / Waveform / Aurora / Stealth)";
    styleBadge.addEventListener("click", () => {
        cycleReactionStyle();
    });
    hudStyleBadge = styleBadge;

    const modeBtn = document.createElement("div");
    modeBtn.className = "vc-ar-hud-mode";
    hudModeBadge = modeBtn;
    modeBtn.textContent = settings.store.mode === ReactiveMode.SynthwaveBeat ? "BEAT" : "LIVE";
    modeBtn.title = "Audio Mode (Click to toggle Live Audio / Synthwave Beat)";
    modeBtn.addEventListener("click", () => {
        const nextMode = settings.store.mode === ReactiveMode.Mic ? ReactiveMode.SynthwaveBeat : ReactiveMode.Mic;
        settings.store.mode = nextMode;
        modeBtn.textContent = nextMode === ReactiveMode.SynthwaveBeat ? "BEAT" : "LIVE";
        void setupAudioSource(nextMode);
    });

    actions.appendChild(fpsBadge);
    actions.appendChild(deviceBadge);
    actions.appendChild(styleBadge);
    actions.appendChild(modeBtn);

    header.appendChild(title);
    header.appendChild(actions);

    const canvas = document.createElement("canvas");
    canvas.className = "vc-ar-hud-canvas";
    canvas.width = 220;
    canvas.height = 28;

    hud.appendChild(header);
    hud.appendChild(canvas);

    bottomPanels.prepend(hud);

    hudContainerElement = hud;
    hudCanvas = canvas;
    hudCtx = canvas.getContext("2d");
}

function unmountHUD() {
    hudContainerElement?.remove();
    hudContainerElement = null;
    hudTitleElement = null;
    hudCanvas = null;
    hudCtx = null;
    hudFpsBadge = null;
    hudModeBadge = null;
    hudDeviceBadge = null;
    hudStyleBadge = null;
}

function applyDOMToggles() {
    applyReactionToggles();

    if (settings.store.showVisualizerHUD) {
        mountHUD();
    } else {
        unmountHUD();
    }
}

function handleSettingChange(key: string, val: any) {
    log(`handleSettingChange: ${key} = ${val}`);
    if (key === "reactionStyle") {
        if (hudStyleBadge) {
            hudStyleBadge.textContent = getStyleShortLabel(val);
        }
        applyReactionToggles();
    } else if (key === "mode") {
        if (hudModeBadge) {
            hudModeBadge.textContent = val === ReactiveMode.SynthwaveBeat ? "BEAT" : "LIVE";
        }
        void setupAudioSource(val);
    } else if (key === "audioDevice") {
        void setupAudioSource(settings.store.mode);
    } else if (key === "showVisualizerHUD") {
        if (val) mountHUD();
        else unmountHUD();
    } else if (key === "targetFPS") {
        if (hudFpsBadge) {
            hudFpsBadge.textContent = val === 0 ? "UNCAPPED" : `${val} FPS`;
        }
    } else if (key === "glowWindow" || key === "ambientAurora") {
        applyReactionToggles();
    }
}

function onPrefixSettingChange(data: any, path: string) {
    const key = path.replace("plugins.AudioReactiveDisco.", "");
    handleSettingChange(key, data);
}

export default definePlugin({
    name: "AudioReactiveDisco",
    description: "Ultra-fast 240 FPS audio reactivity with native BetterBanana & Spotify routing support!",
    authors: [{
        name: "Eve",
        id: 0n
    }],
    tags: ["Fun", "Appearance", "Voice"],
    settings,
    managedStyle,

    start() {
        applyDOMToggles();
        void setupAudioSource(settings.store.mode);

        lastFrameTime = performance.now();
        lastFPSCalcTime = performance.now();
        frameCount = 0;

        cleanupSettingsListener = onSettingChange(handleSettingChange);
        SettingsStore.addPrefixChangeListener("plugins.AudioReactiveDisco", onPrefixSettingChange);

        window.addEventListener("pointerdown", onPointerDown, { passive: true });
        navigator.mediaDevices?.addEventListener("devicechange", onDeviceChange);

        animationFrameId = requestAnimationFrame(renderFrame);
    },

    stop() {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }

        cleanupSettingsListener?.();
        cleanupSettingsListener = null;

        SettingsStore.removePrefixChangeListener("plugins.AudioReactiveDisco", onPrefixSettingChange);

        window.removeEventListener("pointerdown", onPointerDown);
        navigator.mediaDevices?.removeEventListener("devicechange", onDeviceChange);

        teardownAudioSource();

        if (audioContext && audioContext.state !== "closed") {
            void audioContext.close();
            audioContext = null;
        }

        unmountWindowAura();
        unmountAmbientAurora();
        unmountViewportCanvas();
        unmountHUD();
    }
});
