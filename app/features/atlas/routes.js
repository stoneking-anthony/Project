// Atlas: the stock analyst. Conversations, the watchlist, tracked people and
// issued ratings all live in the spine (stock.*, insider.*, chat.turn).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkTyped, loadConversation, saveTurns } from "../../lib/chat.js";
import { errorMessage, runChat } from "../../lib/claude.js";
import { openStream, readJson, sendJson } from "../../lib/http.js";
import { track } from "../../lib/sources.js";
import { SpineError, everWritten, list, membership, write } from "../../lib/spine.js";
import { MAX_LIMIT, getInsiderTrades } from "./insiders.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = fs.readFileSync(path.join(here, "prompt.md"), "utf8");

const TOOLS = [
  // Server-side web search gives the analyst current prices and news.
  { type: "web_search_20260209", name: "web_search", max_uses: 5 },
  // Runs here, in this server: reads SEC Form 4 insider filings from EDGAR.
  {
    name: "sec_insider_trades",
    description:
      "Look up recent SEC Form 4 insider filings, either for a company (by ticker) or for a person (by name). " +
      "Form 4s are filed by company officers, directors, and 10%+ shareholders within two business days of a trade. " +
      "Returns each filing's date, issuer, the insider's role, and transactions (type, shares, price, value, shares held after), " +
      "plus totals for open-market buys and sells. Use it whenever the user asks about insider buying or selling, " +
      "or about the stock trades of a specific executive, director, or major investor.",
    input_schema: {
      type: "object",
      properties: {
        ticker: { type: "string", description: "Company ticker, e.g. PLTR. Use this or person, not both." },
        person: { type: "string", description: "Person's full name, e.g. Peter Thiel. Use this or ticker, not both." },
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, description: "How many recent filings to read (default 10)." },
      },
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
];

// Suggested until the user tracks or untracks anyone. Never stored.
const DEFAULT_PEOPLE = ["Peter Thiel", "Donald J. Trump"];

// Runs a sec_insider_trades call. Returns [tool_result content, is_error, data for the UI].
async function runInsiderTool(input) {
  const ok = input && typeof input === "object";
  const ticker = ok && typeof input.ticker === "string" ? input.ticker.trim() : "";
  const person = ok && typeof input.person === "string" ? input.person.trim() : "";
  if (!ticker === !person) return ["Provide exactly one of ticker or person.", true, null];
  try {
    const data = await track("sec-edgar", () =>
      getInsiderTrades({ ticker: ticker || undefined, person: person || undefined, limit: input.limit }),
    );
    return [JSON.stringify(data), false, data];
  } catch (err) {
    return [`SEC lookup failed: ${err.message}`, true, null];
  }
}

// Every ```rating block in a reply, parsed.
export function extractRatings(text) {
  const out = [];
  for (const m of text.matchAll(/```rating\s*\n([\s\S]*?)```/g)) {
    try {
      const r = JSON.parse(m[1]);
      if (r && typeof r === "object" && typeof r.ticker === "string") out.push({ ...r, ticker: r.ticker.trim().toUpperCase() });
    } catch {
      // A malformed card is shown as-is in the reply and not recorded.
    }
  }
  return out;
}

async function chat(req, res) {
  const body = await readJson(req);
  const text = typeof body.message === "string" ? body.message.trim() : "";
  if (!text) return sendJson(res, 400, { error: "message is required" });
  checkTyped(text);
  const [conversationId, history] = await loadConversation("atlas", body.conversationId);

  const send = openStream(res);
  send("meta", { conversationId });
  try {
    const result = await runChat({
      feature: "atlas",
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      effort: "high",
      history,
      userContent: text,
      send,
      statusFor: (block) => (block.type === "server_tool_use" ? "Pulling market data…" : "Reading SEC insider filings…"),
      runTool: async (call) => {
        if (call.name !== "sec_insider_trades") return { content: `Unknown tool ${call.name}`, isError: true };
        const [content, isError, data] = await runInsiderTool(call.input);
        if (data?.found) send("insiders", data);
        return { content, isError };
      },
    });
    if (result.refused) {
      send("error", { message: "The analyst declined to answer that request." });
      return;
    }
    await saveTurns("atlas", conversationId, history.length, result.added);
    for (const rating of extractRatings(result.text)) {
      await write("stock.rating", rating, { source: "feature:atlas" }).catch((err) =>
        console.warn(`Rating for ${rating.ticker} not recorded: ${err.message}`),
      );
    }
    if (result.sources.size) {
      send("sources", { sources: [...result.sources].map(([url, title]) => ({ url, title })) });
    }
    send("done", {});
  } catch (err) {
    console.error(err);
    send("error", { message: err instanceof SpineError ? err.message : errorMessage(err) });
  } finally {
    res.end();
  }
}

// The watchlist, each ticker with the latest rating Atlas issued for it.
async function getWatchlist(req, res) {
  const members = await membership("stock.watch", "stock.unwatch", "ticker");
  const items = await Promise.all(
    members.map(async ({ value: ticker, since }) => {
      const ratings = await list("stock.rating", { match: { ticker } });
      const r = ratings.at(-1);
      return { ticker, since, rating: r ? { ...r.payload, issuedAt: r.occurredAt } : null };
    }),
  );
  sendJson(res, 200, { items });
}

// POST { ticker, watch }
async function setWatch(req, res) {
  const { ticker, watch } = await readJson(req);
  const t = typeof ticker === "string" ? ticker.trim().toUpperCase() : "";
  await write(watch === false ? "stock.unwatch" : "stock.watch", { ticker: t }, { source: "feature:atlas" });
  return getWatchlist(req, res);
}

async function getPeople(req, res) {
  if (!(await everWritten(["insider.track", "insider.untrack"]))) return sendJson(res, 200, { people: DEFAULT_PEOPLE, suggested: true });
  const members = await membership("insider.track", "insider.untrack", "name");
  sendJson(res, 200, { people: members.map((m) => m.value).reverse(), suggested: false });
}

// POST { name, track }. The first change also records the suggested people
// the user kept, so the list doesn't jump.
async function setPerson(req, res) {
  const { name, track } = await readJson(req);
  const clean = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  if (!(await everWritten(["insider.track", "insider.untrack"]))) {
    for (const p of DEFAULT_PEOPLE) await write("insider.track", { name: p }, { source: "feature:atlas" });
  }
  await write(track === false ? "insider.untrack" : "insider.track", { name: clean }, { source: "feature:atlas" });
  return getPeople(req, res);
}

export default {
  name: "atlas",
  publicDir: path.join(here, "public"),
  routes: {
    "POST api/chat": chat,
    "GET api/watchlist": getWatchlist,
    "POST api/watchlist": setWatch,
    "GET api/people": getPeople,
    "POST api/people": setPerson,
  },
};
