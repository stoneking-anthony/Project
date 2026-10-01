// The only way features touch storage. Writes go through the kind registry;
// reads come back upgraded to each kind's current payload version.

import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { db } from "./db.js";
import { KINDS, findSecret, typedText, upgrade } from "./kinds.js";

export class SpineError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function prepare(kind, payload, opts) {
  const def = KINDS[kind];
  if (!def) throw new SpineError(`Unknown kind "${kind}". Register it in lib/kinds.js first.`);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new SpineError(`${kind}: payload must be an object`);
  const problem = def.check(payload);
  if (problem) throw new SpineError(`${kind}: ${problem}`);
  if (def.capture) {
    for (const text of typedText(payload)) {
      const secret = findSecret(text);
      if (secret) throw new SpineError(`Not saved: that ${secret}. Remove it and try again.`);
    }
  }
  return [
    opts.id || randomUUID(),
    kind,
    def.v,
    opts.occurredAt || new Date(),
    opts.tz || config.timeZone,
    JSON.stringify(payload),
    opts.source || "manual",
    opts.sourceRef ?? null,
    opts.corrects ?? null,
  ];
}

const INSERT = `insert into events (id, kind, v, occurred_at, tz, payload, source, source_ref, corrects)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  on conflict (source, source_ref) do nothing
  returning id`;

// Writes one event. Returns its id, or null if (source, sourceRef) was already
// recorded (a re-import).
export async function write(kind, payload, opts = {}) {
  const { rows } = await db().query(INSERT, prepare(kind, payload, opts));
  return rows[0]?.id ?? null;
}

// Writes several events in one transaction: all of them or none.
export async function writeAll(items) {
  const prepared = items.map(({ kind, payload, ...opts }) => prepare(kind, payload, opts));
  const client = await db().connect();
  try {
    await client.query("begin");
    const ids = [];
    for (const values of prepared) ids.push((await client.query(INSERT, values)).rows[0]?.id ?? null);
    await client.query("commit");
    return ids;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Replaces an event with a corrected payload. History keeps both.
export async function correct(id, payload, opts = {}) {
  const { rows } = await db().query("select kind from events where id = $1", [id]);
  if (!rows.length) throw new SpineError("No such event", 404);
  return write(rows[0].kind, payload, { ...opts, corrects: id });
}

// The one escape hatch (docs/SPINE.md rule 2): blanks a payload for good.
export async function redact(id) {
  await db().query("select redact($1)", [id]);
}

function shape(row) {
  return {
    id: row.id,
    kind: row.kind,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    tz: row.tz,
    source: row.source,
    payload: upgrade(row.kind, row.v, row.payload),
  };
}

// Live events of the given kinds, oldest first.
//   match  jsonb containment on the payload, e.g. { date: "2026-10-01" }
//   since / until  bounds on occurred_at
export async function list(kinds, { match, since, until, limit = 1000 } = {}) {
  const where = ["kind = any($1)"];
  const args = [[].concat(kinds)];
  if (match) {
    args.push(JSON.stringify(match));
    where.push(`payload @> $${args.length}::jsonb`);
  }
  if (since) {
    args.push(since);
    where.push(`occurred_at >= $${args.length}`);
  }
  if (until) {
    args.push(until);
    where.push(`occurred_at < $${args.length}`);
  }
  args.push(limit);
  const { rows } = await db().query(
    `select * from (select * from live where ${where.join(" and ")}
       order by occurred_at desc, recorded_at desc limit $${args.length}) t
     order by occurred_at, recorded_at`,
    args,
  );
  return rows.map(shape);
}

// The current state of a snapshot kind for one key (e.g. plan.set for a date).
export async function latest(kind, key) {
  const def = KINDS[kind];
  if (def?.shape !== "snapshot") throw new SpineError(`${kind} is not a snapshot kind`);
  const { rows } = await db().query(
    `select * from live where kind = $1 and payload ->> $2 = $3 order by occurred_at desc, recorded_at desc limit 1`,
    [kind, def.key, String(key)],
  );
  return rows[0] ? shape(rows[0]) : null;
}

// For add/remove pairs (stock.watch / stock.unwatch): the members whose latest
// event is an add, newest first, with the time they were added.
export async function membership(addKind, removeKind, field) {
  const { rows } = await db().query(
    `select distinct on (lower(payload ->> $3)) kind, payload, occurred_at
       from live where kind in ($1, $2)
       order by lower(payload ->> $3), occurred_at desc, recorded_at desc`,
    [addKind, removeKind, field],
  );
  return rows
    .filter((r) => r.kind === addKind)
    .sort((a, b) => b.occurred_at - a.occurred_at)
    .map((r) => ({ value: r.payload[field], since: r.occurred_at }));
}

// True if any event of these kinds was ever written (live or not).
export async function everWritten(kinds) {
  const { rows } = await db().query("select 1 from events where kind = any($1) limit 1", [[].concat(kinds)]);
  return rows.length > 0;
}

// The user's own words (docs/DECISIONS.md 008). Only routes acting for the user write here.
export const standard = {
  async get(key) {
    const { rows } = await db().query("select text, written_at from standard where key = $1 order by written_at desc, id desc limit 1", [key]);
    return rows[0] ? { text: rows[0].text, writtenAt: rows[0].written_at } : null;
  },
  async set(key, text) {
    if (!/^[a-z][a-z0-9_.]{0,63}$/.test(key)) throw new SpineError("Invalid key");
    if (typeof text !== "string" || !text.trim()) throw new SpineError("text is required");
    await db().query("insert into standard (key, text) values ($1, $2)", [key, text]);
  },
};
