const feed = document.getElementById("feed");
const empty = document.getElementById("empty");
const form = document.getElementById("composer");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");

let conversationId = null;
let busy = false;

const RATING_COLORS = {
  "strong buy": "var(--up)",
  buy: "var(--up)",
  hold: "var(--hold)",
  sell: "var(--down)",
  "strong sell": "var(--down)",
};
const GRADE_LABELS = { value: "Value", growth: "Growth", profitability: "Profit", momentum: "Momentum", health: "Health" };

const isNum = (n) => typeof n === "number" && Number.isFinite(n);
const fmtPrice = (n) =>
  isNum(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "n/a";
const fmtShort = (n) => (isNum(n) ? `$${n.toLocaleString(undefined, { maximumFractionDigits: n < 100 ? 2 : 0 })}` : "n/a");
const ratingColor = (r) => RATING_COLORS[String(r).toLowerCase()] || "var(--muted)";
const pctFrom = (from, to) => (isNum(from) && isNum(to) && from > 0 ? ((to - from) / from) * 100 : null);
const fmtPct = (p) => (p == null ? "n/a" : `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`);

function fmtDate(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? escapeHtml(iso) : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Bear / base / bull range with a marker for today's price.
function scenarioBar(price, sc) {
  if (!sc || ![sc.bear, sc.base, sc.bull].every(isNum)) return "";
  const lo = Math.min(sc.bear, isNum(price) ? price : sc.bear);
  const hi = Math.max(sc.bull, isNum(price) ? price : sc.bull);
  const span = hi - lo || 1;
  const pos = (v) => (((v - lo) / span) * 100).toFixed(2);
  return `
    <div class="rc-range">
      <div class="label">12-month scenarios</div>
      <div class="range-track">
        <span class="range-band" style="left:${pos(sc.bear)}%;width:${(pos(sc.bull) - pos(sc.bear)).toFixed(2)}%"></span>
        <span class="range-tick" style="left:${pos(sc.base)}%"></span>
        ${isNum(price) ? `<span class="range-now" style="left:${pos(price)}%"><em>Now</em></span>` : ""}
      </div>
      <div class="range-legend">
        <div><span class="label">Bear</span><b class="down">${fmtShort(sc.bear)}</b><small>${fmtPct(pctFrom(price, sc.bear))}</small></div>
        <div><span class="label">Base</span><b>${fmtShort(sc.base)}</b><small>${fmtPct(pctFrom(price, sc.base))}</small></div>
        <div><span class="label">Bull</span><b class="up">${fmtShort(sc.bull)}</b><small>${fmtPct(pctFrom(price, sc.bull))}</small></div>
      </div>
    </div>`;
}

function gradeRow(grades) {
  if (!grades) return "";
  const cells = Object.entries(GRADE_LABELS)
    .filter(([key]) => typeof grades[key] === "string")
    .map(([key, label]) => {
      const g = grades[key].trim().toUpperCase().slice(0, 2);
      const tone = /^[AB]/.test(g) ? "good" : /^C/.test(g) ? "mid" : "bad";
      return `<div class="grade"><b class="grade-${tone}">${escapeHtml(g)}</b><span>${label}</span></div>`;
    });
  return cells.length ? `<div class="rc-grades" aria-label="Factor grades versus sector peers">${cells.join("")}</div>` : "";
}

function streetRow(street, ourTarget) {
  if (!street || (!street.rating && !isNum(street.avg_target))) return "";
  const gap = pctFrom(street.avg_target, ourTarget);
  return `
    <div class="rc-street">
      <span class="label">Wall Street</span>
      ${street.rating ? `<span class="street-pill" style="--rating-color:${ratingColor(street.rating)}">${escapeHtml(street.rating)}</span>` : ""}
      ${isNum(street.avg_target) ? `<span>Avg target <b>${fmtShort(street.avg_target)}</b></span>` : ""}
      ${isNum(street.analysts) ? `<span class="muted">${street.analysts} analysts</span>` : ""}
      ${gap != null ? `<span class="muted">Atlas is ${Math.abs(gap).toFixed(0)}% ${gap >= 0 ? "above" : "below"}</span>` : ""}
    </div>`;
}

// "Why 68%?" panel: each factor as a bar with a plain-English note.
function confidenceBreakdown(conf) {
  const rows = conf.factors
    .map(
      (f) => `<li>
        <span class="cf-label">${escapeHtml(f.label)}</span>
        <span class="cf-bar"><span style="width:${Math.round(f.score * 100)}%"></span></span>
        <span class="cf-note">${escapeHtml(f.note)}</span>
      </li>`,
    )
    .join("");
  const warnings = conf.warnings.map((w) => `<p class="cf-warn">${escapeHtml(w)}</p>`).join("");
  return `
    <details class="rc-confidence">
      <summary>Why ${conf.value}%?</summary>
      <p class="cf-intro">How strongly the evidence backs this call, from 5% to 95%. It is not the chance of making money, and it never reaches 100%.</p>
      <ul>${rows}</ul>
      ${warnings}
    </details>`;
}

function ratingCard(data) {
  const upside = pctFrom(data.price, data.target);
  const conf = globalThis.computeConfidence?.(data) ?? null;
  const facts = [
    data.moat ? `<span><span class="label">Moat</span> ${escapeHtml(data.moat)}</span>` : "",
    data.next_earnings ? `<span><span class="label">Next earnings</span> ${fmtDate(data.next_earnings)}</span>` : "",
  ].filter(Boolean);

  const card = document.createElement("div");
  card.className = "rating-card";
  card.style.setProperty("--rating-color", ratingColor(data.rating));
  card.innerHTML = `
    <div class="rc-head">
      <div>
        <div class="rc-ticker">${escapeHtml(data.ticker)}</div>
        <div class="rc-company">${escapeHtml(data.company)}</div>
      </div>
      <div class="rc-actions">
        <div class="rc-rating">${escapeHtml(data.rating)}</div>
        <button type="button" class="watch-btn"></button>
      </div>
    </div>
    <div class="rc-stats">
      <div class="rc-stat">
        <div class="label">Price</div>
        <div class="value">${fmtPrice(data.price)}</div>
        <div class="sub">${data.price_as_of ? `as of ${fmtDate(data.price_as_of)}` : "unverified"}</div>
      </div>
      <div class="rc-stat">
        <div class="label">Target</div>
        <div class="value">${fmtPrice(data.target)}</div>
        <div class="sub">${escapeHtml(data.horizon || "")}</div>
      </div>
      <div class="rc-stat">
        <div class="label">Upside</div>
        <div class="value ${upside == null ? "" : upside >= 0 ? "up" : "down"}">${fmtPct(upside)}</div>
      </div>
      <div class="rc-stat">
        <div class="label">Confidence</div>
        ${
          conf
            ? `<div class="value conf-${conf.level.toLowerCase()}">${conf.value}%</div>
               <div class="conf-bar" role="img" aria-label="Confidence ${conf.value} out of 100"><span style="width:${conf.value}%"></span></div>
               <div class="sub">${conf.level}</div>`
            : `<div class="value">n/a</div>`
        }
      </div>
    </div>
    ${conf ? confidenceBreakdown(conf) : ""}
    ${scenarioBar(data.price, data.scenarios)}
    ${gradeRow(data.grades)}
    ${streetRow(data.street, data.target)}
    ${facts.length ? `<div class="rc-facts">${facts.join("")}</div>` : ""}
    ${data.thesis ? `<p class="rc-thesis">${escapeHtml(data.thesis)}</p>` : ""}`;

  const btn = card.querySelector(".watch-btn");
  btn.dataset.card = JSON.stringify({ ticker: data.ticker, rating: data.rating, target: data.target, price: data.price, confidence: conf?.value ?? null });
  syncWatchButton(btn);
  return card;
}

function followupChips(questions) {
  const row = document.createElement("div");
  row.className = "followups";
  for (const q of questions.filter((q) => typeof q === "string").slice(0, 3)) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = q;
    chip.addEventListener("click", () => ask(q));
    row.appendChild(chip);
  }
  return row;
}

function renderMarkdown(el, markdown, streaming) {
  el.innerHTML = DOMPurify.sanitize(marked.parse(markdown));

  for (const code of el.querySelectorAll("pre > code.language-rating")) {
    const pre = code.parentElement;
    try {
      pre.replaceWith(ratingCard(JSON.parse(code.textContent)));
    } catch {
      // Mid-stream the JSON is incomplete; show a placeholder until it closes.
      if (streaming) {
        const pending = document.createElement("div");
        pending.className = "rating-card pending";
        pending.textContent = "Building rating card…";
        pre.replaceWith(pending);
      }
    }
  }
  for (const code of el.querySelectorAll("pre > code.language-followups")) {
    const pre = code.parentElement;
    let questions = null;
    try {
      questions = JSON.parse(code.textContent);
    } catch {}
    if (Array.isArray(questions) && !streaming) pre.replaceWith(followupChips(questions));
    else pre.remove();
  }
  for (const table of el.querySelectorAll("table")) {
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    table.replaceWith(wrap);
    wrap.appendChild(table);
  }
  for (const a of el.querySelectorAll("a")) {
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  }
}

// The server keeps the watchlist and tracked people in the spine, so every
// device sees the same lists.
async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  if (res.status === 401) location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Watchlist: each ticker with the latest rating Atlas issued for it.
const watchlist = (() => {
  let items = [];
  const listeners = new Set();
  const set = (next) => {
    items = next.map((i) => {
      const r = i.rating || {};
      const conf = i.rating ? globalThis.computeConfidence?.(r) ?? null : null;
      return { ticker: i.ticker, rating: r.rating, target: r.target, price: r.price, confidence: conf?.value ?? null };
    });
    listeners.forEach((fn) => fn());
  };
  const change = (ticker, watch) => api("api/watchlist", { ticker, watch }).then((d) => set(d.items)).catch(showError);
  return {
    items: () => items,
    has: (ticker) => items.some((i) => i.ticker === ticker),
    add: (card) => change(card.ticker, true),
    remove: (ticker) => change(ticker, false),
    load: () => api("api/watchlist").then((d) => set(d.items)).catch(showError),
    onChange: (fn) => listeners.add(fn),
  };
})();

function showError(err) {
  const line = document.createElement("p");
  line.className = "error-line";
  line.textContent = err.message || "Couldn't reach the server.";
  feed.appendChild(line);
}

function renderWatchlist() {
  const strip = document.getElementById("watchlist");
  const list = strip.querySelector(".wl-items");
  list.innerHTML = "";
  const items = watchlist.items();
  strip.classList.toggle("is-empty", items.length === 0);
  for (const item of items) {
    const chip = document.createElement("div");
    chip.className = "wl-chip";
    chip.style.setProperty("--rating-color", ratingColor(item.rating));
    const upside = pctFrom(item.price, item.target);
    chip.innerHTML = `
      <button type="button" class="wl-open" title="Ask for an update on ${escapeHtml(item.ticker)}">
        <b>${escapeHtml(item.ticker)}</b>
        <span class="wl-rating">${escapeHtml(item.rating || "")}</span>
        ${upside != null ? `<span class="${upside >= 0 ? "up" : "down"}">${fmtPct(upside)}</span>` : ""}
        ${isNum(item.confidence) ? `<span class="wl-conf" title="Confidence score">${item.confidence}%</span>` : ""}
      </button>
      <button type="button" class="wl-remove" aria-label="Remove ${escapeHtml(item.ticker)} from watchlist">×</button>`;
    chip.querySelector(".wl-open").addEventListener("click", () =>
      ask(`What's the latest on ${item.ticker}? Has your view changed?`),
    );
    chip.querySelector(".wl-remove").addEventListener("click", () => watchlist.remove(item.ticker));
    list.appendChild(chip);
  }
}
function syncWatchButton(btn) {
  const on = watchlist.has(JSON.parse(btn.dataset.card).ticker);
  btn.textContent = on ? "✓ Watching" : "+ Watchlist";
  btn.setAttribute("aria-pressed", String(on));
}

// One delegated handler, since cards are re-rendered while a reply streams.
feed.addEventListener("click", (e) => {
  const btn = e.target.closest(".watch-btn");
  if (!btn) return;
  const card = JSON.parse(btn.dataset.card);
  watchlist.has(card.ticker) ? watchlist.remove(card.ticker) : watchlist.add(card);
});

// People whose disclosed trades you follow.
const people = (() => {
  let names = [];
  const set = (d) => {
    names = d.people;
    renderPeople();
  };
  return {
    list: () => names,
    add: (name) => api("api/people", { name, track: true }).then(set).catch(showError),
    remove: (name) => api("api/people", { name, track: false }).then(set).catch(showError),
    load: () => api("api/people").then(set).catch(showError),
  };
})();

function renderPeople() {
  const list = document.querySelector("#people .wl-items");
  list.innerHTML = "";
  for (const name of people.list()) {
    const chip = document.createElement("div");
    chip.className = "wl-chip person";
    chip.innerHTML = `
      <button type="button" class="wl-open" title="Scan disclosed trades by ${escapeHtml(name)}"><b>${escapeHtml(name)}</b></button>
      <button type="button" class="wl-remove" aria-label="Stop tracking ${escapeHtml(name)}">×</button>`;
    chip.querySelector(".wl-open").addEventListener("click", () =>
      ask(`Scan the latest disclosed stock trades by ${name}. What did they buy or sell recently?`),
    );
    chip.querySelector(".wl-remove").addEventListener("click", () => people.remove(name));
    list.appendChild(chip);
  }
}

const personForm = document.getElementById("person-form");
const personInput = document.getElementById("person-input");
const personAdd = document.getElementById("person-add");
personAdd.addEventListener("click", () => {
  personForm.hidden = false;
  personAdd.hidden = true;
  personInput.focus();
});
personForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = personInput.value.trim().replace(/\s+/g, " ");
  if (name) people.add(name);
  personInput.value = "";
  personForm.hidden = true;
  personAdd.hidden = false;
});
personInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") personForm.requestSubmit();
});
people.load();

watchlist.onChange(renderWatchlist);
watchlist.onChange(() => document.querySelectorAll(".watch-btn").forEach(syncWatchButton));
watchlist.load();

// Insider filings table, built straight from the SEC data (not from the model's text).
const fmtMoney = (n) => {
  if (!isNum(n)) return "n/a";
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};
const fmtShares = (n) => (isNum(n) ? n.toLocaleString() : "n/a");
const INSIDER_ROWS_SHOWN = 10;

function insiderCard(data) {
  const byPerson = data.mode === "person";
  const rows = [];
  for (const f of data.filings || []) {
    const who = byPerson
      ? `<b>${escapeHtml(f.issuer?.ticker || "")}</b> <span class="muted">${escapeHtml(f.issuer?.name || "")}</span>`
      : escapeHtml((f.owners || []).map((o) => o.name).join(", "));
    const role = escapeHtml([...new Set((f.owners || []).flatMap((o) => o.roles))].join(", "));
    const link = `<a href="${escapeHtml(f.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(f.filed)}</a>`;
    const txs = f.transactions?.length ? f.transactions : [null];
    for (const t of txs) {
      const kind = !t ? "other" : t.code === "P" ? "buy" : t.code === "S" ? "sell" : "other";
      rows.push(`<tr>
        <td>${t ? escapeHtml(t.date) : ""}</td>
        <td class="who">${who}</td>
        <td class="muted">${role}</td>
        <td><span class="tx tx-${kind}">${t ? escapeHtml(t.type) : f.derivativeCount ? "Options only" : "No trades"}</span>${f.tradingPlan ? ' <span class="plan" title="Pre-arranged Rule 10b5-1 trading plan">10b5-1</span>' : ""}</td>
        <td class="num">${t ? fmtShares(t.shares) : ""}</td>
        <td class="num">${t && t.price ? fmtPrice(t.price) : ""}</td>
        <td class="num">${t ? fmtMoney(t.value) : ""}</td>
        <td class="num">${t ? fmtShares(t.sharesAfter) : ""}</td>
        <td>${link}</td>
      </tr>`);
    }
  }
  const s = data.summary || {};
  const card = document.createElement("div");
  card.className = "insider-card";
  card.innerHTML = `
    <div class="ic-head">
      <div>
        <div class="label">${byPerson ? "Trades filed by" : "Insider activity"}</div>
        <div class="ic-subject">${escapeHtml(data.subject)}</div>
      </div>
      <a class="ic-source" href="${escapeHtml(data.source)}" target="_blank" rel="noopener noreferrer">SEC EDGAR ↗</a>
    </div>
    <div class="ic-summary">
      <span class="tx tx-buy">Buys ${s.openMarketBuys ?? 0} · ${fmtMoney(s.boughtValue ?? 0)}</span>
      <span class="tx tx-sell">Sells ${s.openMarketSells ?? 0} · ${fmtMoney(s.soldValue ?? 0)}</span>
      <span class="muted">Last ${(data.filings || []).length} Form 4 filings</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Trade date</th><th>${byPerson ? "Company" : "Insider"}</th><th>Role</th><th>Type</th><th class="num">Shares</th><th class="num">Price</th><th class="num">Value</th><th class="num">Held after</th><th>Filed</th></tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>`;
  const body = card.querySelector("tbody");
  if (rows.length > INSIDER_ROWS_SHOWN) {
    [...body.rows].slice(INSIDER_ROWS_SHOWN).forEach((r) => (r.hidden = true));
    const more = document.createElement("button");
    more.type = "button";
    more.className = "ic-more";
    more.textContent = `Show all ${rows.length} trades`;
    more.addEventListener("click", () => {
      [...body.rows].forEach((r) => (r.hidden = false));
      more.remove();
    });
    card.appendChild(more);
  }
  return card;
}

function timestamp() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function addUserMessage(text) {
  const msg = document.createElement("div");
  msg.className = "msg msg-user";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  msg.appendChild(bubble);
  feed.appendChild(msg);
}

function addAnalystMessage() {
  const msg = document.createElement("div");
  msg.className = "msg msg-analyst";
  msg.innerHTML = `
    <div class="byline"><b>ATLAS</b><span>EQUITY RESEARCH · ${timestamp()}</span></div>
    <div class="status">Analyzing…</div>
    <div class="body"></div>
    <div class="insider-slot"></div>`;
  feed.appendChild(msg);
  return {
    msg,
    status: msg.querySelector(".status"),
    body: msg.querySelector(".body"),
    insiders: msg.querySelector(".insider-slot"),
  };
}

function scrollToBottom() {
  feed.scrollTop = feed.scrollHeight;
}

// Parses the server-sent events from a fetch response body.
async function* readEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      let event = "message";
      let data = "";
      for (const line of raw.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      yield { event, data: data ? JSON.parse(data) : {} };
    }
  }
}

async function ask(text) {
  if (busy || !text.trim()) return;
  busy = true;
  sendBtn.disabled = true;
  empty?.remove();

  addUserMessage(text);
  const view = addAnalystMessage();
  scrollToBottom();

  let markdown = "";
  let frame = 0;
  const paint = () => {
    frame = 0;
    renderMarkdown(view.body, markdown, true);
    scrollToBottom();
  };

  try {
    const response = await fetch("api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, message: text }),
    });
    if (response.status === 401) location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
    if (!response.ok) {
      const { error } = await response.json().catch(() => ({}));
      throw new Error(error || `Request failed (${response.status})`);
    }

    for await (const { event, data } of readEvents(response)) {
      if (event === "meta") conversationId = data.conversationId;
      else if (event === "status") view.status.textContent = data.text;
      else if (event === "delta") {
        markdown += data.text;
        view.status.textContent = "Writing…";
        if (!frame) frame = requestAnimationFrame(paint);
      } else if (event === "insiders") {
        view.insiders.appendChild(insiderCard(data));
      } else if (event === "sources") {
        const details = document.createElement("details");
        details.className = "sources";
        details.innerHTML = `<summary>SOURCES (${data.sources.length})</summary><ol>${data.sources
          .map((s) => `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title)}</a></li>`)
          .join("")}</ol>`;
        view.msg.appendChild(details);
      } else if (event === "error") {
        const line = document.createElement("p");
        line.className = "error-line";
        line.textContent = data.message;
        view.msg.appendChild(line);
      }
    }
  } catch (err) {
    const line = document.createElement("p");
    line.className = "error-line";
    line.textContent = err.message || "Connection lost.";
    view.msg.appendChild(line);
  } finally {
    if (frame) cancelAnimationFrame(frame);
    renderMarkdown(view.body, markdown, false);
    view.status.remove();
    // The server records any rating card at the end of the reply.
    watchlist.load();
    busy = false;
    sendBtn.disabled = false;
    scrollToBottom();
    input.focus();
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value;
  input.value = "";
  input.style.height = "auto";
  ask(text);
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight}px`;
});

for (const chip of document.querySelectorAll(".chip")) {
  chip.addEventListener("click", () => ask(chip.textContent));
}
