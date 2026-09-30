# CLAUDE.md

This repo is a rebuild. The goal is to keep the backend **small, stable, and on purpose**.
Good ideas are welcome — they just don't get built the moment they show up.

## Before doing anything
1. Read `docs/SPINE.md` — what the app is, the stack, the core data model, the current phase.
2. Read `docs/FEATURES.md` — what's being built **now**, and what's parked.
3. Before designing something new, check `docs/PAST.md`: the old build may have already tried it.
4. Read `docs/CHATS.md`: several chats work here in parallel. It says who owns what, and the rules for builders.

## Rules
- **Only build what's in `Now`** in `docs/FEATURES.md`. If a request isn't there, ask whether to move it in.
- **New idea mid-task?** Add one line to `Inbox` in `docs/FEATURES.md` and keep going. Don't build it.
- **Made a decision that's hard to undo** (database, auth, API shape, a library)? Add an entry to `docs/DECISIONS.md`.
- **Changed the data model or stack?** Update `docs/SPINE.md` in the same commit.
- **Features never get their own storage.** They write `events` and read derived views (see `docs/SPINE.md`). A new table needs a `docs/DECISIONS.md` entry.
- Keep `Now` to at most 3 items. Finish before starting more.
