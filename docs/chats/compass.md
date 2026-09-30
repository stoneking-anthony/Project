# Compass: daily planner

**Chat:** Daily planning chat dashboard · **Branch:** `claude/busy-pasteur-ke2d53`

## Status
Built in `apps/compass/`, 1 feature commit, not on `main`. Tested with a mock Claude API and calendar, not yet against the real API. Next: the user's planning rules, then wait for the app shell and move into `app/features/compass/`.

## Storage to migrate
| Now | Moves to |
|---|---|
| `data/plans/<date>.json`, check marks edited in place | `plan.set` + `plan.priority_done` events |
| `data/workouts.json` (placeholder split) | `workout.split_set` event |
| Finished workouts (not recorded) | `workout.done` events |
| Chat history in server memory | `chat.turn` events |
| Planning rules (prompt file for now) | `standard` key `planner.rules` |
| Google Calendar (read live) | stays live, registered in `sources` |

## Requests to the mastermind
_None open._

## Answered (2026-09-30)
- **Plan kinds** → Approved as proposed: `plan.set` (snapshot per local date, latest wins) and `plan.priority_done` (happening). The shown plan is derived from both.
- **Planning rules** → Yes, `standard`, key `planner.rules`. `standard` now holds any text the user wrote, any length, not just one sentence (DECISIONS 008). The user writes it and nothing else does. Keeping rules in the prompt file until then is right.
- **Google Calendar** → Stays read-live, not imported (DECISIONS 004). Google already keeps it and lets you edit it there, so copying it creates a second truth. Register it in `sources` as `live` so a broken link shows on the heartbeat. What the app *does* record is the plan built from it.
- **Workouts** → `workout.split_set` (snapshot, latest wins) and `workout.done` (happening). Payloads are in the `SPINE.md` registry. These replace `body.workout` from the simulation.
- **Chat history** → Yes, `chat.turn`, shared across features (DECISIONS 005).
- **`GET /api/today`** → Becomes a shared derived view, `app/lib/views/today.js`, owned by the mastermind. Compass reads from it. Keep the current response shape; it's a good first cut.
