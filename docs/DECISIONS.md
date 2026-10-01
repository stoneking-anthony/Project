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
**Decision:** ~~Supabase Auth, one allowed user (email magic link).~~ *(Superseded by 010.)* Every API route requires a session.
**Why:** Once chat turns and plans are stored, the API holds personal data, and right now `/api/chat` is open to anyone who finds the URL.
**Instead of:** No auth on a personal server.

## 007 — One app, shared shell (2026-09-30)
**Decision:** One Node server. Layout: `app/server.js`, `app/lib/` (`spine.js`, `claude.js`, `auth.js`, `views/`), `app/public/` (shell + shared design tokens), `app/features/<name>/` (routes, prompt, UI). One Claude client in `app/lib/claude.js`; the default model is set once in `app/config.js`, and a feature may override it by env var.
**Libraries:** `@anthropic-ai/sdk` (Claude), `marked` + `dompurify` (render model Markdown safely), `fast-xml-parser` (SEC filings), `node-ical` (calendar), `pg` (Postgres). *(Was `@supabase/supabase-js`; see 011.)*
**Why:** Atlas and Compass already duplicate the server, the Claude client, and the design tokens.
**Instead of:** One server per feature (ports 3000, 3001, …).

## 008 — `standard` holds any user-written text (2026-09-30)
**Decision:** `standard` stores anything the user wrote as a rule for the app, any length, by key (`north_star`). *(Planner rules moved to `brain`, see 009.)* Append-only; latest per key wins. Only the user writes it.
**Why:** Compass's planning rules are exactly this: the user's words, read by the app, never edited by it. They run to several lines.
**Instead of:** One sentence only; rules buried in prompt files.

## 009 — Rules the user already wrote are read from `brain`, not retyped (2026-10-01)
**Decision:** The planner reads the user's fixed week and training split live from the private `brain` repo (`SCHEDULE.md`, `body/gym.md`) using a read-only GitHub token kept in `.env`. Shifts and classes that move come from Google Calendar. `planner.rules` is no longer a `standard` key; `standard` keeps only rules typed into the app itself.
**Why:** These rules already exist, the user maintains them there, and they're personal. Copying them into the app makes a second store, and putting them in a prompt file would publish them, because this repo is public. `brain` files carry `updated:` dates, so freshness works for free: a file older than ~10 days shows as a claim, not a fact.
**Instead of:** A setup form; `standard` rows; rules in `prompts/daily-planner.md`.

## 010 — Login is one password and a signed cookie (2026-10-01)
**Decision:** `APP_PASSWORD` (at least 12 characters) signs you in. The server sets an HttpOnly, SameSite=Lax session cookie for 30 days, signed with a key derived from the password, so changing the password signs every device out. Five wrong tries lock an address for 15 minutes. Cross-site POSTs are refused.
**Why:** There is one user. A password works with any host and any database, needs no email round-trip, and has no third party in the login path. Row-level security isn't needed because only the server ever holds database credentials.
**Instead of:** Supabase Auth magic links (006), passkeys (more setup than one user needs right now).

## 011 — Hosting: Render runs the server, Supabase holds Postgres (2026-10-01)
**Decision:** `render.yaml` deploys `app/` from `main` on every push. The database is Supabase Postgres, reached with plain `pg` through the session pooler. The schema applies itself on start.
**Why:** The user has no computer free to run a server. Both can be set up from a phone browser and start free. Plain Postgres keeps the app portable: any Postgres host works by changing `DATABASE_URL`.
**Instead of:** Running on the laptop (not available); `supabase-js` (ties data access to one vendor). Known cost: Render's free plan sleeps after 15 idle minutes, so the first open after that takes about a minute. The $7/month plan doesn't sleep.
