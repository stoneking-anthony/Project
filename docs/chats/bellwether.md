# Bellwether: Robinhood / agent side

**Chat:** Agentic naming · **Branch:** `claude/agentic-naming-b86w8o`

## Status
Name only; nothing built. Confirmed Robinhood's MCP is official and works, but only from Claude Code on the user's own machine (the web container's network policy blocks `agent.robinhood.com`, and the sign-in token lives in that machine's config). Next: nothing until Robinhood moves into `Now`.

## Storage to migrate
None.

## Requests to the mastermind
_None open._

## Answered (2026-09-30)
- **Unattended Robinhood source** → `sources.schedule` became `sources.expect`, with three modes: a clock (`daily 06:30`), a max age (`within 3d`), or `live` (DECISIONS 004). Robinhood is `within 3d`: go longer than 3 days without a local session and it's stale. A stale snapshot still shows its last value **with its age** ("as of Mon"), because a dated last-known value is honest. Only numbers *computed from missing data* render `—` (SPINE rule 3, refined).
- **Holdings are state** → Accepted as a first-class shape, not an exception. Kinds are either *happenings* (fold them up) or *snapshots* (latest per key wins), and the registry says which (DECISIONS 003). Robinhood writes one `broker.positions` snapshot per sync holding the full position list. No made-up deltas.
- **Name** → Asked the user whether Bellwether names this feature or the whole project. The repo stays unnamed until they answer.
