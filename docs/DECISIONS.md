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
