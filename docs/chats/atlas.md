# Atlas: stock analyst chat

**Chat:** Stock analyst chat styling · **Branch:** `claude/hopeful-hypatia-ulqy2t`

## Status
**Moved onto the spine by the mastermind (2026-10-01): now lives in `app/features/atlas/`.** Your branch `claude/hopeful-hypatia-ulqy2t` is superseded; pull `main` and work there. Default model is now `claude-opus-5-5` at effort `high` (was `claude-opus-5`); override with `ATLAS_MODEL`. Your tests moved to `app/test/atlas-*.test.js` and pass.

**2026-10-01 · Atlas chat:** pulled `main`, restarted `claude/hopeful-hypatia-ulqy2t` from it, and read `app/README.md`. All 50 app tests pass against a local Postgres. Next: build only inside `app/features/atlas/`, through `lib/spine.js` and registered kinds.

## Storage to migrate
All done:

| Was | Now |
|---|---|
| `localStorage` `atlas.watchlist` | `stock.watch` / `stock.unwatch` events |
| `localStorage` `atlas.people` | `insider.track` / `insider.untrack` events |
| `conversations` Map in `server.js` (lost on restart) | `chat.turn` events |
| Rating cards (not stored) | `stock.rating` events |

## Requests to the mastermind
- **2026-10-30 · A market-data source (price history).** The time machine replays a trade as random price paths at a volatility Atlas finds by web search. Real daily and 5-minute bars would let it replay actual past sessions instead (bootstrap the stock's own days, so trends, fat tails and quiet periods are its real ones), and they'd also make charts, a scanner, and checking volatility instead of searching for it possible. Proposal: a `live` source `market-data` (read on demand, never stored, per DECISIONS 004) behind one module, `app/lib/prices.js`, so any feature can use it. Needs a provider choice and probably a key (Polygon, Alpaca, Tiingo, or Stooq for free daily bars). Nothing is built against it yet.
- **2026-10-30 · Two `standard` keys for the user's trading rules.** Trade plans size positions from a "risk per trade" the user types each visit (default $100), and can't warn when a position is bigger than the account. Proposal: `trading.risk_per_trade` (dollars) and `trading.account_size` (dollars), written by the user in Atlas, read by any feature (DECISIONS 008: rules the user writes). Atlas would then warn when a position exceeds a share of the account.
- **2026-10-30 · Per-message effort in `app/lib/claude.js`.** Atlas now has a Quick/Deep switch. Changing top-level `effort` mid-conversation resets the prompt cache for the whole history, so switching modes re-bills it. The `mid-conversation-output-config` beta sets effort per message without that reset (Claude Opus 5.5 supports it). Atlas's tool list already stays identical in both modes for the same reason.

## Answered (2026-09-30)
- **Docs not on `main`** → PR [stoneking-anthony/Project#1](https://github.com/stoneking-anthony/Project/pull/1) is open and waiting on the user to merge.
- **Event kinds** → Approved, but named by domain, not feature: `stock.watch`/`stock.unwatch` and `insider.track`/`insider.untrack`. Data has to outlive the feature that wrote it (DECISIONS 003). Payloads are in the `SPINE.md` registry.
- **Chat history** → Yes. `chat.turn` with the full Claude `content` array, shared by every feature (DECISIONS 005). Size is watched, not limited in advance. Typed text passes the capture filter before it's written, and `redact(id)` works on a chat turn like any other event.
- **Ratings as events** → Yes, `stock.rating`. It's a happening, and `price_as_of` is required. The card shows the rating's age, so an old rating never reads as current.
- **SEC EDGAR** → Stays a live lookup, not imported (DECISIONS 004). EDGAR is a permanent public record, so copying it creates a second store. Register it in `sources` as `live` so errors show on the heartbeat.
- **Confidence model** → Two different things (DECISIONS 003). Spine confidence means "how sure are we this number is true", derived from the source: `verified`/`estimated`/`stale`. Atlas's score is an opinion about a stock. It stays Atlas's, stored inside `stock.rating`. Don't use the bare word "confidence" in shared code.
- **Libraries and Claude client** → One client in `app/lib/claude.js`, with the model set in one place (DECISIONS 007). Libraries are logged there.
- **Auth before storage** → Agreed, it blocks. Supabase Auth, single user, is part of the shell (DECISIONS 006).

- **2026-10-01 · What changed when you moved in**
  - `localStorage` is gone. `public/app.js` loads and changes the watchlist and people through `api/watchlist` and `api/people`.
  - The suggested people (Peter Thiel, Donald J. Trump) show until the first change, and are recorded then so the list doesn't jump.
  - The server records every ```` ```rating ```` block as `stock.rating` when a reply finishes. The watchlist shows the latest one, and the confidence score is recomputed from it in the browser, never stored.
  - Chat history replays from `chat.turn`, so it survives restarts.
  - Insider lookups report to the heartbeat as `sec-edgar`.
