# Features

Ideas flow **Inbox → Next → Now → Done**. Only `Now` gets built.

## Now (max 3)
- [ ] **Spine + shell**: the three tables, `app/lib/spine.js` with the kind registry, auth, the shared server and Claude client (mastermind chat; DECISIONS 006, 007)
- [ ] **Atlas**: stock analyst chat (its own chat; built on its own branch, needs to move onto the spine)
- [ ] **Compass**: daily planner (its own chat; built on its own branch, needs to move onto the spine)

## Next
_Ordered. Top item moves into `Now` when a slot opens._

1. Stream: free-text capture into the permanent record

## Inbox
_Dump ideas here, one line each, no judgment. Sort them later._

- Bellwether: the money side. Bank, Robinhood (agent tools, needs local Claude), budget. See `docs/chats/bellwether.md`
- Canon: current facts with source, confidence, previous value
- Confidence required on every number
- Standard: one user-written sentence the app can't edit
- Overseer: counter-metric that can say "doesn't matter"
- Condenser: structured answers (call + why + branches)
- Hold clock before purchases
- The Record: printable proof page
- Heartbeat: app reports when its own pipelines stop

## Done
