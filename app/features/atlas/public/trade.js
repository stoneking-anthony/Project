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

const fmtR = (r) => `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}R`;
const fmtPctPlain = (p) => `${Math.round(p * 100)}%`;
const fmtUsd = (n) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function levelRow(label, price, entry, riskPerShare, cls) {
  const dist = ((price - entry) / entry) * 100;
  const r = riskPerShare ? Math.abs(price - entry) / riskPerShare : null;
  return `<div class="lv ${cls}">
    <span class="lv-label">${label}</span>
    <span class="lv-price">${fmtPrice(price)}</span>
    <span class="lv-dist">${dist >= 0 ? "+" : ""}${dist.toFixed(1)}%${r != null && cls !== "entry" ? ` · ${r.toFixed(1)}R` : ""}</span>
  </div>`;
}

// Outcome split (thin segmented bar; the figures beside it carry the numbers)
// and the distribution of results in R as bars on one baseline.
function simResultHtml(sim, riskDollars) {
  const seg = (p, cls) => (p > 0 ? `<span class="seg ${cls}" style="flex-grow:${p}"></span>` : "");
  const max = Math.max(...sim.histogram.bins);
  const { edges, bins } = sim.histogram;
  const binLabel = (k) =>
    k === 0 ? `below ${edges[0]}R` : k === edges.length ? `above ${edges.at(-1)}R` : `${edges[k - 1]}R to ${edges[k]}R`;
  const binMid = (k) => (k === 0 ? edges[0] - 0.25 : k === edges.length ? edges.at(-1) + 0.25 : (edges[k - 1] + edges[k]) / 2);
  const bars = bins
    .map((b, k) => {
      const tone = binMid(k) < 0 ? "loss" : "win";
      const h = max ? Math.max(b ? 2 : 0, (b / max) * 100) : 0;
      const share = ((b / sim.runs) * 100).toFixed(1);
      return `<span class="hb ${tone}" style="height:${h}%" title="${binLabel(k)}: ${share}% of runs" role="img" aria-label="${binLabel(k)}: ${share}% of runs"></span>`;
    })
    .join("");
  const dollars = riskDollars > 0 ? ` <span class="muted">≈ ${fmtUsd(sim.expectedR * riskDollars)} a trade</span>` : "";
  const edgeWord = sim.pTarget > sim.breakevenWinRate + sim.marginOfError ? "above" : sim.pTarget < sim.breakevenWinRate - sim.marginOfError ? "below" : "about at";
  return `
    <p class="tm-headline">Target first in <b>${fmtPctPlain(sim.pTarget)}</b> of ${sim.runs.toLocaleString()} runs <span class="muted">(±${(sim.marginOfError * 100).toFixed(1)} pts)</span>. You need <b>${fmtPctPlain(sim.breakevenWinRate)}</b> to break even after costs: the simulated win rate is ${edgeWord} that.</p>
    <div class="tm-split" aria-hidden="true">${seg(sim.pTarget, "win")}${seg(sim.pNeither, "open")}${seg(sim.pStop, "loss")}</div>
    <div class="tm-figs">
      <span><i class="sw win"></i>Target first <b>${fmtPctPlain(sim.pTarget)}</b></span>
      <span><i class="sw open"></i>Still open at the end <b>${fmtPctPlain(sim.pNeither)}</b></span>
      <span><i class="sw loss"></i>Stopped out <b>${fmtPctPlain(sim.pStop)}</b>${sim.gappedStopShare > 0.005 ? ` <span class="muted">(${fmtPctPlain(sim.gappedStopShare)} gapped past the stop)</span>` : ""}</span>
    </div>
    <div class="tm-stats">
      <div><span class="label">Average result</span><b class="${sim.expectedR >= 0 ? "up" : "down"}">${fmtR(sim.expectedR)}</b>${dollars}</div>
      <div><span class="label">Typical (median)</span><b>${fmtR(sim.medianR)}</b></div>
      <div><span class="label">Worst 5%</span><b class="down">${fmtR(sim.worst5R)}</b></div>
      <div><span class="label">Best 5%</span><b class="up">${fmtR(sim.best5R)}</b></div>
    </div>
    <div class="tm-hist" role="group" aria-label="How the ${sim.runs.toLocaleString()} runs ended, in R">${bars}</div>
    <div class="tm-axis"><span>${edges[0]}R or worse</span><span>0</span><span>${edges.at(-1)}R or better</span></div>`;
}
let currentRiskDollars = RISK_DEFAULT; // shared by every card this visit; not stored

function planCard(plan) {
  const card = document.createElement("div");
  card.className = "plan-card";
  const long = plan.direction !== "short";
  const targets = (Array.isArray(plan.targets) ? plan.targets : [plan.target]).filter(isNum);
  const entry = plan.entry;
  const riskPerShare = isNum(entry) && isNum(plan.stop) ? Math.abs(entry - plan.stop) : null;
  const horizon = parseHorizon(plan.horizon);
  const levels = [
    ...targets.map((t, i) => levelRow(targets.length > 1 ? `Target ${i + 1}` : "Target", t, entry, riskPerShare, "target")).reverse(),
    isNum(entry) ? levelRow("Entry", entry, entry, riskPerShare, "entry") : "",
    isNum(plan.stop) ? levelRow("Stop", plan.stop, entry, riskPerShare, "stop") : "",
  ];
  if (!long) levels.reverse();

  card.innerHTML = `
    <div class="pc-head">
      <div>
        <div class="label">Trade plan</div>
        <div class="pc-title"><b>${escapeHtml(plan.ticker || "")}</b> <span class="pc-dir ${long ? "long" : "short"}">${long ? "Long" : "Short"}</span></div>
      </div>
      <div class="pc-meta muted">${escapeHtml(horizon.label)}${plan.price_as_of ? `<br>prices as of ${escapeHtml(plan.price_as_of)}` : ""}</div>
    </div>
    <div class="pc-levels">${levels.join("")}</div>
    ${plan.entry_condition ? `<p class="pc-rule"><span class="label">Enter only if</span> ${escapeHtml(plan.entry_condition)}</p>` : ""}
    ${plan.exit_rules ? `<p class="pc-rule"><span class="label">Exit plan</span> ${escapeHtml(plan.exit_rules)}</p>` : ""}
    ${plan.invalidation ? `<p class="pc-rule"><span class="label">Wrong if</span> ${escapeHtml(plan.invalidation)}</p>` : ""}
    <div class="pc-size">
      <label for="risk-${plan.ticker}-${Date.now()}" class="label">Risk per trade</label>
      <span class="pc-money">$<input type="number" min="1" step="10" inputmode="decimal" value="${currentRiskDollars}" aria-label="Dollars you're willing to lose on this trade"></span>
      <span class="pc-size-out"></span>
    </div>
    <div class="pc-tm">
      <div class="pc-tm-head"><span class="label">Time machine</span><span class="muted pc-tm-basis"></span></div>
      <div class="pc-tm-body"></div>
      <p class="pc-tm-note muted">A simulation of random price paths at this stock's volatility, with no edge assumed. It shows the odds your levels create, not where the stock will go.</p>
    </div>`;

  const riskInput = card.querySelector(".pc-size input");
  riskInput.id = card.querySelector(".pc-size label").htmlFor;
  const sizeOut = card.querySelector(".pc-size-out");
  const body = card.querySelector(".pc-tm-body");
  const basis = card.querySelector(".pc-tm-basis");

  const sim = globalThis.simulateTrade({
    direction: long ? "long" : "short",
    entry,
    stop: plan.stop,
    target: targets[0],
    dailyVolPct: plan.daily_vol_pct,
    horizon,
    costBps: isNum(plan.cost_bps) ? plan.cost_bps : 10,
  });

  const update = () => {
    const risk = Number(riskInput.value);
    currentRiskDollars = risk > 0 ? risk : RISK_DEFAULT;
    if (riskPerShare) {
      const shares = Math.floor(currentRiskDollars / riskPerShare);
      sizeOut.innerHTML = shares > 0
        ? `= <b>${shares.toLocaleString()} shares</b> <span class="muted">(${fmtUsd(shares * entry)} position, stop ${fmtPrice(riskPerShare)} away)</span>`
        : `<span class="muted">Less than one share at this stop distance.</span>`;
    }
    if (sim.ok) body.innerHTML = simResultHtml(sim, Math.floor(currentRiskDollars / riskPerShare) * riskPerShare);
  };

  if (sim.ok) {
    basis.textContent = `${sim.runs.toLocaleString()} runs · ${plan.daily_vol_pct}% daily volatility${plan.vol_source ? ` (${plan.vol_source})` : ""} · ${(sim.costR).toFixed(2)}R costs`;
  } else {
    body.innerHTML = `<p class="muted">Can't simulate yet: the plan needs ${escapeHtml(sim.needs.join(", "))}.</p>`;
  }
  riskInput.addEventListener("input", update);
  update();
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
