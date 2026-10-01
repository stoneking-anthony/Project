# The app

One web app: the spine (`lib/`, `db/`) and every feature (`features/<name>/`), behind one password. Install it on a phone from the browser's **Add to Home Screen**.

Read `../docs/SPINE.md` before changing anything here.

## Layout

| Path | What it is |
|---|---|
| `server.js` | The one server: login, home screen, shared APIs, features mounted at `/<feature>/` |
| `config.js` | Every setting, read from the environment |
| `db/schema.sql` | The three tables, the append-only triggers, `redact()`, the `live` view. Applied on every start. |
| `lib/spine.js` | The only way to read or write data |
| `lib/kinds.js` | The kind registry: shapes, versions, validation, the secret filter |
| `lib/sources.js` | The heartbeat |
| `lib/claude.js` | The one Claude client and chat loop |
| `lib/chat.js` | Conversations as `chat.turn` events |
| `lib/auth.js` | Password login and the session cookie |
| `lib/brain.js`, `lib/calendar.js` | Live sources: the `brain` repo and Google Calendar |
| `lib/views/` | Shared derived views (`today`, `plan`) |
| `features/atlas/`, `features/compass/` | Each feature: `routes.js`, `prompt.md`, `public/` |

## Adding a feature

1. Ask the mastermind chat for any new kinds (`docs/chats/<feature>.md`). They go in `lib/kinds.js`.
2. Make `features/<name>/routes.js` exporting `{ name, publicDir, routes }`, where `routes` maps `"METHOD api/path"` to a handler. Register it in `server.js`.
3. Read and write only through `lib/spine.js`. No tables, files, or `localStorage` of your own.

## Hosting (Render + Supabase, both free to start)

You can do all of this from a phone browser.

1. **Database.** At supabase.com, create a project and save its database password. Then **Connect → Session pooler** and copy the URI. Put your database password in place of `[YOUR-PASSWORD]`. This is `DATABASE_URL`.
2. **Server.** At render.com, sign in with GitHub, then **New → Blueprint** and pick this repo. Render reads `render.yaml` and asks for:
   - `APP_PASSWORD`: a long password you'll type to sign in (at least 12 characters)
   - `DATABASE_URL`: from step 1
   - `ANTHROPIC_API_KEY`: from console.anthropic.com
   - the optional ones (calendar, brain token, SEC contact) can be blank and added later
3. Open the URL Render gives you, sign in, then **Share → Add to Home Screen**.

Every push to `main` redeploys. The free plan sleeps after 15 idle minutes, so the first open after that takes about a minute.

## Running locally

```bash
cp .env.example .env    # fill in at least APP_PASSWORD, DATABASE_URL, ANTHROPIC_API_KEY
npm install
npm start               # http://localhost:3000
```

## Tests

They need a Postgres they may wipe. They use `postgres://postgres@localhost:5433/spine_test` unless `TEST_DATABASE_URL` is set. Claude is faked, so no API key is needed.

```bash
npm test
```
