import { test } from "node:test";
import assert from "node:assert/strict";
import { allowance, status } from "../lib/sources.js";

const at = (s) => new Date(s);

test("a weekday source is not stale over the weekend", () => {
  const row = { name: "broker", expect: "weekdays 09:35", last_ok_at: at("2026-09-25T13:35:00Z") }; // Friday
  assert.equal(status(row, at("2026-09-27T12:00:00Z")).state, "ok"); // Sunday
  assert.equal(status(row, at("2026-09-29T12:00:00Z")).state, "stale"); // Tuesday
});

test("max-age sources go stale after their window", () => {
  const row = { name: "import:robinhood", expect: "within 3d", last_ok_at: at("2026-09-01T00:00:00Z") };
  assert.equal(status(row, at("2026-09-03T00:00:00Z")).state, "ok");
  assert.equal(status(row, at("2026-09-05T00:00:00Z")).state, "stale");
});

test("an error newer than the last success shows as failing", () => {
  const row = { name: "gcal", expect: "live", last_ok_at: at("2026-09-01T00:00:00Z"), last_error: "404", last_error_at: at("2026-09-02T00:00:00Z") };
  assert.deepEqual([status(row).state, status(row).error], ["error", "404"]);
  assert.equal(status({ ...row, last_ok_at: at("2026-09-03T00:00:00Z") }).state, "ok");
});

test("live sources never go stale, and unused ones say so", () => {
  assert.equal(allowance("live"), null);
  assert.equal(status({ name: "brain", expect: "live", last_ok_at: null }).state, "idle");
});
