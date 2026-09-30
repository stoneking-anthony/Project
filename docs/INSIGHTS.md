# Insights: what the spine borrows, and from where

Reference, not required reading. Why the spine in `SPINE.md` looks the way it does.

## The question

Features keep arriving, and they're good. How do we add them forever without the backend turning to mush?

**Answer: the spine holds the data, and features hold none.** A feature is something that *writes records* or *reads records*. It can be added, rewritten, or deleted without touching storage, and deleting it loses nothing.

## Why the old builds overloaded

| | TheSystemHUD | brain repo |
|---|---|---|
| Where data lived | 52 `system.*` localStorage keys (75 call sites), `LEDGER.jsonl`, `Brain/stream/*.jsonl`, the Obsidian vault | Markdown files in git |
| Who owned the storage | **Every feature invented its own key.** 25 modules = 25 mini-backends | One tree, organized by life area |
| Result | Same fact in two places (two emergency funds). A 4,050-line `app.js` nobody could safely edit. | Append-only ledgers stayed correct. Hand-written summaries (`NOW.md`) went 15 days stale. |
| Reachable from | One Windows PC | Anywhere git works: PC, phone, Claude sessions |

**The root cause wasn't too many features. It was that each feature brought its own storage.** So each new idea made the backend bigger, and removing one was scary. `brain` got closer: one store, append-only logs. But plain markdown can't be queried or checked, and summaries that people have to rewrite by hand rot.

## What popular apps do (insight, not imitation)

| App | What it gets right | What we take | What we skip |
|---|---|---|---|
| **Apple Health (HealthKit)** | Every sample is `{type, value, unit, start, end, source}`. Many apps write to it and none of them own it. | **Provenance on every record, many writers into one store.** The closest real-world match to Canon. | Rigid built-in type catalog. |
| **Exist.io / Gyroscope** | Pull from integrations into one value per attribute per day, then compute correlations ("better mood on days you walk"). | **Integrations are just sources. Insights are computed, never typed in.** This is the old REMAKE's "pattern layer". | Dashboard-of-everything. |
| **Obsidian / Logseq** | Plain local files that outlive the app. A small core with a plugin API around it. | **Stable core + feature plugins that can't corrupt the core.** Data must survive the app. | Files as the database: no queries, no validation. |
| **Notion** | One primitive (a block with a type and properties) runs every feature. | **One generic record shape instead of a table per feature.** | Blank-canvas freedom: that's the overload. |
| **YNAB / Monarch / Copilot** | Bank imports dedupe by transaction ID; balances are computed; YNAB's four rules are a user-held method. | **Re-importing is safe (external IDs). Totals are derived. The user's rules sit above the numbers.** That's the Standard. | Manual categorizing of every item. |
| **Day One** | Capture is one tap; location, weather and time attach automatically. | **Capture stays cheap, and metadata is automatic.** | — |
| **Rewind / Limitless, Mem** | Capture everything, let AI find it later. | **Capture dumb, interpret on read.** The old STORAGE-SPEC found this independently. | Recording everything: privacy cost. |
| **Habitica / Duolingo** | Streaks and XP drive opens. Duolingo's streak freeze softens a miss. | Streak freeze = the old "ice-blue, no shame" law. | **XP, ranks, currencies: numbers computed from numbers.** Exactly what made the HUD feel fake. |
| **Git / bank ledgers** | Never edit history. Corrections are new entries. | **Append-only with corrections-as-events.** | — |

## The pattern all the durable ones share

1. **One store, many writers.** (HealthKit, Exist, a bank ledger)
2. **Every record says where it came from.** (HealthKit `source`, Plaid transaction IDs)
3. **History is never edited.** (Git, ledgers, brain's append-only files)
4. **Summaries are computed, not written.** (YNAB balances, Exist correlations)
5. **The user's intent sits above the data and is never overwritten by it.** (YNAB's rules; the old Standard)

The apps that went bloated or fake broke one of these. The old HUD broke 1, 2 and 4.
