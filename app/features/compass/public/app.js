const feed = document.getElementById("feed");
const empty = document.getElementById("empty");
const form = document.getElementById("composer");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
let conversationId = null;
let busy = false;
let today = null;

const KIND_LABELS = {
  meeting: "Meeting",
  focus: "Focus",
  workout: "Workout",
  admin: "Admin",
  meal: "Meal",
  break: "Break",
  personal: "Personal",
  travel: "Travel",
};

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// "HH:MM" in the user's time zone right now.
function nowHHMM() {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
}

// "13:30" -> "1:30 PM" (or 24-hour, following the browser's locale).
function fmtTime(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function greeting() {
  const h = Number(nowHHMM().slice(0, 2));
  return h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening.";
}

// Schedule blocks, with past blocks dimmed and the current one highlighted.
function timeline(blocks, isToday) {
  if (!blocks?.length) return "";
  const now = nowHHMM();
  const rows = blocks.map((b) => {
    const kind = KIND_LABELS[b.kind] ? b.kind : "focus";
    const end = b.end || b.start;
    const state = !isToday ? "" : end <= now && b.end ? "past" : b.start <= now && now < end ? "now" : "";
    return `
      <li class="tl-block kind-${kind} ${state}">
        <span class="tl-time">${fmtTime(b.start)}${b.end ? `<small>${fmtTime(b.end)}</small>` : ""}</span>
        <span class="tl-body">
          <b>${escapeHtml(b.title)}</b>
          <span class="tl-meta">${KIND_LABELS[kind]}${b.fixed ? " · fixed" : ""}${state === "now" ? ' · <em>now</em>' : ""}</span>
        </span>
      </li>`;
  });
  return `<ol class="timeline">${rows.join("")}</ol>`;
}

// The plan card shown in the chat when Compass proposes a plan.
function planCard(data) {
  const card = document.createElement("div");
  card.className = "plan-card";
  const priorities = (data.priorities || []).map((p) => (typeof p === "string" ? p : p?.text)).filter(Boolean);
  card.innerHTML = `
    <div class="pc-head">
      <span class="label">Today's plan</span>
      ${data.headline ? `<div class="pc-headline">${escapeHtml(data.headline)}</div>` : ""}
    </div>
    ${priorities.length ? `<ol class="pc-priorities">${priorities.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ol>` : ""}
    ${timeline(data.blocks, true)}
    <div class="pc-foot">Saved to today · tick priorities off in the Today panel</div>`;
  return card;
}

function followupChips(prompts) {
  const row = document.createElement("div");
  row.className = "followups";
  for (const q of prompts.filter((q) => typeof q === "string").slice(0, 3)) {
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

  for (const code of el.querySelectorAll("pre > code.language-plan")) {
    const pre = code.parentElement;
    try {
      pre.replaceWith(planCard(JSON.parse(code.textContent)));
    } catch {
      // Mid-stream the JSON is incomplete; show a placeholder until it closes.
      const pending = document.createElement("div");
      pending.className = "plan-card pending";
      pending.textContent = streaming ? "Building your plan…" : "Couldn't read this plan.";
      pre.replaceWith(pending);
    }
  }
  for (const code of el.querySelectorAll("pre > code.language-followups")) {
    const pre = code.parentElement;
    let prompts = null;
    try {
      prompts = JSON.parse(code.textContent);
    } catch {}
    if (Array.isArray(prompts) && !streaming) pre.replaceWith(followupChips(prompts));
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

// ---- Today panel ----

function renderPlan() {
  const view = document.getElementById("plan-view");
  const plan = today?.plan;
  if (!plan) {
    view.innerHTML = `<p class="muted">No plan yet. Ask Compass to plan your day.</p>`;
    return;
  }
  const done = plan.priorities.filter((p) => p.done).length;
  view.innerHTML = `
    ${plan.headline ? `<p class="day-headline">${escapeHtml(plan.headline)}</p>` : ""}
    ${
      plan.priorities.length
        ? `<div class="progress" aria-label="${done} of ${plan.priorities.length} priorities done"><span style="width:${(done / plan.priorities.length) * 100}%"></span></div>
           <ul class="priorities">${plan.priorities
             .map(
               (p, i) => `
             <li><label><input type="checkbox" data-index="${i}" ${p.done ? "checked" : ""}><span>${escapeHtml(p.text)}</span></label></li>`,
             )
             .join("")}</ul>`
        : ""
    }
    ${timeline(plan.blocks, true)}`;
}

// How old a brain file is, when it's old enough to doubt.
function staleNote(src) {
  if (!src?.stale || !src.updated) return "";
  return `<p class="muted">From brain, last updated ${src.ageDays} days ago. Still right?</p>`;
}

function renderWorkout() {
  const view = document.getElementById("workout-view");
  const w = today?.workout;
  if (!w?.connected) view.innerHTML = `<p class="muted">Not connected. Set <code>BRAIN_GITHUB_TOKEN</code> so Compass can read your gym split.</p>`;
  else if (w.error) view.innerHTML = `<p class="error-line">${escapeHtml(w.error)}</p>`;
  else if (!w.today) view.innerHTML = `<p class="workout-name">Rest day</p>${staleNote(w)}`;
  else
    view.innerHTML = `
      <p class="workout-name">${escapeHtml(w.today.name)}${w.today.duration ? ` <span class="muted">${escapeHtml(w.today.duration)}</span>` : ""}${w.today.optional ? ' <span class="muted">optional</span>' : ""}</p>
      <ul class="exercises">${w.today.exercises.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>
      ${staleNote(w)}`;
}

function eventList(events) {
  if (!events.length) return `<p class="muted">Nothing scheduled.</p>`;
  return `<ul class="events">${events
    .map(
      (e) => `
      <li><span class="ev-time">${e.allDay ? "All day" : `${fmtTime(e.start)}${e.end ? `–${fmtTime(e.end)}` : ""}`}</span>
      <span>${escapeHtml(e.title)}${e.location ? `<small>${escapeHtml(e.location)}</small>` : ""}</span></li>`,
    )
    .join("")}</ul>`;
}

function renderCalendar() {
  const view = document.getElementById("calendar-view");
  const cal = today?.calendar;
  if (!cal) return;
  if (!cal.connected) {
    view.innerHTML = `<p class="muted">Not connected. Set <code>GOOGLE_CALENDAR_ICS_URL</code> on the server.</p>`;
    return;
  }
  view.innerHTML = `
    ${cal.error ? `<p class="error-line">${escapeHtml(cal.error)}</p>` : ""}
    ${eventList(cal.today)}
    <h3>Tomorrow</h3>
    ${eventList(cal.tomorrow)}`;
}

function renderDay() {
  if (!today) return;
  const d = new Date(`${today.date}T12:00:00`);
  document.getElementById("today-date").textContent = d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  renderPlan();
  renderWorkout();
  renderCalendar();
}

async function loadToday() {
  try {
    const res = await fetch(`api/today?tz=${encodeURIComponent(timeZone)}`);
    if (res.status === 401) location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
    if (!res.ok) throw new Error();
    today = await res.json();
    renderDay();
  } catch {
    document.getElementById("calendar-view").innerHTML = `<p class="error-line">Couldn't load today.</p>`;
  }
}

document.getElementById("plan-view").addEventListener("change", async (e) => {
  const box = e.target.closest("input[type=checkbox]");
  if (!box || !today?.plan) return;
  const index = Number(box.dataset.index);
  today.plan.priorities[index].done = box.checked;
  renderPlan();
  try {
    const res = await fetch("api/plan/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: today.date, index, done: box.checked }),
    });
    if (!res.ok) throw new Error();
    today.plan = (await res.json()).plan;
  } catch {
    today.plan.priorities[index].done = !box.checked;
  }
  renderPlan();
});

// Keep "now" on the timeline current.
setInterval(renderPlan, 60 * 1000);

// ---- Chat ----

function timestamp() {
  return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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

function addAssistantMessage() {
  const msg = document.createElement("div");
  msg.className = "msg msg-assistant";
  msg.innerHTML = `
    <div class="byline"><b>COMPASS</b><span>${timestamp()}</span></div>
    <div class="status">Thinking…</div>
    <div class="body"></div>`;
  feed.appendChild(msg);
  return {
    msg,
    status: msg.querySelector(".status"),
    body: msg.querySelector(".body"),
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
  // On phones, fold the Today panel away once the chat starts.
  if (matchMedia("(max-width: 860px)").matches) document.querySelector(".day-panel").open = false;

  addUserMessage(text);
  const view = addAssistantMessage();
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
      body: JSON.stringify({ conversationId, message: text, timeZone }),
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
      } else if (event === "plan") {
        if (today) {
          today.plan = data.plan;
          renderPlan();
        }
      } else if (event === "sources") {
        const details = document.createElement("details");
        details.className = "sources";
        details.innerHTML = `<summary>Sources (${data.sources.length})</summary><ol>${data.sources
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

document.getElementById("greeting").textContent = `${greeting()} Let's plan your day.`;
loadToday();
