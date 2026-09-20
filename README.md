# Vencord plugins

Five userplugins for [Vencord](https://github.com/Vendicated/Vencord). All of them render their own UI
locally — nothing is sent anywhere, and nothing here needs an API key or an external tracking server.

| Plugin | What it does |
| --- | --- |
| [ServerShapes](#servershapes) | 16 server icon shapes with contour-following glows, gradients, per-server styles, and audio reactivity |
| [AudioReactiveDisco](#audioreactivedisco) | Hardware-accelerated 240 FPS audio reactive visualizers with native PipeWire & BetterBanana Spotify routing |
| [CallWrapped](#callwrapped) | Turns every voice call into a report card: talk time, interruptions, dead air, and a timeline of who had the mic |
| [VoiceQualityHUD](#voicequalityhud) | A draggable overlay with live ping, jitter, packet loss and packet rates for the call you're in |
| [ReplyGraph](#replygraph) | Draws a channel's reply structure as a force-directed graph so you can untangle four conversations at once |

## Install

Vencord loads userplugins from a development checkout, so you need one:
[the official guide](https://docs.vencord.dev/installing/custom-plugins/) covers cloning and
building it.

```sh
git clone https://github.com/Zykoraa/vencord-plugins.git
cd vencord-plugins
./install.sh /path/to/Vencord          # copies the plugins into src/userplugins
cd /path/to/Vencord && pnpm build
```

Restart Discord, then enable the plugins under **Settings → Plugins**. `install.sh` finds
`~/Vencord` on its own if you don't pass a path.

If you'd rather keep this repo as the single source of truth, use `./install.sh --link`. That
symlinks instead of copying and writes a local, gitignored `tsconfig.json` pointing at your
checkout — esbuild resolves symlinks to their real path *before* it looks for tsconfig path
aliases, so without that file a linked install can't resolve `@utils/*`, `@webpack/*` and friends.

## ServerShapes

Give the server list a custom look with 16 shapes and a glow that follows each outline.

By [Eve (@Zykoraa)](https://github.com/Zykoraa) and
[Demonjane (@Demonjane-jpg)](https://github.com/Demonjane-jpg)
([Discord](https://discord.com/users/725525081555730542)).

- Four glow styles with solid colours, gradients, or colours sampled from each server icon
- Soft light that can extend past the server rail without covering server badges
- Live settings preview, exact numeric controls, per-server overrides, presets, and undo/redo
- Optional hover effects, animation, avatar styling, and audio reactivity

[Installation, settings, and details →](serverShapes/README.md)

## CallWrapped

Watches the `SPEAKING` events Discord already dispatches for everyone in your voice channel and,
when the call ends, turns them into a report.

- **Talk time** per person, with shares and a bar chart
- **A timeline ribbon** — one row per person, every stretch they held the mic drawn to scale. The
  shape of a call is usually obvious at a glance: one long bar and a lot of short ones, or a proper
  back and forth.
- **Interruptions**, counted honestly: someone interrupted you if they started while you still had
  the mic *and you gave up within a couple of seconds*. Starting up and backing off is just an
  overlap, and doesn't count.
- **Dead air**, overlap, turn counts, average and longest turn
- **Awards** — The Yapper, Filibuster, The Interrupter, Steamrolled, Backchannel, Icebreaker, The
  Closer, and Ghost for whoever sat there the whole call and never said a word

Reports are saved locally (the last 10 by default) and reachable from the Vencord toolbox, along
with a **Copy as text** button that produces a paste-ready summary with ASCII bars.

Settings cover what happens when a call ends (notification, open immediately, or nothing), minimum
call length and headcount, the interruption window, whether to include yourself and bots, and how
many reports to keep.

[More detail →](callWrapped/README.md)

## VoiceQualityHUD

Discord tells you your ping. It doesn't tell you *why* someone sounds like a fax machine.

A small floating panel — drag it anywhere, double-click the header to collapse it — polling
`RTCConnectionStore` once a second while you're connected:

- Current ping with a sparkline of the last 90 samples, plus average and min/max
- **Jitter**, as the mean change between consecutive samples. A flat 80 ms is fine; 40 ms bouncing
  to 200 ms is what actually breaks audio.
- Outbound loss (Discord's own figure) and inbound loss derived from the packet counters
- Packet rates in and out, call duration, peer count, and which voice server you landed on

It shows up when you join a call and disappears when you leave. No webpack patches — it only reads
stores, so a Discord update can't break it in the way a bad patch regex can.

[More detail →](voiceQualityHUD/README.md)

## ReplyGraph

A button in the chat bar. Click it and the channel's loaded messages become a graph: each message
is a dot coloured by author, each reply is an edge, and replies hang below what they answer so a
chain reads top to bottom.

- Watch it settle, drag nodes around, scroll to zoom, drag the background to pan
- Hover a dot for the author, timestamp and message text
- Click one to jump to that message in the channel
- The sidebar counts messages, replies and separate threads, and hovering an author dims everyone
  else

Useful when a channel has four conversations interleaved and you want to see which is which.

[More detail →](replyGraph/README.md)

## AudioReactiveDisco

Turns your Discord window into a clean, hardware-accelerated audio reactive canvas running at up to
240 FPS, without camera shaking, jumping chat text, or font blurring.

- **Seven Visualizer Styles**: Ambient Edge Glow around your window perimeter, Full Cyber Deck,
  Neon Spectrum Bars, Mirror Spectrum, Cyber Waveform (fluid traveling oscilloscope ribbon),
  Ambient Aurora bloom, and Minimal Stealth.
- **Native Spotify & BetterBanana Binding**: Automatically detects and binds to PipeWire virtual
  sinks (`bb_spotify_source` / `bb_cable1.monitor`) on Linux so it reacts directly to your music stream.
- **Zero-GC Hot Path**: Pure pre-allocated typed arrays in the 240 FPS render loop for zero frame stutter.
- **HUD Controller**: Micro-panel docked in Discord's bottom panel showing real-time FPS, live micro-canvas,
  one-click device cycling, and one-click visualizer style cycling.

[More detail →](audioReactiveDisco/README.md)

## A note on what these can see

These plugins only use data Discord has already handed the client or local audio inputs you explicitly select:
who is speaking in a call you're in, your own connection stats, the messages already loaded in a channel,
or local audio streams via Web Audio API. Nothing leaves your machine — CallWrapped's saved reports, the
HUD positions, and AudioReactiveDisco's settings live in Vencord's local storage.

CallWrapped does record when each person in a call spoke. That's derived from the same events that
make the green ring appear around someone's avatar, so it's nothing the call didn't already show
you — but it does persist it, so use your judgement about pasting a report into a server.

## License

GPL-3.0-or-later, same as Vencord.
