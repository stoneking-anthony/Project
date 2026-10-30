// Trade plans and the movers brief. A ```plan block in a reply becomes a card
// with the levels, a position-size calculator, and the time machine; a
// ```movers block becomes a short list of what moved and why.
// Shares helpers with app.js (escapeHtml, fmtPrice, isNum). Nothing is stored:
// the plan lives in the chat turn, and the simulation reruns in the browser.

const RISK_DEFAULT = 100; // dollars risked per trade, until the user changes it

// Minutes of regular trading left today in New York, or null when closed.
function minutesLeftToday(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return null;
  const mins = Number(parts.hour) * 60 + Number(parts.minute);
  const open = 9 * 60 + 30;
  const close = 16 * 60;
  if (mins >= close) return null;
  return close - Math.max(mins, open);
}

// "today", "rest of day", "3 days", "2 weeks" -> a simulator horizon.
function parseHorizon(text) {
  const s = String(text || "today").toLowerCase();
  const n = Number((/(\d+(?:\.\d+)?)/.exec(s) || [])[1]);
  if (/week/.test(s)) return { days: (n || 1) * 5, label: `${n || 1} week${n > 1 ? "s" : ""}` };
  if (/day/.test(s) && n) return { days: n, label: `${n} trading day${n > 1 ? "s" : ""}` };
  const left = minutesLeftToday();
  if (left == null) return { minutesLeft: 390, label: "next full session (market closed now)" };
  return { minutesLeft: Math.max(5, left), label: `rest of today (${Math.floor(left / 60)}h ${left % 60}m left)` };
}

// Trading day (1 = today) on whose open a report's price jump lands, or null.
// Weekdays only; market holidays are ignored, which can shift it by a day.
function earningsDay(dateStr, when, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || "")) return null;
  const todayNy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
  const d = new Date(`${todayNy}T12:00:00Z`);
  const target = new Date(`${dateStr}T12:00:00Z`);
  if (target < d) return null;
  let day = 1;
  while (d < target) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) day++;
  }
  // Before the open: the jump lands on that day's open. After the close: the next day's.
  const jumpDay = /after/i.test(when || "") ? day + 1 : day;
  return jumpDay >= 2 ? jumpDay : null;
}

const fmtR = (r) => `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}R`;
const fmtPctPlain = (p) => `${Math.round(p * 100)}%`;
const fmtUsd = (n) => `${n < 0 ? "−" : n > 0 ? "+" : ""}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const HORIZON_CHOICES = [["today", "Today"], ["2 days", "2 days"], ["3 days", "3 days"], ["5 days", "1 week"], ["10 days", "2 weeks"], ["20 days", "4 weeks"]];

let currentRiskDollars = RISK_DEFAULT; // shared by every card this visit; not stored

// Outcome split (thin bar; the figures beside it carry the numbers) and
// how the runs ended, in dollars, as bars on one baseline.
function simDetailsHtml(sim, riskDollars) {
  const usd = (r) => fmtUsd(r * riskDollars);
  const { edges, bins } = sim.histogram;
  const max = Math.max(...bins);
  const label = (k) =>
    k === 0 ? `lost more than ${usd(-edges[0]).replace("+", "")}` : k === edges.length ? `made more than ${usd(edges.at(-1))}` : `${usd(edges[k - 1])} to ${usd(edges[k])}`;
  const mid = (k) => (k === 0 ? edges[0] - 0.25 : k === edges.length ? edges.at(-1) + 0.25 : (edges[k - 1] + edges[k]) / 2);
  const bars = bins
    .map((b, k) => {
      const share = ((b / sim.runs) * 100).toFixed(1);
      const h = max ? Math.max(b ? 3 : 0, (b / max) * 100) : 0;
      return `<span class="hb ${mid(k) < 0 ? "loss" : "win"}" style="height:${h}%" title="${label(k)}: ${share}% of runs" role="img" aria-label="${label(k)}: ${share}% of runs"></span>`;
    })
    .join("");
  return `
    <div class="tm-stats">
      <div><span class="label">Average, no edge</span><b class="${sim.noEdgeR >= 0 ? "up" : "down"}">${usd(sim.noEdgeR)}</b><small>costs and gaps</small></div>
      <div><span class="label">Typical</span><b>${usd(sim.medianR)}</b><small>median</small></div>
      <div><span class="label">Worst 1 in 20</span><b class="down">${usd(sim.worst5R)}</b><small>${fmtR(sim.worst5R)}</small></div>
      <div><span class="label">Best 1 in 20</span><b class="up">${usd(sim.best5R)}</b><small>${fmtR(sim.best5R)}</small></div>
    </div>
    <div class="tm-hist" role="group" aria-label="How the ${sim.runs.toLocaleString()} runs ended">${bars}</div>
    <div class="tm-axis"><span>${usd(edges[0])} or worse</span><span>$0</span><span>${usd(edges.at(-1))} or better</span></div>
    <p class="muted tm-fine">${sim.runs.toLocaleString()} runs, so the percentages can be off by about ±${(sim.marginOfError * 100).toFixed(1)} points. "R" is the amount you risk: 1R = ${fmtUsd(riskDollars).replace("+", "")} here.</p>`;
}

const rangeText = (r, k) => (r ? ` <span class="muted rng">${fmtPctPlain(r[k][0])}–${fmtPctPlain(r[k][1])}</span>` : "");

function verdictHtml(sim, plan, riskDollars, range) {
  const seg = (p, cls) => (p > 0 ? `<span class="seg ${cls}" style="flex-grow:${p}"></span>` : "");
  const loss = -sim.noEdgeR * riskDollars;
  const edgeLine =
    sim.pointsNeeded == null || loss < 1
      ? `With no edge, this setup averages about <b>$0</b> a trade. It's a fair bet, so any profit has to come from your read being right.`
      : `With no edge, this setup loses about <b>${fmtUsd(loss).replace("+", "")}</b> a trade to costs${sim.gappedStopShare > 0.05 ? " and gaps" : ""}. Your read has to make the target about <b>${sim.pointsNeeded < 1 ? "1 point" : `${Math.round(sim.pointsNeeded)} points`}</b> likelier than chance (${fmtPctPlain(sim.pTarget)}) to pay off.`;
  const notes = (globalThis.reviewPlan?.(plan, sim) || [])
    .map((n) => `<li class="note-${n.level}"><span aria-hidden="true">${n.level === "warn" ? "!" : "i"}</span>${escapeHtml(n.text)}</li>`)
    .join("");
  const t2 = sim.scaleOut && sim.pTarget2 > 0 ? ` <span class="muted">(${fmtPctPlain(sim.pTarget2)} went on to target 2)</span>` : "";
  return `
    <div class="tm-figs">
      <span><i class="sw win"></i>Target ${sim.scaleOut ? "1 " : ""}hit first <b>${fmtPctPlain(sim.pTarget)}</b>${rangeText(range, "pTarget")}${t2}</span>
      <span><i class="sw loss"></i>Stopped out <b>${fmtPctPlain(sim.pStop)}</b>${rangeText(range, "pStop")}</span>
      <span><i class="sw open"></i>Neither, still open <b>${fmtPctPlain(sim.pNeither)}</b>${rangeText(range, "pNeither")}</span>
    </div>
    <div class="tm-split" aria-hidden="true">${seg(sim.pTarget, "win")}${seg(sim.pNeither, "open")}${seg(sim.pStop, "loss")}</div>
    ${range ? `<p class="muted tm-fine">Gray ranges: the same plan if the stock moves a quarter less or a third more than ${plan.dailyVolPct}% a day.</p>` : ""}
    <p class="tm-edge">${edgeLine}</p>
    ${notes ? `<ul class="tm-notes">${notes}</ul>` : ""}`;
}

let planSeq = 0;

function planCard(original) {
  const id = `plan${++planSeq}`;
  const long = original.direction !== "short";
  const firstTargets = (Array.isArray(original.targets) ? original.targets : [original.target]).filter(isNum);
  const state = {
    entry: original.entry,
    stop: original.stop,
    t1: firstTargets[0] ?? null,
    t2: firstTargets[1] ?? null,
    horizon: original.horizon || "today",
    vol: isNum(original.daily_vol_pct) ? original.daily_vol_pct : null,
  };
  const card = document.createElement("div");
  card.className = "plan-card";
  const horizonOptions = [...HORIZON_CHOICES];
  if (!horizonOptions.some(([v]) => v === state.horizon)) horizonOptions.unshift([state.horizon, state.horizon]);

  const levelInput = (key, label, cls) => `
    <div class="lv ${cls}" data-key="${key}">
      <label class="lv-label" for="${id}-${key}">${label}</label>
      <input class="lv-price" id="${id}-${key}" type="number" step="0.01" inputmode="decimal" value="${isNum(state[key]) ? state[key] : ""}" ${key === "t2" ? 'placeholder="none"' : ""}>
      <span class="lv-dist"></span>
    </div>`;
  const levels = [
    levelInput("t2", "Target 2", "target"),
    levelInput("t1", firstTargets.length > 1 ? "Target 1" : "Target", "target"),
    levelInput("entry", "Entry", "entry"),
    levelInput("stop", "Stop", "stop"),
  ];
  if (!long) levels.reverse();

  card.innerHTML = `
    <div class="pc-head">
      <div>
        <div class="label">Trade plan</div>
        <div class="pc-title"><b>${escapeHtml(original.ticker || "")}</b> <span class="pc-dir ${long ? "long" : "short"}">${long ? "Long" : "Short"}</span></div>
      </div>
      <div class="pc-meta muted">${original.price_as_of ? `prices as of ${escapeHtml(original.price_as_of)}` : ""}</div>
    </div>
    <section class="pc-verdict" aria-live="polite"></section>
    <div class="pc-levels">${levels.join("")}</div>
    <div class="pc-controls">
      <label class="label" for="${id}-hz">Hold for</label>
      <select id="${id}-hz">${horizonOptions.map(([v, l]) => `<option value="${escapeHtml(v)}"${v === state.horizon ? " selected" : ""}>${escapeHtml(l)}</option>`).join("")}</select>
      <label class="label" for="${id}-vol">Daily move</label>
      <span class="pc-money"><input id="${id}-vol" type="number" min="0.1" step="0.1" inputmode="decimal" value="${state.vol ?? ""}" placeholder="?">%</span>
      <label class="label" for="${id}-risk">Risk</label>
      <span class="pc-money">$<input id="${id}-risk" type="number" min="1" step="10" inputmode="decimal" value="${currentRiskDollars}"></span>
      <button type="button" class="pc-reset" hidden>Reset to Atlas's plan</button>
    </div>
    <p class="pc-size"></p>
    ${original.entry_condition ? `<p class="pc-rule"><span class="label">Enter only if</span> ${escapeHtml(original.entry_condition)}</p>` : ""}
    ${original.exit_rules ? `<p class="pc-rule"><span class="label">Exit plan</span> ${escapeHtml(original.exit_rules)}</p>` : ""}
    ${original.invalidation ? `<p class="pc-rule"><span class="label">Wrong if</span> ${escapeHtml(original.invalidation)}</p>` : ""}
    <details class="pc-details">
      <summary>How the 10,000 runs ended</summary>
      <div class="pc-details-body"></div>
    </details>
    <p class="pc-tm-note muted"></p>`;

  const $ = (sel) => card.querySelector(sel);
  const verdict = $(".pc-verdict");
  const details = $(".pc-details-body");
  const sizeLine = $(".pc-size");
  const note = $(".pc-tm-note");
  const reset = $(".pc-reset");
  const inputs = Object.fromEntries(["entry", "stop", "t1", "t2"].map((k) => [k, card.querySelector(`#${id}-${k}`)]));
  const hz = card.querySelector(`#${id}-hz`);
  const risk = card.querySelector(`#${id}-risk`);
  const volInput = card.querySelector(`#${id}-vol`);
  let rangeTimer = 0;
  const num = (el) => (el.value === "" ? null : Number(el.value));

  let timer = 0;
  const run = () => {
    const horizon = parseHorizon(state.horizon);
    const riskPerShare = isNum(state.entry) && isNum(state.stop) ? Math.abs(state.entry - state.stop) : null;
    for (const [key, el] of Object.entries(inputs)) {
      const dist = card.querySelector(`.lv[data-key="${key}"] .lv-dist`);
      const v = state[key];
      if (!isNum(v) || !isNum(state.entry) || key === "entry") {
        dist.textContent = "";
        continue;
      }
      const pct = ((v - state.entry) / state.entry) * 100;
      dist.textContent = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%${riskPerShare ? ` · ${(Math.abs(v - state.entry) / riskPerShare).toFixed(1)}R` : ""}`;
    }
    const shares = riskPerShare ? Math.floor(currentRiskDollars / riskPerShare) : 0;
    const riskDollars = shares * (riskPerShare || 0);
    if (shares > 0) {
      const at = (p) => fmtUsd(shares * Math.abs(p - state.entry));
      const costs = shares * state.entry * ((isNum(original.cost_bps) ? original.cost_bps : 10) / 10000);
      sizeLine.innerHTML = `<b>${shares.toLocaleString()} shares</b> (${fmtUsd(shares * state.entry).replace("+", "")} position, about ${fmtUsd(costs).replace("+", "")} in trading costs). If stopped: <b class="down">−${at(state.stop).replace("+", "")}</b>${isNum(state.t1) ? ` · at target${isNum(state.t2) ? " 1" : ""}: <b class="up">${at(state.t1)}</b>` : ""}${isNum(state.t2) ? ` · at target 2: <b class="up">${at(state.t2)}</b>` : ""}`;
    } else {
      sizeLine.innerHTML = riskPerShare ? `<span class="muted">Less than one share fits this risk at this stop distance.</span>` : "";
    }
    const jumpDay = earningsDay(original.next_earnings, original.earnings_time);
    const knownMove = isNum(original.earnings_move_pct);
    const earningsMove = knownMove ? original.earnings_move_pct : isNum(state.vol) ? state.vol * 3 : null;
    const simPlan = {
      direction: long ? "long" : "short",
      entry: state.entry,
      stop: state.stop,
      target: state.t1,
      target2: state.t2,
      dailyVolPct: state.vol,
      horizon,
      costBps: isNum(original.cost_bps) ? original.cost_bps : 10,
      events: jumpDay && earningsMove ? [{ day: jumpDay, movePct: earningsMove }] : [],
    };
    const sim = globalThis.simulateTrade(simPlan);
    if (sim.ok) {
      const show = (range) => {
        verdict.innerHTML = verdictHtml(sim, simPlan, riskDollars || currentRiskDollars, range);
      };
      show(null);
      clearTimeout(rangeTimer);
      rangeTimer = setTimeout(() => show(globalThis.volatilityRange(simPlan, sim)), 30);
      details.innerHTML = simDetailsHtml(sim, riskDollars || currentRiskDollars);
      const volBasis = state.vol === original.daily_vol_pct && original.vol_source ? ` (${original.vol_source})` : state.vol !== original.daily_vol_pct ? " (your number)" : "";
      const earningsBasis = sim.eventsInside
        ? ` Earnings (${fmtDate(original.next_earnings)}, ${original.earnings_time || "time unknown"}) is modeled as an overnight jump averaging ±${earningsMove.toFixed(1)}%${knownMove ? "" : ", estimated at 3× a normal day because the stock's usual earnings move wasn't found"}.`
        : "";
      note.textContent = `Time machine: ${sim.runs.toLocaleString()} random price paths at ${state.vol}% a day${volBasis}, ${original.cost_bps ?? 10} bps costs, ${sim.scaleOut ? "half sold at target 1 and the stop moved to entry, " : ""}no edge assumed.${earningsBasis} It shows the odds your levels create, not where the stock will go.`;
    } else {
      verdict.innerHTML = `<p class="muted">The time machine can't run yet: the plan needs ${escapeHtml(sim.needs.join(", "))}.</p>`;
      details.innerHTML = "";
      note.textContent = "";
    }
    const edited = state.entry !== original.entry || state.stop !== original.stop || state.t1 !== (firstTargets[0] ?? null) || state.t2 !== (firstTargets[1] ?? null) || state.horizon !== (original.horizon || "today") || state.vol !== (isNum(original.daily_vol_pct) ? original.daily_vol_pct : null);
    reset.hidden = !edited;
    card.classList.toggle("edited", edited);
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(run, 120);
  };

  for (const [key, el] of Object.entries(inputs)) {
    el.addEventListener("input", () => {
      state[key] = num(el);
      schedule();
    });
  }
  hz.addEventListener("change", () => {
    state.horizon = hz.value;
    run();
  });
  volInput.addEventListener("input", () => {
    state.vol = num(volInput);
    schedule();
  });
  risk.addEventListener("input", () => {
    const v = Number(risk.value);
    currentRiskDollars = v > 0 ? v : RISK_DEFAULT;
    schedule();
  });
  reset.addEventListener("click", () => {
    Object.assign(state, { entry: original.entry, stop: original.stop, t1: firstTargets[0] ?? null, t2: firstTargets[1] ?? null, horizon: original.horizon || "today", vol: isNum(original.daily_vol_pct) ? original.daily_vol_pct : null });
    volInput.value = state.vol ?? "";
    for (const [key, el] of Object.entries(inputs)) el.value = isNum(state[key]) ? state[key] : "";
    hz.value = state.horizon;
    run();
  });
  run();
  return card;
}

function moversList(items) {
  const wrap = document.createElement("div");
  wrap.className = "movers";
  wrap.innerHTML = `<div class="label">What's moving</div>` +
    items
      .filter((m) => m && typeof m.ticker === "string")
      .map((m) => {
        const chg = isNum(m.change_pct) ? m.change_pct : null;
        const src = m.url ? ` <a href="${escapeHtml(m.url)}" target="_blank" rel="noopener noreferrer">source</a>` : "";
        return `<div class="mv">
          <b class="mv-t">${escapeHtml(m.ticker)}</b>
          <span class="mv-c ${chg == null ? "muted" : chg >= 0 ? "up" : "down"}">${chg == null ? "n/a" : `${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%`}</span>
          <span class="mv-why">${escapeHtml(m.catalyst || "No clear news")}${src}${m.as_of ? ` <span class="muted">· ${escapeHtml(m.as_of)}</span>` : ""}</span>
        </div>`;
      })
      .join("");
  return wrap;
}
