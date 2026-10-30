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

  // plan: { direction: "long"|"short", entry, stop, target, target2?, dailyVolPct,
  //         horizon: { days } or { minutesLeft }, costBps, runs, seed,
  //         events: [{ day, movePct }] }
  // An event is an overnight jump before trading day `day` (2 = tomorrow's
  // open), e.g. an earnings report, sized so its average absolute move is movePct.
  // With target2, the plan scales out: half at target, the stop moves to the
  // entry (breakeven), and the rest runs to target2, the new stop, or the end.
  function simulateTrade(plan) {
    const problems = checkPlan(plan);
    if (problems.length) return { ok: false, needs: problems };

    const long = plan.direction !== "short";
    const runs = Math.max(500, Math.min(20000, Math.floor(plan.runs || 10000)));
    const { entry, stop, target } = plan;
    const target2 = isNum(plan.target2) && (long ? plan.target2 > target : plan.target2 < target) ? plan.target2 : null;
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
    // Jumps keyed by the step that opens their day. Normal draws scaled so the
    // average absolute jump is movePct (E|Z| = sqrt(2/pi)).
    const jumps = new Map();
    for (const ev of Array.isArray(plan.events) ? plan.events : []) {
      if (!isNum(ev?.day) || !isNum(ev?.movePct) || ev.movePct <= 0 || ev.day < 2 || ev.day > days) continue;
      const step = Math.round((ev.day - 1) * stepsPerDay) + 1;
      jumps.set(step, (jumps.get(step) || 0) + (ev.movePct / 100) * Math.sqrt(Math.PI / 2));
    }

    const rand = mulberry32(plan.seed ?? hashSeed(`${plan.direction}|${entry}|${stop}|${target}|${plan.dailyVolPct}|${days}`));
    const normal = makeNormal(rand);
    const t = makeStudentT(normal, T_DF);

    let hitTarget = 0;
    let hitTarget2 = 0;
    let hitStop = 0;
    let gappedStops = 0;
    let gapLoss = 0; // extra loss per share from stops filled past the stop at a gap
    const rMultiples = new Float64Array(runs);
    const exitSteps = new Float64Array(runs);
    const outcomes = new Uint8Array(runs); // 0 open, 1 target, 2 stop
    const move = (price) => sign * (price - entry);

    for (let i = 0; i < runs; i++) {
      let logP = Math.log(entry);
      let outcome = 0;
      let banked = 0; // profit per share already taken
      let size = 1; // share of the position still open
      let activeStop = stop;
      let lastPrice = entry;
      let done = false;
      for (let s = 1; s <= totalSteps && !done; s++) {
        const jumpSd = jumps.get(s) || 0;
        const dayBoundary = (gapSd > 0 && s > 1 && (s - 1) % stepsPerDay === 0) || jumpSd > 0;
        logP += drift + stepSd * t() + (dayBoundary ? gapSd * t() - 0.5 * gapSd * gapSd : 0);
        if (jumpSd > 0) logP += jumpSd * normal() - 0.5 * jumpSd * jumpSd;
        const price = Math.exp(logP);
        lastPrice = price;
        const stopHit = long ? price <= activeStop : price >= activeStop;
        if (stopHit) {
          // During the session a stop fills at the stop. Only an overnight gap
          // jumps past it, and then it fills at the opening price.
          const fill = dayBoundary ? price : activeStop;
          if (dayBoundary) {
            if (outcome === 0) gappedStops++;
            gapLoss += size * Math.abs(fill - activeStop);
          }
          banked += size * move(fill);
          size = 0;
          if (outcome === 0) outcome = 2;
          exitSteps[i] = s;
          done = true;
          break;
        }
        if (outcome === 0 && (long ? price >= target : price <= target)) {
          outcome = 1; // a limit order fills at the target, not better
          if (target2 === null) {
            banked += move(target);
            size = 0;
            exitSteps[i] = s;
            done = true;
            break;
          }
          banked += 0.5 * move(target);
          size = 0.5;
          activeStop = entry;
        }
        if (target2 !== null && outcome === 1 && (long ? price >= target2 : price <= target2)) {
          banked += size * move(target2);
          size = 0;
          hitTarget2++;
          exitSteps[i] = s;
          done = true;
        }
      }
      if (!done) {
        banked += size * move(lastPrice);
        exitSteps[i] = totalSteps;
      }
      if (outcome === 1) hitTarget++;
      else if (outcome === 2) hitStop++;
      outcomes[i] = outcome;
      rMultiples[i] = (banked - costPerShare) / riskPerShare;
    }

    const sorted = Float64Array.from(rMultiples).sort();
    const pct = (q) => sorted[Math.min(runs - 1, Math.floor(q * runs))];
    const mean = rMultiples.reduce((a, b) => a + b, 0) / runs;
    // Average result when the target is reached first, and when stopped first.
    const avgOf = (k) => {
      let sum = 0;
      let n = 0;
      for (let i = 0; i < runs; i++) if (outcomes[i] === k) (sum += rMultiples[i]), n++;
      return n ? sum / n : null;
    };
    const winR = avgOf(1);
    const lossR = avgOf(2);
    // With no edge, prices are a fair game, so the plan's average result is
    // exactly what costs and gap slippage take. Computing that directly avoids
    // the sampling noise in `mean`, which is as large as the cost itself.
    const noEdgeR = -(costPerShare + gapLoss / runs) / riskPerShare;
    // Each point of probability your analysis moves from "stopped" to "target"
    // adds (winR - lossR) / 100. This is how many points it must add to break even.
    const pointsNeeded = winR != null && lossR != null && winR > lossR ? (-noEdgeR / (winR - lossR)) * 100 : null;
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
      riskPerShare,
      breakevenWinRate: (riskPerShare + costPerShare) / (riskPerShare + rewardPerShare),
      costR: costPerShare / riskPerShare,
      pTarget: pT,
      pTarget2: hitTarget2 / runs,
      scaleOut: target2 !== null,
      avgWinR: winR,
      avgLossR: lossR,
      pointsNeeded,
      noEdgeR,
      eventsInside: jumps.size,
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

  // Plain-language warnings about how the levels fit the stock, worst first.
  function reviewPlan(plan, sim) {
    if (!sim?.ok) return [];
    const notes = [];
    const pct = (x) => `${Math.round(x * 100)}%`;
    const stopPct = (sim.riskPerShare / plan.entry) * 100;
    const noise = sim.days <= 1 ? plan.dailyVolPct * Math.sqrt(Math.max(sim.days, 0.05)) : plan.dailyVolPct;
    if (stopPct < noise * 0.75) {
      notes.push({ level: "warn", text: `The stop is ${stopPct.toFixed(1)}% away, inside a normal ${sim.days <= 1 ? "session's" : "day's"} move of about ${noise.toFixed(1)}%. Ordinary noise will hit it often.` });
    }
    if (sim.pNeither > 0.35) {
      notes.push({ level: "warn", text: `In ${pct(sim.pNeither)} of runs neither the stop nor the target was reached in time. The target may be too far for the time you've given it.` });
    }
    if (sim.costR > 0.1) {
      notes.push({ level: "warn", text: `Trading costs eat ${pct(sim.costR)} of what you risk on each trade. A wider stop with a smaller position costs less per dollar risked.` });
    }
    if (sim.gappedStopShare > 0.15 && !sim.eventsInside) {
      notes.push({ level: "info", text: `${pct(sim.gappedStopShare)} of stop-outs happened at an overnight gap, past the stop. You can lose more than planned when the stock opens far away.` });
    }
    if (sim.eventsInside > 0) {
      notes.unshift({ level: "warn", text: `Earnings fall inside this hold. The stock can open far from your stop, so a loss can be bigger than planned: ${pct(sim.gappedStopShare)} of stop-outs here filled past the stop.` });
    }
    if (sim.rewardRisk < 1) {
      notes.push({ level: "info", text: `The target is closer than the stop, so you need to be right more often than you're wrong just to break even.` });
    }
    return notes;
  }

  // The same plan at volatility a quarter lower and a third higher. The odds
  // move a lot with volatility, so the card shows them as a range.
  // `main` (the full run at the stated volatility) is always inside the range.
  function volatilityRange(plan, main = null, runs = 4000) {
    const lo = simulateTrade({ ...plan, runs, dailyVolPct: plan.dailyVolPct * 0.75 });
    const hi = simulateTrade({ ...plan, runs, dailyVolPct: plan.dailyVolPct * 1.33 });
    if (!lo.ok || !hi.ok) return null;
    const all = main?.ok ? [lo, hi, main] : [lo, hi];
    const span = (k) => [Math.min(...all.map((r) => r[k])), Math.max(...all.map((r) => r[k]))];
    return { pTarget: span("pTarget"), pStop: span("pStop"), pNeither: span("pNeither") };
  }

  globalThis.simulateTrade = simulateTrade;
  globalThis.volatilityRange = volatilityRange;
  globalThis.reviewPlan = reviewPlan;
  globalThis.checkTradePlan = checkPlan;
})();
