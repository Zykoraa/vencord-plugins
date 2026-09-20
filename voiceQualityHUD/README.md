# VoiceQualityHUD

Discord tells you your ping. It doesn't tell you why someone sounds like a fax machine.

A small floating panel that polls Discord's own `RTCConnectionStore` once a second while you're in
a call and shows what it finds.

## What's on it

- **Ping**, big, with a sparkline of the last 90 samples and the average, min and max underneath
- **Jitter** — the mean change between consecutive ping samples. This is the number that matters
  and the one Discord never shows you: a flat 80 ms sounds fine, while 40 ms bouncing to 200 ms is
  what actually breaks audio.
- **Loss out** — Discord's own figure for your upstream
- **Loss in** — derived from the packet counters, lost / (received + lost) since the call connected
- **Packet rates** in and out, per second, from the deltas between samples
- Call duration, peer count, and the voice server hostname Discord picked for the call
- A status dot that goes amber past 1% loss or 150 ms ping, red past 5% loss or when Discord itself
  rates the connection as bad

## Using it

It appears when you join a call and goes away when you leave. Drag the header to move it (the
position is remembered), double-click the header or hit the chevron to collapse it to just ping and
loss, and the ✕ hides it until the next call. **Voice Quality HUD: show/hide** in the Vencord
toolbox brings it back.

## Settings

| Setting | Default | |
| --- | --- | --- |
| Sample interval | 1000 ms | 250 ms for a twitchier graph, 5 s to barely touch anything |
| Keep it on screen when idle | off | otherwise it only shows during calls |

## How it's built

No webpack patches. The plugin mounts its own React root on `document.body` and reads
`RTCConnectionStore` — `getLastPing`, `getAveragePing`, `getOutboundLossRate`, `getPacketStats`,
`getQuality`, `getHostname`, `getUserIds` — through a wrapper that swallows errors and renders `—`
for anything missing. A Discord update can change what those return, but it can't break the plugin
the way a stale patch regex can.

Ping history is kept per RTC connection and cleared when the connection id changes, so numbers from
the last call never bleed into the next one.

## Limitations

- Everything here is connection-level, not per-user. Discord's client doesn't expose per-participant
  inbound stats to the web layer, so the HUD can't tell you *which* person's audio is suffering.
- Inbound loss is cumulative since the call connected, so a bad patch early on keeps dragging the
  number up. The packet rates and jitter are what to watch live.
- The voice server hostname is where Discord routed you, which is a decent proxy for region but not
  a guarantee.
