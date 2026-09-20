/*
 * Vencord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const enum ReactiveMode {
    Mic = "mic",
    SynthwaveBeat = "synthwave_beat",
    Media = "media"
}

export const enum ColorTheme {
    Rainbow = "rainbow",
    Cyberpunk = "cyberpunk",
    Synthwave = "synthwave",
    Matrix = "matrix",
    ElectricBlue = "electric_blue"
}

export const enum VisualReactionStyle {
    EdgeGlow = "edge_glow",
    FullCyberDeck = "full_cyber_deck",
    NeonSpectrum = "neon_spectrum",
    MirrorSpectrum = "mirror_spectrum",
    CyberWaveform = "cyber_waveform",
    AmbientAurora = "ambient_aurora",
    Stealth = "stealth"
}

export type SettingChangeCallback = (key: string, val: any) => void;
const settingCallbacks = new Set<SettingChangeCallback>();

export function onSettingChange(cb: SettingChangeCallback): () => void {
    settingCallbacks.add(cb);
    return () => settingCallbacks.delete(cb);
}

export function notifySettingChange(key: string, val: any) {
    for (const cb of settingCallbacks) {
        try {
            cb(key, val);
        } catch (e) {
            console.error("[AudioReactiveDisco] Setting change listener error:", e);
        }
    }
}

export const settings = definePluginSettings({
    reactionStyle: {
        description: "Visual Reaction Effect Style",
        type: OptionType.SELECT,
        options: [
            { label: "🌌 Ambient Edge Glow (Edge Dancing Aura - User Favorite!)", value: VisualReactionStyle.EdgeGlow, default: true },
            { label: "🌟 Full Cyber Deck (Edge Glow + Neon Spectrum Bars)", value: VisualReactionStyle.FullCyberDeck },
            { label: "📊 Neon Spectrum Bars (240Hz Equalizer Dock)", value: VisualReactionStyle.NeonSpectrum },
            { label: "🪞 Mirror Spectrum (Dual-Mirrored Center-Out Equalizer)", value: VisualReactionStyle.MirrorSpectrum },
            { label: "⚡ Cyber Waveform (240Hz Oscilloscope Soundwave)", value: VisualReactionStyle.CyberWaveform },
            { label: "🌊 Ambient Aurora (Soft Diffused Bottom Bloom)", value: VisualReactionStyle.AmbientAurora },
            { label: "🎛️ Minimal Stealth (Low-Profile Micro Radar Only)", value: VisualReactionStyle.Stealth }
        ],
        onChange: val => notifySettingChange("reactionStyle", val)
    },
    mode: {
        description: "Audio Input Mode",
        type: OptionType.SELECT,
        options: [
            { label: "Live Audio Device (Spotify / BetterBanana / Mic)", value: ReactiveMode.Mic, default: true },
            { label: "Procedural Synthwave Beat (No Mic Needed / Demo)", value: ReactiveMode.SynthwaveBeat }
        ],
        onChange: val => notifySettingChange("mode", val)
    },
    audioDevice: {
        description: "Target Audio Device ('betterbanana_auto' automatically binds Spotify/Cable 1)",
        type: OptionType.STRING,
        default: "betterbanana_auto",
        onChange: val => notifySettingChange("audioDevice", val)
    },
    colorTheme: {
        description: "Color Spectrum Theme",
        type: OptionType.SELECT,
        options: [
            { label: "🌈 Rainbow Spectrum Cycle", value: ColorTheme.Rainbow, default: true },
            { label: "⚡ Cyberpunk (Cyan & Hot Magenta)", value: ColorTheme.Cyberpunk },
            { label: "🌅 Synthwave (Sunset Gold & Violet)", value: ColorTheme.Synthwave },
            { label: "📟 Matrix (Phosphor Neon Green)", value: ColorTheme.Matrix },
            { label: "🔮 Electric Blue & Violet", value: ColorTheme.ElectricBlue }
        ],
        onChange: val => notifySettingChange("colorTheme", val)
    },
    targetFPS: {
        description: "Target Refresh Rate / Framerate",
        type: OptionType.SELECT,
        options: [
            { label: "🚀 240 FPS (Ultra Smooth / 240Hz Gaming)", value: 240, default: true },
            { label: "⚡ 144 FPS (High Refresh)", value: 144 },
            { label: "🌿 60 FPS (Eco / Standard)", value: 60 },
            { label: "♾️ Uncapped (Direct Display VSync)", value: 0 }
        ],
        onChange: val => notifySettingChange("targetFPS", val)
    },
    snappiness: {
        description: "Animation Snappiness / Response Speed (higher = faster kick response)",
        type: OptionType.SLIDER,
        markers: [1, 2, 3, 4, 5],
        default: 4,
        stickToMarkers: true,
        onChange: val => notifySettingChange("snappiness", val)
    },
    intensity: {
        description: "Visual Reactivity Intensity Multiplier",
        type: OptionType.SLIDER,
        markers: [1, 2, 3, 4, 5],
        default: 3,
        stickToMarkers: true,
        onChange: val => notifySettingChange("intensity", val)
    },
    glowWindow: {
        description: "Enable ambient window edge glow (used in Edge Glow & Full Deck, or as ambient layer)",
        type: OptionType.BOOLEAN,
        default: true,
        onChange: val => notifySettingChange("glowWindow", val)
    },
    ambientAurora: {
        description: "Enable soft atmospheric background underglow (diffuse ambient bloom)",
        type: OptionType.BOOLEAN,
        default: false,
        onChange: val => notifySettingChange("ambientAurora", val)
    },
    showVisualizerHUD: {
        description: "Mount interactive neon audio deck in bottom panel",
        type: OptionType.BOOLEAN,
        default: true,
        onChange: val => notifySettingChange("showVisualizerHUD", val)
    },
    showFPSCounter: {
        description: "Display live real-time FPS counter in the visualizer HUD",
        type: OptionType.BOOLEAN,
        default: true,
        onChange: val => notifySettingChange("showFPSCounter", val)
    }
});
