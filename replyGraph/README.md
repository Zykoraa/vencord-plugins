# ReplyGraph

When a channel has four conversations interleaved, the reply arrows are there but you can't see the
shape of them. This draws it.

Click the graph button in the chat bar (or **Reply graph for this channel** in the Vencord toolbox)
and the messages loaded in the channel become a graph: one dot per message coloured by author, one
edge per reply.

## Reading it

- **Replies hang below what they answer.** A depth force pulls each node toward its reply depth, so
  a chain reads top to bottom instead of collapsing into a ball.
- **Dot size** grows with how many replies a message got. The ones with a ring are chain starters —
  they reply to nothing but got answered.
- **The sidebar** counts messages, replies and separate threads. Hovering an author dims everyone
  else, which is the fastest way to find "the conversation I was in".

Drag the background to pan, scroll to zoom, drag a dot to pull it out of the tangle, hover for the
author and text, and click a dot to jump to that message.

## Settings

| Setting | Default | |
| --- | --- | --- |
| Messages to consider | 200 | the most recent loaded messages; up to 500 |
| Include standalone messages | off | on also draws messages that neither reply nor were replied to |

## How it's built

The graph comes from `MessageStore.getMessages(channelId)` and each message's `messageReference`,
so it only ever sees what the client has already loaded — scroll up to load more history and reopen
it for a bigger picture.

Layout is a small force simulation written for this: pairwise repulsion, springs along the reply
edges, a depth force for the top-to-bottom reading order, and a weak pull toward the centre, cooled
over about 230 frames. At a few hundred nodes the O(n²) repulsion is nothing, so there's no
quadtree and no dependency.

## Limitations

- Only loaded messages count. A reply whose parent hasn't been loaded shows up as a chain start,
  not as a dangling edge.
- Thread messages live in their own channel, so a thread is its own graph.
- Blocked users' messages are skipped.
- With **include standalone messages** on, a busy channel is mostly unconnected dots — it's there
  for seeing how much of a channel is conversation versus people talking past each other.
