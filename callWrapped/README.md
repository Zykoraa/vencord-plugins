# CallWrapped

A report card for every voice call: who talked how long, who interrupted whom, how much of it was
silence, and a timeline of the whole thing.

## How it works

Discord dispatches a `SPEAKING` event for every participant in your voice channel every time their
mic opens or closes — it's what draws the green ring around an avatar. The plugin records those
transitions as spans while you're in a call, and turns them into stats when you leave.

- `VOICE_CHANNEL_SELECT` starts and ends a session (joining, moving, hanging up)
- `VOICE_STATE_UPDATES` keeps the roster, so people who never spoke still show up
- `SPEAKING` opens and closes a span per user

Nothing is captured but *timing*. No audio is recorded or touched.

### The numbers

**Turns.** Raw spans are noisy — a single sentence can flicker the mic several times — so spans
less than 700 ms apart are merged into one turn. A turn under 1.5 s counts as a backchannel: the
"mhm", "yeah", "exactly" noises.

**Talk time** is the total length of a person's merged turns. **Dead air** is the part of the call
covered by nobody's turn, and **overlap** the part covered by two or more, both from a sweep over
span boundaries.

**Interruptions** need a definition, and the obvious one is wrong: people talk over each other
constantly without it meaning anything. Here, A interrupted B if A started while B still had the
mic, A kept going for at least 600 ms, *and B gave up within the interruption window* (2 s by
default). If B carries on regardless, A just overlapped and backed off — no interruption.

### Awards

| | |
| --- | --- |
| 🗣️ The Yapper | most talk time |
| 🎙️ Filibuster | longest single turn, if it beat 15 s |
| ✂️ The Interrupter | took the floor off people most often |
| 🚧 Steamrolled | got talked over most often |
| 💬 Backchannel | the most little sub-1.5 s noises |
| 🧊 Icebreaker | spoke first |
| 🔚 The Closer | had the last word |
| 👻 Ghost | was there the whole time and never said a word |

## Using it

When a call ends you get a notification; click it for the report. The Vencord toolbox has **Call
Wrapped: last call** and **Call Wrapped: history**, and **Copy as text** in the report turns it
into a paste-ready summary with ASCII bars.

## Settings

| Setting | Default | |
| --- | --- | --- |
| What to do when a call ends | notify | notification, open immediately, or nothing |
| Minimum call length | 60 s | shorter calls are dropped |
| Minimum people | 2 | counting you |
| Interruption window | 2 s | how fast someone has to give up the mic for it to count |
| Leave yourself out | off | |
| Leave bots out | on | |
| Reports to keep | 10 | stored in Vencord's local IndexedDB |

## Limitations

- Speaking state comes from Discord's own voice activity detection, so someone with an open mic and
  a loud fan registers as talking. That's the same signal the green ring uses.
- Only calls you were *in* are recorded, and only for as long as you were in them.
- A very long call with thousands of turns stops recording new spans at 40,000 to keep the saved
  report a sane size. The stats up to that point still stand.
- Reports are keyed by channel and start time, so rejoining the same channel makes a new report.
