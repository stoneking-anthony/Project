import { test } from "node:test";
import assert from "node:assert/strict";
import "../features/atlas/public/confidence.js";

const { computeConfidence } = globalThis;

const strongBuy = {
  ticker: "AAA",
  rating: "Buy",
  price: 100,
  price_as_of: "2026-09-01",
  target: 125,
  conviction: "High",
  scenarios: { bear: 90, base: 125, bull: 115 + 5 },
  grades: { value: "A", growth: "A", profitability: "A", momentum: "B", health: "A" },
  street: { rating: "Strong Buy", avg_target: 130, analysts: 30 },
  insiders: "Net buying",
  next_earnings: "2026-11-20",
};

test("well-supported call scores high but never 100", () => {
  const c = computeConfidence(strongBuy);
  assert.ok(c.value >= 75 && c.value <= 95, `got ${c.value}`);
  assert.equal(c.level, "High");
  assert.deepEqual(c.warnings, []);
});

test("even perfect inputs never reach 100", () => {
  const c = computeConfidence({ ...strongBuy, rating: "Strong Buy", scenarios: { bear: 99, base: 101, bull: 102 } });
  assert.ok(c.value >= 85 && c.value <= 95, `got ${c.value}`);
});

test("evidence pointing the other way lowers confidence", () => {
  const against = computeConfidence({
    ...strongBuy,
    grades: { value: "F", growth: "D", profitability: "D", momentum: "F", health: "D" },
    street: { rating: "Sell", avg_target: 70, analysts: 20 },
    insiders: "Net selling",
  });
  assert.ok(against.value < 40, `got ${against.value}`);
  assert.equal(against.level, "Low");
});

test("a wide range of outcomes lowers confidence", () => {
  const wide = computeConfidence({ ...strongBuy, scenarios: { bear: 40, base: 125, bull: 200 } });
  const range = wide.factors.find((f) => f.key === "range");
  assert.equal(range.score, 0);
  assert.ok(wide.value < computeConfidence(strongBuy).value);
});

test("a Hold is backed by neutral signals", () => {
  const hold = { ...strongBuy, rating: "Hold", street: { rating: "Hold" }, grades: { value: "C", growth: "C", profitability: "C" }, insiders: "Routine" };
  const c = computeConfidence(hold);
  assert.equal(c.factors.find((f) => f.key === "street").score, 1);
  assert.equal(c.factors.find((f) => f.key === "grades").score, 1);
});

test("unverified price caps the score and says why", () => {
  const c = computeConfidence({ ...strongBuy, price: null, price_as_of: null });
  assert.ok(c.value <= 60);
  assert.match(c.warnings[0], /price couldn't be verified/);
});

test("earnings within two weeks costs points", () => {
  const near = computeConfidence({ ...strongBuy, next_earnings: "2026-09-08" });
  assert.equal(near.value, computeConfidence(strongBuy).value - 5);
  assert.match(near.warnings[0], /Earnings are 7 days away/);
});

test("sparse cards still score, using only what's there", () => {
  const c = computeConfidence({ rating: "Buy", price: 50, price_as_of: "2026-09-01" });
  assert.ok(c.value >= 5 && c.value <= 95);
  assert.deepEqual(c.factors.map((f) => f.key), ["data"]);
});

test("unknown rating returns null", () => {
  assert.equal(computeConfidence({ rating: "Maybe" }), null);
});
