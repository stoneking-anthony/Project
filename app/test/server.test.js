// End to end: the real server and database, with a scripted fake Claude.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fakeClaude, freshDb, parseEvents } from "./helpers.js";
import { closeDb } from "../lib/db.js";
import { setClaudeClient } from "../lib/claude.js";
import { list } from "../lib/spine.js";
import { createServer } from "../server.js";

let server;
let base;
let cookie = "";

before(async () => {
  await freshDb();
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(async () => {
  server.close();
  await closeDb();
});

const call = (path, { method = "GET", body, headers = {}, auth = true } = {}) =>
  fetch(base + path, {
    method,
    redirect: "manual",
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(auth && cookie ? { Cookie: cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });

test("everything but login is locked until you sign in", async () => {
  assert.equal((await call("/healthz")).status, 200);
  assert.equal((await call("/login")).status, 200);
  assert.equal((await call("/api/health")).status, 401);
  assert.equal((await call("/atlas/api/watchlist")).status, 401);
  const page = await call("/compass/");
  assert.equal(page.status, 302);
  assert.equal(page.headers.get("location"), "/login?next=%2Fcompass%2F");
});

test("a wrong password is refused, and five in a row lock the address", async () => {
  for (let i = 0; i < 5; i++) {
    const res = await call("/api/login", { method: "POST", body: { password: "nope" }, headers: { "X-Forwarded-For": "203.0.113.9" } });
    assert.equal(res.status, 401);
  }
  const locked = await call("/api/login", { method: "POST", body: { password: "correct horse battery staple" }, headers: { "X-Forwarded-For": "203.0.113.9" } });
  assert.equal(locked.status, 429);
});

test("the right password gives an HttpOnly session cookie", async () => {
  const res = await call("/api/login", { method: "POST", body: { password: "correct horse battery staple" } });
  assert.equal(res.status, 200);
  const set = res.headers.get("set-cookie");
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Lax/);
  cookie = set.split(";")[0];
  assert.equal((await call("/api/health")).status, 200);
});

test("a forged or tampered cookie is refused", async () => {
  const [name, value] = cookie.split("=");
  const tampered = `${name}=${Number(value.split(".")[0]) + 1000}.${value.split(".")[1]}`;
  assert.equal((await call("/api/health", { auth: false, headers: { Cookie: tampered } })).status, 401);
});

test("cross-site posts are refused even with a session", async () => {
  const res = await call("/atlas/api/watchlist", { method: "POST", body: { ticker: "NVDA" }, headers: { Origin: "https://evil.example" } });
  assert.equal(res.status, 403);
});

test("pages, features and vendor scripts are served once signed in", async () => {
  for (const path of ["/", "/atlas/", "/compass/", "/atlas/app.js", "/compass/vendor/marked.min.js", "/manifest.webmanifest"]) {
    assert.equal((await call(path)).status, 200, path);
  }
  assert.equal((await call("/atlas/../server.js")).status, 404);
  assert.equal((await call("/atlas")).status, 301);
});

test("heartbeat lists every registered source", async () => {
  const { sources } = await (await call("/api/health")).json();
  assert.deepEqual(sources.map((s) => s.name).sort(), ["brain", "gcal", "import:robinhood", "manual", "sec-edgar"]);
});

test("Atlas: people start as suggestions, and changes are kept", async () => {
  assert.deepEqual(await (await call("/atlas/api/people")).json(), { people: ["Peter Thiel", "Donald J. Trump"], suggested: true });
  const res = await call("/atlas/api/people", { method: "POST", body: { name: "  Jane   Example ", track: true } });
  assert.deepEqual((await res.json()).people, ["Peter Thiel", "Donald J. Trump", "Jane Example"]);
  const removed = await call("/atlas/api/people", { method: "POST", body: { name: "Peter Thiel", track: false } });
  assert.deepEqual((await removed.json()).people, ["Donald J. Trump", "Jane Example"]);
});

test("Atlas: a chat streams, is saved, records the rating, and continues later", async () => {
  const rating = { ticker: "nvda", company: "NVIDIA", rating: "Buy", price: 180, price_as_of: "2026-09-30", target: 220 };
  const fake = fakeClaude([
    {
      content: [
        { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "NVDA price" } },
        { type: "text", text: "```rating\n" + JSON.stringify(rating) + "\n```\nBuy." },
      ],
    },
    { content: [{ type: "text", text: "Still a buy." }] },
  ]);
  setClaudeClient(fake);

  const res = await call("/atlas/api/chat", { method: "POST", body: { message: "Is NVDA a buy?" } });
  const events = parseEvents(await res.text());
  const conversationId = events.find((e) => e.event === "meta").data.conversationId;
  assert.ok(events.some((e) => e.event === "status" && e.data.text === "Pulling market data…"));
  assert.ok(events.some((e) => e.event === "done"));
  assert.equal(fake.calls[0].model, "claude-opus-5-5");
  assert.equal(fake.calls[0].output_config.effort, "high");
  assert.deepEqual(fake.calls[0].fallbacks, "default");

  const ratings = await list("stock.rating");
  assert.equal(ratings.length, 1);
  assert.equal(ratings[0].payload.ticker, "NVDA");

  // The next message replays the saved conversation.
  await call("/atlas/api/chat", { method: "POST", body: { message: "And now?", conversationId } });
  const replayed = fake.calls[1].messages;
  assert.equal(replayed.length, 3);
  assert.equal(replayed[0].content, "Is NVDA a buy?");
  assert.equal(replayed[2].content, "And now?");
  assert.equal((await list("chat.turn", { match: { conversation_id: conversationId } })).length, 4);
});

test("Atlas: the watchlist shows the latest rating", async () => {
  await call("/atlas/api/watchlist", { method: "POST", body: { ticker: "nvda", watch: true } });
  const { items } = await (await call("/atlas/api/watchlist")).json();
  assert.equal(items.length, 1);
  assert.equal(items[0].ticker, "NVDA");
  assert.equal(items[0].rating.target, 220);
  const after = await (await call("/atlas/api/watchlist", { method: "POST", body: { ticker: "NVDA", watch: false } })).json();
  assert.deepEqual(after.items, []);
});

test("Atlas: the custom tool runs and its result goes back to Claude", async () => {
  const fake = fakeClaude([
    { content: [{ type: "tool_use", id: "tu_1", name: "sec_insider_trades", input: { ticker: "PLTR", person: "x" } }], stop_reason: "tool_use" },
    { content: [{ type: "text", text: "Done." }] },
  ]);
  setClaudeClient(fake);
  await (await call("/atlas/api/chat", { method: "POST", body: { message: "Insiders at PLTR?" } })).text();
  const result = fake.calls[1].messages.at(-1).content[0];
  assert.equal(result.type, "tool_result");
  assert.equal(result.tool_use_id, "tu_1");
  assert.equal(result.is_error, true); // both ticker and person: rejected before any lookup
});

test("a refused reply is not saved", async () => {
  setClaudeClient(fakeClaude([{ content: [], stop_reason: "refusal" }]));
  const before = (await list("chat.turn")).length;
  const events = parseEvents(await (await call("/atlas/api/chat", { method: "POST", body: { message: "something" } })).text());
  assert.ok(events.some((e) => e.event === "error"));
  assert.equal((await list("chat.turn")).length, before);
});

test("a card number in a message is refused before anything is sent", async () => {
  const fake = fakeClaude([]);
  setClaudeClient(fake);
  const res = await call("/compass/api/chat", { method: "POST", body: { message: "my card is 4111-1111-1111-1111" } });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /card number/);
  assert.equal(fake.calls.length, 0);
});

test("Compass: a plan from the chat is saved, ticked, and shown in today", async () => {
  const plan = { headline: "Ship it", priorities: ["Deck", "Gym"], blocks: [{ start: "09:00", end: "11:00", title: "Deck", kind: "focus" }] };
  const fake = fakeClaude([{ content: [{ type: "text", text: "```plan\n" + JSON.stringify(plan) + "\n```" }] }]);
  setClaudeClient(fake);

  const events = parseEvents(await (await call("/compass/api/chat", { method: "POST", body: { message: "Plan my day", timeZone: "America/New_York" } })).text());
  const saved = events.find((e) => e.event === "plan").data.plan;
  assert.deepEqual(saved.priorities, [{ text: "Deck", done: false }, { text: "Gym", done: false }]);
  assert.equal(fake.calls[0].output_config.effort, "medium");
  const firstTurn = fake.calls[0].messages[0].content;
  assert.match(firstTurn, /^<today>\n/);
  assert.match(firstTurn, /fixed week[\s\S]*Not connected/);

  const ticked = await (await call("/compass/api/plan/check", { method: "POST", body: { date: saved.date, index: 0, done: true } })).json();
  assert.equal(ticked.plan.priorities[0].done, true);

  const today = await (await call("/api/today?tz=America/New_York")).json();
  assert.equal(today.plan.headline, "Ship it");
  assert.equal(today.plan.priorities[0].done, true);
  assert.equal(today.schedule.connected, false);
});
