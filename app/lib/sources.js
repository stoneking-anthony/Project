// The heartbeat (docs/SPINE.md, `sources`). Every source reports each run; the
// app says out loud when one has stopped instead of going quietly stale.
//
// `expect` is one of:
//   "daily HH:MM" / "weekdays HH:MM"   a clock
//   "within Nd" / "within Nh"         a max age (e.g. needs a local session)
//   "live"                             read on demand; only errors matter

import { db } from "./db.js";

export const SOURCES = {
  manual: "within 7d",
  gcal: "live",
  "sec-edgar": "live",
  brain: "live",
  "import:robinhood": "within 3d",
};

export async function registerSources() {
  for (const [name, expect] of Object.entries(SOURCES)) {
    await db().query(
      "insert into sources (name, expect) values ($1, $2) on conflict (name) do update set expect = excluded.expect",
      [name, expect],
    );
  }
}

export async function ok(name, at = new Date()) {
  await db().query("update sources set last_ok_at = $2 where name = $1", [name, at]);
}

export async function failed(name, err, at = new Date()) {
  const message = String(err?.message || err).slice(0, 500);
  await db().query("update sources set last_error = $2, last_error_at = $3 where name = $1", [name, message, at]);
}

// Runs fn as a call to source `name`, recording the outcome. Never lets the
// heartbeat itself break the caller.
export async function track(name, fn) {
  try {
    const result = await fn();
    await ok(name).catch(() => {});
    return result;
  } catch (err) {
    await failed(name, err).catch(() => {});
    throw err;
  }
}

const HOUR = 3600 * 1000;

// How long a source may go without a successful run before it counts as stale.
export function allowance(expect) {
  const within = /^within (\d+)([dh])$/.exec(expect);
  if (within) return Number(within[1]) * (within[2] === "d" ? 24 : 1) * HOUR;
  if (expect.startsWith("daily")) return 26 * HOUR;
  // Friday's run must survive the weekend: Fri 09:35 -> Mon 09:35 is 72h.
  if (expect.startsWith("weekdays")) return 74 * HOUR;
  return null; // live
}

// One row per source: ok, stale, error, or idle (never run, or live and quiet).
export function status(row, now = new Date()) {
  const lastOk = row.last_ok_at ? new Date(row.last_ok_at) : null;
  const lastErr = row.last_error_at ? new Date(row.last_error_at) : null;
  const erroring = lastErr && (!lastOk || lastErr > lastOk);
  const limit = allowance(row.expect);
  let state;
  if (erroring) state = "error";
  else if (limit == null) state = lastOk ? "ok" : "idle";
  else if (!lastOk) state = "idle";
  else state = now - lastOk > limit ? "stale" : "ok";
  return {
    name: row.name,
    expect: row.expect,
    state,
    lastOkAt: lastOk,
    error: erroring ? row.last_error : null,
  };
}

export async function heartbeat(now = new Date()) {
  const { rows } = await db().query("select * from sources order by name");
  return rows.map((r) => status(r, now));
}
