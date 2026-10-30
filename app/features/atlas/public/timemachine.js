// The time machine: replays a planned trade thousands of times to show how
// often the target, the stop, or neither is hit before the horizon ends.
//
// It is a Monte Carlo simulation, not a forecast. Prices move randomly with no
// built-in edge (zero drift), at the stock's own volatility, with fat tails
// (Student-t moves) so big days happen about as often as they do in practice.
// A stop that is gapped through fills at the gap price, not the stop.
//
// Loaded as a plain script in the browser (defines globalThis.simulateTrade)
// and imported by the tests. Nothing here is stored.

(function () {
  const TRADING_MINUTES = 390; // 9:30 to 16:00
  const MAX_DAYS = 20;
  const T_DF = 4; // tail heaviness: lower is fatter; 4 matches daily stock returns well

  // Small, fast, seedable random numbers, so the same plan gives the same result.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeNormal(rand) {
    let spare = null;
    return () => {
      if (spare !== null) {
        const s = spare;
        spare = null;
        return s;
      }
      let u = 0;
      while (u === 0) u = rand();
      const v = rand();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return r * Math.cos(2 * Math.PI * v);
    };
  }

  // Student-t draw rescaled to unit variance.
  function makeStudentT(normal, df) {
    const scale = Math.sqrt((df - 2) / df);
    return () => {
      let chi = 0;
      for (let i = 0; i < df; i++) {
        const z = normal();
        chi += z * z;
      }
      return (normal() / Math.sqrt(chi / df)) * scale;
    };
  }

  function hashSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  const isNum = (n) => typeof n === "number" && Number.isFinite(n);

  // Checks a plan and returns a list of problems in plain words (empty when ok).
  function checkPlan(p) {
    const problems = [];
    if (!isNum(p.entry) || p.entry <= 0) problems.push("an entry price");
    if (!isNum(p.stop) || p.stop <= 0) problems.push("a stop price");
    if (!isNum(p.target) || p.target <= 0) problems.push("a target price");
    if (!isNum(p.dailyVolPct) || p.dailyVolPct <= 0) problems.push("the stock's daily volatility");
    if (problems.length) return problems;
    const long = p.direction !== "short";
    if (long && !(p.stop < p.entry && p.target > p.entry)) problems.push("a stop below and a target above the entry (long)");
    if (!long && !(p.stop > p.entry && p.target < p.entry)) problems.push("a stop above and a target below the entry (short)");
    return problems;
  }

  // plan: { direction: "long"|"short", entry, stop, target, dailyVolPct,
  //         horizon: { days } or { minutesLeft }, costBps, runs, seed }
  function simulateTrade(plan) {
    const problems = checkPlan(plan);
    if (problems.length) return { ok: false, needs: problems };

    const long = plan.direction !== "short";
    const runs = Math.max(500, Math.min(20000, Math.floor(plan.runs || 10000)));
    const { entry, stop, target } = plan;
    const sign = long ? 1 : -1;
    const riskPerShare = Math.abs(entry - stop);
    const rewardPerShare = Math.abs(target - entry);
    const costPerShare = ((plan.costBps ?? 10) / 10000) * entry; // round trip: spread, fees, slippage

    // Horizon: minutes left today, or a number of trading days.
    const minutesLeft = plan.horizon?.minutesLeft;
    const days = isNum(minutesLeft) ? minutesLeft / TRADING_MINUTES : Math.min(MAX_DAYS, Math.max(1, plan.horizon?.days ?? 1));
    const stepMinutes = days <= 1 ? 5 : days <= 5 ? 15 : 30;
    const stepsPerDay = TRADING_MINUTES / stepMinutes;
    const totalSteps = Math.max(1, Math.round(days * stepsPerDay));
    // Multi-day trades also face the overnight gap: about a fifth of a day's
    // variance happens between the close and the next open.
    const dayVar = (plan.dailyVolPct / 100) ** 2;
    const overnightShare = days > 1 ? 0.2 : 0;
    const stepSd = Math.sqrt((dayVar * (1 - overnightShare)) / stepsPerDay);
    const gapSd = Math.sqrt(dayVar * overnightShare);
    const drift = -0.5 * stepSd * stepSd; // keeps the expected price flat

    const rand = mulberry32(plan.seed ?? hashSeed(`${plan.direction}|${entry}|${stop}|${target}|${plan.dailyVolPct}|${days}`));
    const t = makeStudentT(makeNormal(rand), T_DF);

    let hitTarget = 0;
    let hitStop = 0;
    let gappedStops = 0;
    const rMultiples = new Float64Array(runs);
    const exitSteps = new Float64Array(runs);
    const toR = (exitPrice) => (sign * (exitPrice - entry) - costPerShare) / riskPerShare;

    for (let i = 0; i < runs; i++) {
      let logP = Math.log(entry);
      let outcome = null;
      let exitPrice = entry;
      for (let s = 1; s <= totalSteps; s++) {
        const dayBoundary = gapSd > 0 && s > 1 && (s - 1) % stepsPerDay === 0;
        logP += drift + stepSd * t() + (dayBoundary ? gapSd * t() - 0.5 * gapSd * gapSd : 0);
        const price = Math.exp(logP);
        const stopHit = long ? price <= stop : price >= stop;
        const targetHit = long ? price >= target : price <= target;
        if (stopHit) {
          outcome = "stop";
          // During the session a stop fills at the stop. Only an overnight gap
          // jumps past it, and then it fills at the opening price.
          exitPrice = dayBoundary ? price : stop;
          if (dayBoundary) gappedStops++;
          exitSteps[i] = s;
          break;
        }
        if (targetHit) {
          outcome = "target";
          exitPrice = target; // a limit order fills at the target, not better
          exitSteps[i] = s;
          break;
        }
        exitPrice = price;
      }
      if (outcome === "stop") hitStop++;
      else if (outcome === "target") hitTarget++;
      else exitSteps[i] = totalSteps;
      rMultiples[i] = toR(exitPrice);
    }

    const sorted = Float64Array.from(rMultiples).sort();
    const pct = (q) => sorted[Math.min(runs - 1, Math.floor(q * runs))];
    const mean = rMultiples.reduce((a, b) => a + b, 0) / runs;
    // 95% margin of error on the win rate from sampling alone.
    const pT = hitTarget / runs;
    const moe = 1.96 * Math.sqrt((pT * (1 - pT)) / runs);

    // Histogram of results in R, from -2R to +4R in half-R buckets (ends catch the rest).
    const edges = [];
    for (let e = -2; e <= 4; e += 0.5) edges.push(e);
    const bins = new Array(edges.length + 1).fill(0);
    for (const r of rMultiples) {
      let k = 0;
      while (k < edges.length && r >= edges[k]) k++;
      bins[k]++;
    }

    const rr = rewardPerShare / riskPerShare;
    return {
      ok: true,
      runs,
      days,
      direction: long ? "long" : "short",
      rewardRisk: rr,
      breakevenWinRate: (riskPerShare + costPerShare) / (riskPerShare + rewardPerShare),
      costR: costPerShare / riskPerShare,
      pTarget: pT,
      pStop: hitStop / runs,
      pNeither: (runs - hitTarget - hitStop) / runs,
      marginOfError: moe,
      gappedStopShare: hitStop ? gappedStops / hitStop : 0,
      expectedR: mean,
      medianR: pct(0.5),
      worst5R: pct(0.05),
      best5R: pct(0.95),
      medianMinutesInTrade: (() => {
        const s = Float64Array.from(exitSteps).sort();
        return s[Math.floor(runs / 2)] * stepMinutes;
      })(),
      histogram: { edges, bins },
    };
  }

  globalThis.simulateTrade = simulateTrade;
  globalThis.checkTradePlan = checkPlan;
})();
