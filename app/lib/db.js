// One Postgres pool for the whole app, and the migration that creates the spine.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "../config.js";

const SCHEMA = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "schema.sql"), "utf8");

let pool = null;

function sslFor(url) {
  const host = new URL(url).hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "") return false;
  return config.databaseCa ? { ca: config.databaseCa } : { rejectUnauthorized: false };
}

export function db() {
  if (!pool) {
    if (!config.databaseUrl) throw new Error("DATABASE_URL is not set");
    // sslmode in the URL would override the ssl option below, so strip it.
    const url = new URL(config.databaseUrl);
    url.searchParams.delete("sslmode");
    pool = new pg.Pool({ connectionString: url.toString(), ssl: sslFor(config.databaseUrl), max: 5 });
  }
  return pool;
}

export async function migrate() {
  const client = await db().connect();
  try {
    await client.query("select pg_advisory_lock(424242)");
    await client.query(SCHEMA);
  } finally {
    await client.query("select pg_advisory_unlock(424242)").catch(() => {});
    client.release();
  }
}

export async function closeDb() {
  if (pool) await pool.end();
  pool = null;
}
