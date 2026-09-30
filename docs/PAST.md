# Past attempts

Two earlier repos hold the history of this app. They are **reference only**: read them for ideas and lessons, and don't copy their code or structure over wholesale.

| Repo | What it was | Read first |
|---|---|---|
| [`stoneking-anthony/TheSystemHUD`](https://github.com/stoneking-anthony/TheSystemHUD) (private) | The previous build. C# WinForms + WebView2 desktop app over a local web UI, backed by an Obsidian vault. 25 JS modules, ~35 design docs. | `REMAKE.md` (the concept), `SALVAGE.md` (what to keep), `INDEX.md` (map of the rest) |
| [`stoneking-anthony/brain`](https://github.com/stoneking-anthony/brain) (private) | The personal data store: plain markdown the app and Claude sessions both read. | `CLAUDE.md` (how it's organized and why) |

> **Privacy:** this repo is public; `brain` is private because it holds personal data. Nothing from `brain` gets copied here. Point to it; don't paste from it.

## What the old build learned

1. **It started far more than it finished.** 25 modules and 14 screens, while the one piece that saved real data had two lines of code. This is the reason `FEATURES.md` caps `Now` at 3.
2. **Record first, everything else later.** Captured data is the only thing that can't be rebuilt. Scores, summaries, and AI answers can all be recomputed from it later.
3. **Keep one store.** Most real bugs were one fact living in two places (the app once tracked two different emergency funds for the same account).
4. **No invented numbers.** Every number on screen must trace to something outside the app. Momentum, ranks, and relics were computed from other app-made numbers, and the whole thing felt fake.
5. **Derived, not authored.** Hand-written summaries went stale (a "read this first" file was 15 days old). Anything that summarizes should be recomputed from the source.
6. **Hiding isn't deleting.** Six compression passes made screens quieter but kept everything, and the result still felt wrong. Cutting features works; hiding them doesn't.
7. **Docs cost tokens too.** Reading every design doc cost ~74k tokens per session. Keep the docs a new session must read short, and let old ones be grepped rather than read.

## The architecture it arrived at (REMAKE.md)

Six layers. Nothing above the line may write below it.

```
6  Surface     two zoom levels, never three
5  Voice       one assistant, returns {verdict, facts, because, next, hedge}
4  Gap         distance between the standard and the truth
── value / fact boundary ──
3  Standard    one sentence the user writes; the app can read it, never change it
2  Canon       current facts, each with source, confidence, previous value, as-of date
1  Ground      append-only raw record, never edited
```

## Ideas worth salvaging

These are candidates for `FEATURES.md`, not commitments. Source file in the old repo in brackets.

- **Stream / journal**: free-text capture that lands in the permanent record [`journal.js`, `stream.js`, `STORAGE-SPEC.md`]
- **Canon**: named facts with source + confidence + previous value [`canon.js`, `ARCHITECTURE.md`]
- **Confidence on every number**: no source means it doesn't render [`honesty.js`, `FRESHNESS-SPEC.md`]
- **Standard / Cornerstone**: one user-written value the app can't edit [`anchor.js`, `G1-SPEC.md`]
- **Overseer / Reckoning**: a counter-metric that is allowed to say "this doesn't matter" [`anchor.js`]
- **Condenser**: every answer comes back as a structure (one call + why + branches), not prose [`ludus.js`, `LUDUS-SPEC.md`]
- **Hold clock**: wait N days before a purchase [`warren.js`]
- **The Record**: a printable proof page of what actually happened [`proof.js`]
- **Heartbeat**: the app says when its own pipelines stopped running [`REMAKE.md` §6]

## Laws carried over

- No shame states: misses are stated once, quietly, and never in red.
- Never fake the numbers.
- No new daily input burden: parse from what already exists.
- The app never rewrites a file a human wrote; it only appends to its own.
