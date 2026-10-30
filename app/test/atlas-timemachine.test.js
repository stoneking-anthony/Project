import { test } from "node:test";
import assert from "node:assert/strict";
import "../features/atlas/public/timemachine.js";

const { simulateTrade } = globalThis;

const base = { direction: "long", entry: 100, stop: 98, target: 102, dailyVolPct: 3, costBps: 0, runs: 10000 };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} not within ${tol} of ${b}`);

test("with no edge, equal distances hit target and stop about equally", () => {
  const r = simulateTrade({ ...base, horizon: { days: 20 } });
  assert.equal(r.ok, true);
  near(r.pTarget, 0.5, 0.03, "pTarget");
  near(r.pTarget + r.pStop + r.pNeither, 1, 1e-9, "outcomes sum to 1");
});

test("a target twice as far away is hit about a third of the time", () => {
  const r = simulateTrade({ ...base, target: 104, horizon: { days: 20 } });
  near(r.pTarget, 1 / 3, 0.03, "pTarget");
  near(r.rewardRisk, 2, 1e-9, "reward:risk");
});

test("with no costs the average result is about zero; costs make it negative", () => {
  const free = simulateTrade({ ...base, horizon: { days: 5 } });
  near(free.expectedR, 0, 0.06, "expectedR without costs");
  const costly = simulateTrade({ ...base, horizon: { days: 5 }, costBps: 20 });
  assert.ok(costly.expectedR < free.expectedR - 0.05, "costs lower the expected result");
  near(costly.costR, 0.1, 1e-9, "20 bps on $100 is $0.20, 0.1R of a $2 risk");
});

test("same plan gives the same answer; runs are reproducible", () => {
  const a = simulateTrade({ ...base, horizon: { days: 3 } });
  const b = simulateTrade({ ...base, horizon: { days: 3 } });
  assert.deepEqual(a, b);
});

test("short trades mirror long ones", () => {
  const long = simulateTrade({ ...base, target: 104, horizon: { days: 20 } });
  const short = simulateTrade({ ...base, direction: "short", stop: 102, target: 96, horizon: { days: 20 } });
  near(short.pTarget, long.pTarget, 0.04, "mirror win rate");
});

test("rest-of-day horizon leaves many trades unresolved when stops are wide", () => {
  const r = simulateTrade({ ...base, stop: 95, target: 105, dailyVolPct: 2, horizon: { minutesLeft: 120 } });
  assert.ok(r.pNeither > 0.9, `most trades still open at the close: ${r.pNeither}`);
  assert.ok(r.medianMinutesInTrade <= 120);
});

test("overnight gaps can fill a stop worse than planned", () => {
  const r = simulateTrade({ ...base, stop: 99, target: 110, dailyVolPct: 4, horizon: { days: 10 } });
  assert.ok(r.gappedStopShare > 0, "some stops gap through");
  assert.ok(r.worst5R < -1, `worst outcomes lose more than 1R: ${r.worst5R}`);
});

test("histogram counts every run", () => {
  const r = simulateTrade({ ...base, horizon: { days: 2 } });
  assert.equal(r.histogram.bins.reduce((a, b) => a + b, 0), r.runs);
});

test("explains what's missing instead of guessing", () => {
  const r = simulateTrade({ direction: "long", entry: 100, stop: 101, target: 105, dailyVolPct: null });
  assert.equal(r.ok, false);
  assert.ok(r.needs.includes("the stock's daily volatility"));
  const wrongSide = simulateTrade({ ...base, stop: 101, horizon: { days: 1 } });
  assert.match(wrongSide.needs[0], /stop below and a target above/);
});

test("scaling out: half at target 1, stop to breakeven, rest to target 2", () => {
  const r = simulateTrade({ ...base, target: 102, target2: 106, horizon: { days: 10 } });
  assert.equal(r.scaleOut, true);
  assert.ok(r.pTarget2 > 0 && r.pTarget2 < r.pTarget, "target 2 is reached less often than target 1");
  near(r.expectedR, 0, 0.06, "still no edge without costs");
  assert.ok(r.avgWinR > 0.5, `after target 1 the worst case is breakeven on the rest: ${r.avgWinR}`);
});

test("a second target on the wrong side is ignored", () => {
  const r = simulateTrade({ ...base, target2: 101, horizon: { days: 2 } });
  assert.equal(r.scaleOut, false);
});

test("points needed: none without costs, some with costs", () => {
  const free = simulateTrade({ ...base, horizon: { minutesLeft: 390 } });
  assert.equal(free.pointsNeeded, 0, "no costs, no gaps, nothing to make up");
  near(free.noEdgeR, 0, 1e-12, "no-edge result");
  const costly = simulateTrade({ ...base, costBps: 30, horizon: { minutesLeft: 390 } });
  assert.ok(costly.pointsNeeded > 2 && costly.pointsNeeded < 15, `costs need an edge: ${costly.pointsNeeded}`);
});

test("review flags a stop inside normal noise", () => {
  const plan = { ...base, stop: 99.5, target: 101, dailyVolPct: 3, horizon: { minutesLeft: 390 } };
  const notes = globalThis.reviewPlan(plan, simulateTrade(plan)).map((n) => n.text);
  assert.ok(notes.some((t) => /inside a normal session's move/.test(t)), notes.join(" | "));
});

test("review flags a target too far for the time given", () => {
  const plan = { ...base, stop: 96, target: 115, dailyVolPct: 3, horizon: { minutesLeft: 390 } };
  const notes = globalThis.reviewPlan(plan, simulateTrade(plan)).map((n) => n.text);
  assert.ok(notes.some((t) => /too far for the time/.test(t)), notes.join(" | "));
});

test("review raises no warnings on a sensible plan (notes are allowed)", () => {
  const plan = { ...base, stop: 95, target: 110, dailyVolPct: 3, costBps: 5, horizon: { days: 10 } };
  const notes = globalThis.reviewPlan(plan, simulateTrade(plan));
  assert.deepEqual(notes.filter((n) => n.level === "warn"), []);
});
