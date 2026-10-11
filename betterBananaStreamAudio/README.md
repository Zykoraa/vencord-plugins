# BetterBananaStreamAudio

A Linux Vencord userplugin that selects BetterBanana's stable mixer process for whole-screen stream
audio. It targets capture stalls associated with games opening and closing playback streams: Discord
can capture the mixer's output instead of tracking every temporary game stream.

## Requirements and routing

- Desktop Discord with a custom Vencord build.
- Linux with PipeWire and PulseAudio compatibility.
- [BetterBanana](https://github.com/Zykoraa/Linux-Apps/tree/main/BetterBanana) running as the same user.
- A dedicated BetterBanana stream bus with the full stream guard enabled.

Set up the stream bus through **Engine → Discord stream…** in BetterBanana, or use its CLI:

```sh
bb-ctl stream setup
bb-ctl stream guard on
bb-ctl stream
```

Setup chooses a free output bus, commonly A3, and points it at `betterbanana_stream`. Route the
applications and music you want viewers to hear to that bus. Keep AUX/incoming Discord voice off
the stream bus to prevent echo.

The full stream guard is required: selecting `bb-engine` exposes its monitoring buses as well as
the stream bus. The guard keeps one copy of the stream mix and removes monitoring/duplicate feeds.
This plugin selects the capture source; it does not configure routing or enable the guard itself.

## Install

Follow [Vencord's custom plugin guide](https://docs.vencord.dev/installing/custom-plugins/) to prepare
a development checkout. Copy this entire folder, including `native.ts`, into
`Vencord/src/userplugins/betterBananaStreamAudio`, or use this repository's installer:

```sh
./install.sh /path/to/Vencord
cd /path/to/Vencord
pnpm build
```

The installer copies all plugins in this collection. Install/inject the custom desktop build as
described in Vencord's guide, then fully quit and reopen Discord so the native helper loads.
**BetterBananaStreamAudio** is enabled by default and can be disabled under **Settings → Plugins**.
Start a whole-screen share with **Share stream audio** enabled.

## Behavior

- Checks every two seconds and changes active whole-screen audio to the running `bb-engine` PID.
- Finds the mixer through `/proc`, checks that it belongs to your user, and follows PID changes.
- Leaves application-specific capture and manually disabled stream audio alone.
- Restores whole-screen capture when disabled, preserving the current audio on/off state.
- Leaves Discord's normal capture unchanged when the mixer or native helper is unavailable.

This is a targeted source-selection workaround. It does not detect silence at a viewer or reset
every possible capture stall. It depends on Discord's internal media engine API, which can change
after an update. The built plugin and lifecycle tests passed; activation after a fresh Discord
restart remains to be verified. Selecting the same mixer manually recovered the original stalled
stream's outgoing audio packets.

## Development checks

From this repository, using dependencies from your Vencord checkout:

```sh
VENCORD_PATH=/path/to/Vencord node --test tests/stream-audio-plugin.test.ts
```

Use a Node version that supports running TypeScript tests directly. Tests mock Discord and Linux
process lookup; they do not require a running mixer or record audio.

## License

GPL-3.0-or-later, same as Vencord.
