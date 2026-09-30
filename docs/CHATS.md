# Chats

Several Claude chats work on this repo. They can't see each other, but they all read this repo, so **this folder is how they talk.**

## Roles

**Mastermind: the "Backend vibranium spine" chat.** Owns `SPINE.md`, `DECISIONS.md`, `FEATURES.md`, and this file. Decides how features fit together.

**Builders: every other chat.** Each builds one feature. A builder:
1. **Starts from `main`** and runs `git pull origin main` before each work session, so it sees the latest spine.
2. **Owns one file: `docs/chats/<feature>.md`.** Status, next step, storage to migrate, and requests to the mastermind all go there. Builders never edit another chat's file, or this one. That way two chats never touch the same lines, and merges don't conflict.
3. **Stores nothing of its own.** Data goes through the spine (`events`). Until the spine exists, keep temporary storage as it is and list it in your file.
4. **Doesn't edit `SPINE.md` or `DECISIONS.md`.** Put a request in your file and keep going.
5. **Uses only kinds from the registry in `SPINE.md`.** Need a new one? Request it.
6. **Updates its file** at the end of each session.

The mastermind answers requests by changing `SPINE.md`/`DECISIONS.md`, then moves each request to *Answered* in the builder's file with a pointer to the answer.

## Chats

| Chat | Feature | Branch | File |
|---|---|---|---|
| Backend vibranium spine | Mastermind | `claude/serene-edison-rx2la6` | this file |
| Stock analyst chat styling | **Atlas**: stock analyst chat | `claude/hopeful-hypatia-ulqy2t` | [`chats/atlas.md`](chats/atlas.md) |
| Daily planning chat dashboard | **Compass**: daily planner | `claude/busy-pasteur-ke2d53` | [`chats/compass.md`](chats/compass.md) |
| Agentic naming | **Bellwether**: Robinhood / agent side | `claude/agentic-naming-b86w8o` | [`chats/bellwether.md`](chats/bellwether.md) |

## Order of work

1. **Mastermind** builds the shell: `app/server.js`, `app/lib/spine.js` (write/read + kind registry), `app/lib/claude.js`, auth, shared design tokens. See `DECISIONS.md` 007.
2. **Atlas and Compass** each move into `app/features/<name>/` and switch their storage to the kinds assigned in `SPINE.md`. Nothing moves until step 1 lands on `main`.
3. **Bellwether** waits until Robinhood moves into `Now`.

## Merging `main` into your branch

This file was restructured on 2026-09-30. If `git pull origin main` conflicts on `docs/CHATS.md`, **take `main`'s version**. Your registry row and requests have already been moved into your file under `docs/chats/`.
