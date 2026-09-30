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

## The spine (proposed, confirm before code)

**The spine holds the data. Features hold none.** Why: [`INSIGHTS.md`](INSIGHTS.md).

Three tables. That's the whole backend core.

```
events                          the record: append-only, never edited
  id            uuid
  kind          text            namespaced: "note", "money.spend", "school.grade"
  occurred_at   timestamp       when it happened
  recorded_at   timestamp       when the app learned it
  payload       json            shape defined per kind, versioned
  source        text            "manual", "import:bank", "feature:hold-clock"
  source_ref    text  null      external id; (source, source_ref) unique, so re-imports are safe
  corrects      uuid  null      points at the event this one fixes; nothing is overwritten

sources                         the heartbeat
  name          text            matches events.source
  last_ok_at    timestamp
  expect_every  interval        if last_ok_at is older than this, the app says so

standard                        the user's own words; the app reads, never writes
  key, text, written_at
```

**Everything else is derived.** Current facts (Canon), totals, streaks and summaries are computed from `events` on read. If one is cached, the cache says `as_of` and can be thrown away.

### The rules
1. **Append-only.** No `UPDATE` or `DELETE` on `events`. A fix is a new event with `corrects`.
2. **Every value traces to a source.** Nothing without a source renders.
3. **One store.** No feature gets its own table, file, or localStorage key. A new table needs an entry in `DECISIONS.md`.
4. **Features are plugins.** A feature declares which `kind`s it writes and which it reads. Deleting a feature deletes code, never data.
5. **Payloads are versioned.** Changing a kind's shape means a new version, and readers handle both.

## Current phase
**Phase 0 — Foundation.** Get the spine working end to end before adding features.
