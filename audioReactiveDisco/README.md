# AudioReactiveDisco

Hardware-accelerated 240 FPS audio reactive visualizers for Discord, designed with native Linux PipeWire / BetterBanana Spotify routing support.

No camera shaking, no bouncing chat text, and no layout instability — pure GPU compositor animations and Canvas 2D hardware-accelerated rendering.

## Visualizer Styles

Switch styles directly from Discord Settings or click the **style badge** in the bottom panel HUD:

| Style | Description |
| --- | --- |
| **🌌 Ambient Edge Glow** *(Default)* | The user-favorite window perimeter aura (`inset 0 0 32px` neon glow). Pulses and breathes dynamically to audio dynamics and bass kicks at locked 240 FPS via GPU compositor opacity. |
| **🌟 Full Cyber Deck** | The Ambient Edge Glow **plus** the 24-column rounded neon equalizer dock along the bottom edge of the Discord window. |
| **📊 Neon Spectrum Bars** | 24 centered rounded neon EQ columns with floating peak decay caps docked along the bottom edge. |
| **🪞 Mirror Spectrum** | Symmetrical dual-mirrored center-out spectrum bars docked along the bottom edge. |
| **⚡ Cyber Waveform** | Multi-layer fluid traveling neon oscilloscope ribbon with audio transient modulation, harmonic companion wave, and atmospheric underglow fill. |
| **🌊 Ambient Aurora** | Soft diffused atmospheric underglow bloom (like OLED ambilight backlighting) breathing with track rhythm. |
| **🎛️ Minimal Stealth** | Zero viewport overlays; keeps only the audio micro-meter inside the bottom panel HUD. |

## Audio Routing & BetterBanana (Linux / PipeWire)

Built specifically for high-fidelity audio workflows:

- **Automatic Spotify Binding**: Automatically detects and prioritizes BetterBanana virtual sinks and monitors (e.g. `bb_spotify_source` / `bb_cable1.monitor`).
- **One-Click Device Cycling**: Click the device badge on the HUD to instantly cycle between your Spotify stream, microphone, and virtual audio buses with deterministic wrap-around.
- **Native Remap Helper**: On Linux desktop builds with native sidecar access, automatically sets up clean PipeWire monitor sources if they aren't already mapped.
- **Procedural Fallback**: Includes a built-in Synthwave beat generator if no audio source is connected.

## HUD Controller

A sleek micro-panel docked in Discord's bottom left user bar:

- **Live Equalizer / Waveform**: Real-time micro-visualizer canvas.
- **240 FPS Counter**: Real-time render loop monitor with delta-time benchmarking.
- **Device Selector Badge**: Shows the active audio stream (click to cycle devices).
- **Style Selector Badge**: Shows the active visualizer mode (click to cycle styles).
- **Mode Badge**: Shows current reactive mode (`Mic`, `Music`, `Synthwave`).

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| **Visual Reaction Style** | `Edge Glow` | Visualizer presentation mode (`Edge Glow`, `Full Deck`, `Spectrum`, `Mirror`, `Waveform`, `Aurora`, `Stealth`). |
| **Color Theme** | `Rainbow` | Active palette (`Rainbow`, `Cyberpunk`, `Synthwave`, `Matrix`, `Electric Blue`). |
| **Target FPS** | `240` | Refresh rate target (`60`, `120`, `144`, `165`, `240`). |
| **Intensity** | `4` | Visualizer sensitivity multiplier (1 to 5). |
| **Snappiness** | `4` | Beat attack/decay response speed (1 to 5). |
| **Show Visualizer HUD** | `on` | Shows the bottom panel HUD controller. |
| **Window Edge Glow** | `on` | Enables the ambient edge aura in supporting modes. |
| **Audio Input Device** | `Auto` | Select specific input device or auto-detect BetterBanana Spotify. |

## How It's Built

- **Zero-GC Hot Path**: All audio analysis buffers (`Uint8Array`, `Float32Array`) and canvas coordinate arrays are pre-allocated at module load time. Zero object or array allocations occur inside the 240 FPS `requestAnimationFrame` loop.
- **Compositor Acceleration**: Window perimeter glows use GPU compositor transforms and opacity transitions without triggering DOM layout recalcs or style invalidations.
- **Decoupled Architecture**: Bi-directional event bus connects settings UI changes immediately to the render loop without requiring client reloads.
