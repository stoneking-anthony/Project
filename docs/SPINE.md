# Spine

The one page that says what this backend is. If it isn't here, it isn't core.

## What the app does
> **A private record of a life, kept honestly, that argues with me toward something I chose.**
> Remember. Warn. Argue. (Draft, carried over from the old build's `REMAKE.md`. Confirm or rewrite.)

History and lessons: [`PAST.md`](PAST.md).

## Stack
| Layer | Choice | Why |
|---|---|---|
| Language / runtime | Node 22, plain HTML/CSS/JS, no build step (proposed) | Atlas and Compass already use it. Old build: C# WinForms, Windows-only |
| API style | JSON over HTTP; chat replies stream as server-sent events | Atlas and Compass already do this |
| Database | Postgres via Supabase (proposed) | Same data on laptop, PC and phone |
| Auth | TODO | |
| App type | Installable web app (see DECISIONS 001) | |
| Hosting | TODO | |

## The spine (v2, proposed, confirm before code)

**The spine holds the data. Features hold none.** Why: [`INSIGHTS.md`](INSIGHTS.md). Stress-tested in [`SIMULATION.md`](SIMULATION.md).

Three tables. That's the whole backend core.

```
events                          the record: append-only, enforced by the database
  id            uuid
  kind          text            registered in code: "note", "money.txn", "school.grade"
  v             int             payload version for that kind
  occurred_at   timestamptz     when it happened (UTC)
  tz            text            where it happened, e.g. "America/New_York"; days bucket in local time
  recorded_at   timestamptz     when the app learned it
  payload       json            validated against the kind's schema on write
  source        text            "manual", "import:bank", "feature:hold-clock"
  source_ref    text  null      external id; (source, source_ref) unique, so re-imports are safe
  corrects      uuid  null      the event this one replaces; latest recorded_at wins

sources                         the heartbeat (the only mutable table: it's machinery, not record)
  name          text            matches events.source
  last_ok_at    timestamptz     last successful run, even if it found nothing new
  last_error    text  null
  expect        text            a clock: "daily 06:30", "weekdays 09:35"
                                a max age: "within 3d" (e.g. needs a local session)
                                or "live": read on demand, never stored; only errors are tracked

standard                        the user's own words, any length; append-only; latest row per key wins
  key, text, written_at         the user writes; the app and Claude only read
```

**Everything else is derived on read**: current facts (Canon), totals, streaks, summaries. No caches. At 1M events a full screen computes in under a millisecond.

### The rules
1. **Append-only.** Database triggers block `UPDATE`/`DELETE` on `events` and `standard`. A fix is a new event with `corrects`.
2. **One escape hatch.** `redact(id)` blanks a payload and logs that it did. Nothing else may change a row. Secrets (SSN patterns, card numbers) are blocked at capture so it's rarely needed.
3. **Every value traces to a source, and inherits its freshness.** A last-known value from a stale source shows **with its age** ("as of Mon"). A number *computed over* a stale source's window (a total, an average, a count) renders `—`, because it would silently assume nothing happened.
4. **One store.** No feature gets its own table, file, or localStorage key. A new table needs an entry in `DECISIONS.md`.
5. **Features are plugins.** Each declares the kinds it writes and reads. Undeclared kinds are rejected. Deleting a feature deletes code, never data.
   Kinds are named by **domain** (`stock.watch`), never by feature (`atlas.watch`), because the data outlives the feature.
6. **One upgrader per kind.** Old payload versions are converted to the current shape before any feature reads them.
7. **Time is local.** Store UTC plus `tz`. Never bucket days in UTC.

### Kind registry

Only kinds a `Now` feature needs are registered. Builders request new ones in their `docs/chats/` file.

**Happening**: something occurred; views fold them up. **Snapshot**: the full current state; the latest per key wins.

| Kind | Shape | Payload (v1) | Written by |
|---|---|---|---|
| `note` | happening | `{text}` | Stream |
| `chat.turn` | happening | `{conversation_id, feature, role, content}` (`content` = the full Claude content array) | any chat feature |
| `stock.watch` / `stock.unwatch` | happening | `{ticker}` | Atlas |
| `insider.track` / `insider.untrack` | happening | `{name, cik?}` | Atlas |
| `stock.rating` | happening | `{ticker, rating, target, price, price_as_of, conviction}` | Atlas |
| `plan.set` | snapshot, key = `date` | `{date, priorities: [text], blocks: [{start, end, label}]}` | Compass |
| `plan.priority_done` | happening | `{date, priority, done}` | Compass |
| `workout.split_set` | snapshot, one key | `{days: {mon..sun: {type, focus} or null}}` | Compass |
| `workout.done` | happening | `{type, minutes, note?}` | Compass, later a workout feature |
| `broker.positions` | snapshot, key = `account` | `{account, positions: [{symbol, shares, avg_cost}]}` | Bellwether (not yet) |

**Registered sources:** `manual` · `gcal` (live) · `sec-edgar` (live) · `import:robinhood` (within 3d, not yet)

**Standard keys:** `north_star` · `planner.rules`

**Two words that sound alike:** *confidence* (spine) = how sure we are a number is true (`verified` / `estimated` / `stale`, derived from the source). *Conviction* (Atlas) = how strongly an analysis believes a call. It's an opinion, stored inside `stock.rating`.

## Current phase
**Phase 0 — Foundation.** Get the spine working end to end before adding features.
