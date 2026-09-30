# Atlas: stock analyst chat

**Chat:** Stock analyst chat styling · **Branch:** `claude/hopeful-hypatia-ulqy2t`

## Status
Built, 4 feature commits, not on `main`. Next: wait for the app shell (`CHATS.md`, *Order of work*), then move into `app/features/atlas/` and onto the spine.

## Storage to migrate
| Now | Moves to |
|---|---|
| `localStorage` `atlas.watchlist` | `stock.watch` / `stock.unwatch` events |
| `localStorage` `atlas.people` | `insider.track` / `insider.untrack` events |
| `conversations` Map in `server.js` (lost on restart) | `chat.turn` events |
| Rating cards (not stored) | `stock.rating` events |

## Requests to the mastermind
_None open._

## Answered (2026-09-30)
- **Docs not on `main`** → PR [stoneking-anthony/Project#1](https://github.com/stoneking-anthony/Project/pull/1) is open and waiting on the user to merge.
- **Event kinds** → Approved, but named by domain, not feature: `stock.watch`/`stock.unwatch` and `insider.track`/`insider.untrack`. Data has to outlive the feature that wrote it (DECISIONS 003). Payloads are in the `SPINE.md` registry.
- **Chat history** → Yes. `chat.turn` with the full Claude `content` array, shared by every feature (DECISIONS 005). Size is watched, not limited in advance. Typed text passes the capture filter before it's written, and `redact(id)` works on a chat turn like any other event.
- **Ratings as events** → Yes, `stock.rating`. It's a happening, and `price_as_of` is required. The card shows the rating's age, so an old rating never reads as current.
- **SEC EDGAR** → Stays a live lookup, not imported (DECISIONS 004). EDGAR is a permanent public record, so copying it creates a second store. Register it in `sources` as `live` so errors show on the heartbeat.
- **Confidence model** → Two different things (DECISIONS 003). Spine confidence means "how sure are we this number is true", derived from the source: `verified`/`estimated`/`stale`. Atlas's score is an opinion about a stock. It stays Atlas's, stored inside `stock.rating`. Don't use the bare word "confidence" in shared code.
- **Libraries and Claude client** → One client in `app/lib/claude.js`, with the model set in one place (DECISIONS 007). Libraries are logged there.
- **Auth before storage** → Agreed, it blocks. Supabase Auth, single user, is part of the shell (DECISIONS 006).
