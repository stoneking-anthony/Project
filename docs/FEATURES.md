# Features

Ideas flow **Inbox → Next → Now → Done**. Only `Now` gets built.

## Now (max 3)
- [ ] **Atlas**: stock analyst chat. On the spine in `app/features/atlas/`; its chat continues from there
- [ ] **Compass**: daily planner. On the spine in `app/features/compass/`, reading `brain`; its chat continues from there

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
- **Spine + shell** (2026-10-01): three tables with database-enforced append-only, kind registry, heartbeat, password login, one server and Claude client, installable on a phone. Atlas and Compass moved onto it. 50 tests.
