# Vencord plugins

Three userplugins for [Vencord](https://github.com/Vendicated/Vencord). All of them read Discord's
own stores and render their own UI — nothing is sent anywhere, and nothing here needs an API key,
a server, or a native module.

| Plugin | What it does |
| --- | --- |
| [CallWrapped](#callwrapped) | Turns every voice call into a report card: talk time, interruptions, dead air, and a timeline of who had the mic |
| [VoiceQualityHUD](#voicequalityhud) | A draggable overlay with live ping, jitter, packet loss and packet rates for the call you're in |
| [ReplyGraph](#replygraph) | Draws a channel's reply structure as a force-directed graph so you can untangle four conversations at once |

## Install

Vencord loads userplugins from a development checkout, so you need one:
[the official guide](https://docs.vencord.dev/installing/custom-plugins/) covers cloning and
building it.

```sh
git clone https://github.com/<you>/vencord-plugins.git
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

## A note on what these can see

All three only use data Discord has already handed the client: who is speaking in a call you're in,
your own connection stats, and the messages already loaded in a channel you're looking at. Nothing
leaves your machine — CallWrapped's saved reports and the HUD's position live in Vencord's local
IndexedDB.

CallWrapped does record when each person in a call spoke. That's derived from the same events that
make the green ring appear around someone's avatar, so it's nothing the call didn't already show
you — but it does persist it, so use your judgement about pasting a report into a server.

## License

GPL-3.0-or-later, same as Vencord.
