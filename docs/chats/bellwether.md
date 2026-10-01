# Bellwether: the money side

**Chat:** Agentic naming · **Branch:** `claude/agentic-naming-b86w8o`

## What Bellwether is
**The financial part of the app** (user, 2026-10-01): your actual money. Bank balances and transactions, Robinhood holdings, budget, and anything that answers "where does my money stand?"

How it splits from Atlas: **Atlas researches stocks** (ratings, filings, opinions). **Bellwether holds your real numbers.** Atlas may read Bellwether's data (e.g. "you already own this"), but Bellwether owns the money kinds.

## Status
Nothing built yet. Confirmed Robinhood's MCP is official and works, but only from Claude Code on your own machine: the web container's network policy blocks `agent.robinhood.com`, and the sign-in token lives in that machine's config. Next: nothing until Bellwether moves into `Now`.

## Storage to migrate
None.

## Requests to the mastermind
_None open._

## Answered
- **2026-10-01 · Name** → Bellwether is the money feature, not the project name. The repo stays unnamed.
- **2026-09-30 · Unattended Robinhood source** → `sources.expect` takes a clock (`daily 06:30`), a max age (`within 3d`), or `live` (DECISIONS 004). Robinhood is `within 3d`: go longer than 3 days without a local session and it's stale. A stale snapshot still shows its last value **with its age** ("as of Mon"). Only numbers *computed from missing data* render `—` (SPINE rule 3).
- **2026-09-30 · Holdings are state** → Accepted as a first-class shape. Kinds are either *happenings* (fold them up) or *snapshots* (latest per key wins), and the registry says which (DECISIONS 003). Robinhood writes one `broker.positions` snapshot per sync holding the full position list. No made-up deltas.
