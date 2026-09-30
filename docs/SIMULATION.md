# Spine simulation: what held, what broke

Run it with `python3 sim/spine_sim.py` (Python 3.11+, standard library only, fake data).

It runs 90 synthetic days through the three tables: notes, bank transactions, daily balance, weekday brokerage snapshots, workouts, grades, and one hold-clock item. It then attacks the design in 12 ways. The bank feed is killed on day 60 and the transaction format changes on day 45, both on purpose.

## What held

| Test | Result |
|---|---|
| Append-only | `UPDATE` and `DELETE` are **blocked by the database itself** (triggers), not by developer discipline. |
| Duplicate imports | The bank re-sends 3 days of overlap every morning. **295 duplicates skipped** automatically by `(source, source_ref)`. |
| Corrections | A wrong grade (76) fixed to 91: both rows kept, one live. History intact. |
| Deleting a feature | Removed `hold_clock`: **0 events lost**, the morning screen still works, and the leftover data is listed as "unread". |
| Two devices offline | Laptop 40 + phone 25 events, merged twice → exactly 65. Append-only + UUIDs means **syncing is just "copy rows you don't have"**. |
| Scale | Morning screen in **0.2 ms at 1 year, 0.3 ms at 1 million events** (321 MB). About 6 events/day means 20 years is 13 MB. |

## What broke

| # | Problem | What the sim showed | Fix |
|---|---|---|---|
| 1 | **A derived number lied** | Bank feed dead for 30 days, and the screen said `spend_30d: $0.00`. That's the old "confident fabrication" failure again. | A derived fact **inherits the freshness of its sources**. If one is stale, it shows `—`, not a number. |
| 2 | **Heartbeat false alarm** | Brokerage flagged STALE on a Sunday. Markets were closed. | Sources get a **schedule** (`weekdays 09:35`, `daily`), not just "every N hours". |
| 3 | **Correction conflict** | Phone and laptop both corrected the same transaction offline → 2 live versions → counted twice. | Rule: **latest `recorded_at` wins**. Losers stay in history and show up in a "conflicts" list. |
| 4 | **Old readers miss new data** | Format changed on day 45. A reader that only knew v1 reported **$2,078 spent instead of $3,049**. | **One upgrader per kind** turns old versions into the current shape before any feature sees them. Features only ever see the latest version. |
| 5 | **Typos create ghost data** | `money.tnx` written without error, invisible to every feature. | **Kind registry in code.** Writing an undeclared kind or an invalid payload is rejected. |
| 6 | **Wrong day** | An 11:30pm purchase stored as the next day. **44 of 532 events** (8%) had a different UTC date than local date. The old HUD shipped this exact bug. | Store `tz` with every event. Days are always bucketed in local time. |
| 7 | **Can't erase a secret** | A card number pasted into a note cannot be removed. A retraction hides it but the row keeps the text. | (a) **Block it at capture** (old HUD's rule: SSN pattern, Luhn-valid card numbers). (b) One audited escape hatch, `redact(id)`, the only thing allowed to change a row. It blanks the payload and logs that it did. |
| 8 | **Standard loses history** | (By design review, not sim.) `standard` is overwrite-by-key, so changing your north star erases the old one. | Make `standard` append-only too. Latest row wins. |

## What NOT to build

**Caching, snapshots, or a "read model" layer.** At 1 million events the whole morning screen takes 0.3 ms. Every number can be recomputed on every read, forever. That removes a whole category of stale-data bugs for free.

## Takeaway

The core idea survived everything: one append-only table, features own nothing, everything derived. What broke was the **edges**: freshness, versions, time zones, deletion. All of them are fixed with small rules, not new tables. The spine in `SPINE.md` is updated to v2 with these fixes.
