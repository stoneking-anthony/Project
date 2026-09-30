# Decisions

Short log of choices that are hard to undo. Newest at the bottom.

<!--
## NNN — Title (YYYY-MM-DD)
**Decision:** what we picked
**Why:** the reason, in a sentence or two
**Instead of:** what we didn't pick
-->

## 001 — One installable web app (2026-09-30)
**Decision:** The app is a web app that can be installed on a phone's home screen. It runs the same on the laptop now, the main PC later, and the phone for the morning check.
**Why:** The old HUD was a Windows-only desktop app, so it became unusable the moment the PC was away.
**Instead of:** A Windows desktop app (the old HUD's C# WinForms + WebView2).

## 002 — One mastermind chat, many builder chats (2026-09-30)
**Decision:** The "Backend vibranium spine" chat owns the spine, decisions, and feature order. Other chats each build one feature and coordinate through `docs/CHATS.md` on `main`.
**Why:** Chats can't see each other. Without one owner, each chat invents its own storage and server. That had already started: Atlas and Compass each have both.
**Instead of:** Every chat deciding architecture for itself.

## 003 — Kinds: named by domain, two shapes (2026-09-30)
**Decision:** Event kinds are named by domain (`stock.watch`), never by feature (`atlas.watch`). Each kind is either a *happening* (views fold them) or a *snapshot* (latest per key wins). The registry in `SPINE.md` says which.
**Why:** Features are deletable and their data must outlive them. Broker holdings, a day's plan, and a workout split are state, not streams, and pretending otherwise means making up deltas.
**Instead of:** Feature-prefixed kinds; forcing every kind into a stream of changes.

## 004 — Three kinds of source: scheduled, max-age, live (2026-09-30)
**Decision:** `sources.expect` is a clock, a max age (`within 3d`), or `live`. Live sources (Google Calendar, SEC EDGAR) are read on demand and never copied; only their errors are tracked.
**Why:** Import what can vanish or change without history (bank balances, broker positions). Read live what another system already keeps with its own history. Copying it makes a second store.
**Instead of:** Importing everything; clock-only schedules (Robinhood only syncs when a local session is open).

## 005 — Chat turns are events (2026-09-30)
**Decision:** Every chat feature records `chat.turn` events with the full Claude content array. Conversations are derived from them.
**Why:** Conversations are part of the record, and chat history currently dies on every server restart. Replaying needs the full content blocks.
**Instead of:** Server memory; per-feature chat stores. Size is watched: web search results make turns large, and the Supabase free tier is 500 MB. Check after the first two weeks.

## 006 — Auth before any personal data (2026-09-30)
**Decision:** Supabase Auth, one allowed user (email magic link). Every API route requires a session. Row-level security on all three tables.
**Why:** Once chat turns and plans are stored, the API holds personal data, and right now `/api/chat` is open to anyone who finds the URL.
**Instead of:** No auth on a personal server.

## 007 — One app, shared shell (2026-09-30)
**Decision:** One Node server. Layout: `app/server.js`, `app/lib/` (`spine.js`, `claude.js`, `auth.js`, `views/`), `app/public/` (shell + shared design tokens), `app/features/<name>/` (routes, prompt, UI). One Claude client in `app/lib/claude.js`; the default model is set once in `app/config.js`, and a feature may override it by env var.
**Libraries:** `@anthropic-ai/sdk` (Claude), `marked` + `dompurify` (render model Markdown safely), `fast-xml-parser` (SEC filings), `node-ical` (calendar), `@supabase/supabase-js` (spine + auth).
**Why:** Atlas and Compass already duplicate the server, the Claude client, and the design tokens.
**Instead of:** One server per feature (ports 3000, 3001, …).

## 008 — `standard` holds any user-written text (2026-09-30)
**Decision:** `standard` stores anything the user wrote as a rule for the app, any length, by key (`north_star`, `planner.rules`). Append-only; latest per key wins. Only the user writes it.
**Why:** Compass's planning rules are exactly this: the user's words, read by the app, never edited by it. They run to several lines.
**Instead of:** One sentence only; rules buried in prompt files.
