# Compass: daily planner

**Chat:** Daily planning chat dashboard · **Branch:** `claude/busy-pasteur-ke2d53`

## Status
Built in `apps/compass/`, 1 feature commit, not on `main`. Tested with a mock Claude API and calendar, not yet against the real API. Next: read the planning rules from `brain` (DECISIONS 009), then wait for the app shell and move into `app/features/compass/`.

## Storage to migrate
| Now | Moves to |
|---|---|
| `data/plans/<date>.json`, check marks edited in place | `plan.set` + `plan.priority_done` events |
| `data/workouts.json` (placeholder split) | read live from `brain/body/gym.md`; drop the placeholder |
| Finished workouts (not recorded) | `workout.done` events |
| Chat history in server memory | `chat.turn` events |
| Planning rules | read live from `brain`: `SCHEDULE.md` + `body/gym.md` (DECISIONS 009) |
| Google Calendar (read live) | stays live, registered in `sources` |

## Requests to the mastermind
_None open._

## Answered
- **2026-10-01 · Where the rules come from** → The user already wrote them in the private `brain` repo: `SCHEDULE.md` (wake, lights-out, fixed classes, work end, the free blocks, what to cut first) and `body/gym.md` (the split). Read both live with a read-only GitHub token from `.env` (`BRAIN_GITHUB_TOKEN`, contents read-only, `brain` only), parse the front matter's `updated:` and show its age. **Never copy their contents into this repo: it's public.** Shifts vary week to week, so they come from Google Calendar. This replaces both the `planner.rules` standard key and `workout.split_set`, which are dropped from the registry (DECISIONS 009).

### 2026-09-30
- **Plan kinds** → Approved as proposed: `plan.set` (snapshot per local date, latest wins) and `plan.priority_done` (happening). The shown plan is derived from both.
- **Planning rules** → ~~`standard` key `planner.rules`~~ superseded 2026-10-01, see above.
- **Google Calendar** → Stays read-live, not imported (DECISIONS 004). Google already keeps it and lets you edit it there, so copying it creates a second truth. Register it in `sources` as `live` so a broken link shows on the heartbeat. What the app *does* record is the plan built from it.
- **Workouts** → ~~`workout.split_set`~~ (superseded 2026-10-01: the split is read from `brain`) and `workout.done` (happening). Payloads are in the `SPINE.md` registry. These replace `body.workout` from the simulation.
- **Chat history** → Yes, `chat.turn`, shared across features (DECISIONS 005).
- **`GET /api/today`** → Becomes a shared derived view, `app/lib/views/today.js`, owned by the mastermind. Compass reads from it. Keep the current response shape; it's a good first cut.
