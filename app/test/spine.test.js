import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./helpers.js";
import { db, closeDb } from "../lib/db.js";
import * as spine from "../lib/spine.js";

before(freshDb);
after(closeDb);

test("UPDATE, DELETE and TRUNCATE are refused by the database", async () => {
  const id = await spine.write("note", { text: "hello" });
  await assert.rejects(db().query("update events set payload = '{}' where id = $1", [id]), /append-only/);
  await assert.rejects(db().query("delete from events where id = $1", [id]), /append-only/);
  await assert.rejects(db().query("truncate events"), /append-only/);
  await spine.standard.set("north_star", "first");
  await assert.rejects(db().query("update standard set text = 'x'"), /append-only/);
});

test("unknown kinds, bad payloads and secrets are rejected before writing", async () => {
  await assert.rejects(spine.write("money.tnx", { amount: 1 }), /Unknown kind/);
  await assert.rejects(spine.write("stock.watch", { ticker: "not a ticker" }), /ticker/);
  await assert.rejects(spine.write("note", { text: "card 4111 1111 1111 1111" }), /card number/);
  await assert.rejects(spine.write("note", { text: "ssn 123-45-6789" }), /Social Security/);
  // A long number that fails the card checksum is fine.
  assert.ok(await spine.write("note", { text: "order 4111 1111 1111 1112" }));
});

test("re-imports with the same source_ref are skipped", async () => {
  const opts = { source: "import:test", sourceRef: "tx-1" };
  assert.ok(await spine.write("note", { text: "once" }, opts));
  assert.equal(await spine.write("note", { text: "once" }, opts), null);
  const ids = await spine.writeAll([
    { kind: "note", payload: { text: "a" }, source: "import:test", sourceRef: "tx-1" },
    { kind: "note", payload: { text: "b" }, source: "import:test", sourceRef: "tx-2" },
  ]);
  assert.equal(ids[0], null);
  assert.ok(ids[1]);
});

test("writeAll is all or nothing", async () => {
  const before = (await spine.list("note")).length;
  await assert.rejects(
    spine.writeAll([
      { kind: "note", payload: { text: "kept?" } },
      { kind: "note", payload: { text: "" } },
    ]),
  );
  assert.equal((await spine.list("note")).length, before);
});

test("corrections replace without editing; the latest of two conflicting corrections wins", async () => {
  const id = await spine.write("stock.watch", { ticker: "AAA" }, { occurredAt: new Date("2026-01-01") });
  await spine.correct(id, { ticker: "BBB" });
  await new Promise((r) => setTimeout(r, 5));
  await spine.correct(id, { ticker: "CCC" });
  const live = (await spine.list("stock.watch")).map((e) => e.payload.ticker);
  assert.ok(live.includes("CCC"));
  assert.ok(!live.includes("AAA") && !live.includes("BBB"));
  const { rows } = await db().query("select count(*)::int as n from correction_conflicts where target = $1", [id]);
  assert.equal(rows[0].n, 1);
});

test("redact blanks a payload and nothing else can", async () => {
  const id = await spine.write("note", { text: "regret this" });
  await spine.redact(id);
  const { rows } = await db().query("select payload, redacted_at from events where id = $1", [id]);
  assert.deepEqual(rows[0].payload, { redacted: true });
  assert.ok(rows[0].redacted_at);
  assert.ok(!(await spine.list("note")).some((e) => e.id === id));
});

test("latest() returns the newest snapshot for a key", async () => {
  const blocks = [{ start: "09:00", end: "10:00", title: "Work" }];
  await spine.write("plan.set", { date: "2026-10-01", priorities: ["one"], blocks }, { occurredAt: new Date("2026-10-01T12:00:00Z") });
  await spine.write("plan.set", { date: "2026-10-01", priorities: ["two"], blocks }, { occurredAt: new Date("2026-10-01T13:00:00Z") });
  await spine.write("plan.set", { date: "2026-10-02", priorities: ["other day"], blocks }, { occurredAt: new Date("2026-10-01T14:00:00Z") });
  assert.deepEqual((await spine.latest("plan.set", "2026-10-01")).payload.priorities, ["two"]);
});

test("membership folds add/remove pairs", async () => {
  const t = (s) => ({ occurredAt: new Date(`2026-02-0${s}T00:00:00Z`) });
  await spine.write("insider.track", { name: "Ann Example" }, t(1));
  await spine.write("insider.track", { name: "Bob Example" }, t(2));
  await spine.write("insider.untrack", { name: "ann example" }, t(3));
  const names = (await spine.membership("insider.track", "insider.untrack", "name")).map((m) => m.value);
  assert.deepEqual(names, ["Bob Example"]);
});

test("standard keeps history; the latest row wins", async () => {
  await spine.standard.set("north_star", "second");
  assert.equal((await spine.standard.get("north_star")).text, "second");
  const { rows } = await db().query("select count(*)::int as n from standard where key = 'north_star'");
  assert.equal(rows[0].n, 2);
});
