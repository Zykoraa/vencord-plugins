# CameraQualityLock

Your camera looks fine until someone fullscreens your Go Live. Then it drops to 320x180.

That isn't your bandwidth. When a viewer focuses your stream, their client shrinks your camera to a
thumbnail and tells Discord's server it only needs a thumbnail-sized feed. The server passes that on
as a "media sink wants" message, e.g. `{"9045":30}`, and your client rebuilds its encoder at
320x180 / ~156 kbps. When they un-focus the stream it asks for `100` again and you jump back to
720p. Discord's own logs show it plainly: `cpu limited: 0, bw limited: 0`, and the resolution
changes right after each request.

This plugin sets a minimum on those requests for **your outgoing camera only**. Go Live and other
people's video are untouched. A request for `0` (nobody is watching your camera) is left alone, so
you don't send video into the void.

## Settings

| Setting | Default | |
| --- | --- | --- |
| Lowest quality | 100 | 100 keeps 720p always. Drop it to 70 if your Go Live gets blurrier, since the camera now shares upload with it |
| Log requests | off | prints each request and what it was changed to in the console |

## The cost

Your camera keeps sending ~2.5 Mbps even while the viewer shows it as a thumbnail. On its own
that's nothing, but during Go Live it comes out of the same upload as the stream's up to 9 Mbps.

## How it's built

One patch on Discord's RTC connection class, found by the `Remote media sink wants` log string.
The plugin's `adjust` runs at the start of `_handleMediaSinkWants`. For the `default`
connection (your camera, not `stream`), it raises every per-SSRC value between 1 and the minimum
up to the minimum. It returns a copy, and `any` and `pixelCounts` pass through unchanged.
