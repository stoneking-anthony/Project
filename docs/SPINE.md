# Spine

The one page that says what this backend is. If it isn't here, it isn't core.

## What the app does
> **A private record of a life, kept honestly, that argues with me toward something I chose.**
> Remember. Warn. Argue. (Draft, carried over from the old build's `REMAKE.md`. Confirm or rewrite.)

History and lessons: [`PAST.md`](PAST.md).

## Stack
| Layer | Choice | Why |
|---|---|---|
| Language / runtime | TODO | Old build: C# WinForms + WebView2, local-only |
| API style (REST / GraphQL / RPC) | TODO | |
| Database | TODO | |
| Auth | TODO | |
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
  schedule      text            "daily 06:30", "weekdays 09:35", "weekly"

standard                        the user's own words; append-only; latest row per key wins
  key, text, written_at         the app reads, never writes
```

**Everything else is derived on read**: current facts (Canon), totals, streaks, summaries. No caches. At 1M events a full screen computes in under a millisecond.

### The rules
1. **Append-only.** Database triggers block `UPDATE`/`DELETE` on `events` and `standard`. A fix is a new event with `corrects`.
2. **One escape hatch.** `redact(id)` blanks a payload and logs that it did. Nothing else may change a row. Secrets (SSN patterns, card numbers) are blocked at capture so it's rarely needed.
3. **Every value traces to a source, and inherits its freshness.** If a source feeding a number is stale, the number renders as `—`.
4. **One store.** No feature gets its own table, file, or localStorage key. A new table needs an entry in `DECISIONS.md`.
5. **Features are plugins.** Each declares the kinds it writes and reads. Undeclared kinds are rejected. Deleting a feature deletes code, never data.
6. **One upgrader per kind.** Old payload versions are converted to the current shape before any feature reads them.
7. **Time is local.** Store UTC plus `tz`. Never bucket days in UTC.

## Current phase
**Phase 0 — Foundation.** Get the spine working end to end before adding features.
