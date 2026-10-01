// Compass: the daily planner. Reads the day from lib/views/today.js and saves
// each proposed plan as a plan.set event.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../../config.js";
import { checkTyped, loadConversation, saveTurns } from "../../lib/chat.js";
import { errorMessage, runChat } from "../../lib/claude.js";
import { isValidTimeZone } from "../../lib/dates.js";
import { openStream, readJson, sendJson } from "../../lib/http.js";
import { SpineError, write } from "../../lib/spine.js";
import { planFor } from "../../lib/views/plan.js";
import { contextText, getToday } from "../../lib/views/today.js";
import { extractPlan, normalizePlan } from "./plans.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = fs.readFileSync(path.join(here, "prompt.md"), "utf8");
// Web search for weather, opening hours, and the like.
const TOOLS = [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }];

const timeZoneFrom = (tz) => (isValidTimeZone(tz) ? tz : config.timeZone);

// The <today> block is re-sent only when it changed since the last message in
// that conversation, which keeps the prompt cache warm. Losing this on restart
// only means one extra copy of the context.
const lastContext = new Map();

async function chat(req, res) {
  const body = await readJson(req);
  const text = typeof body.message === "string" ? body.message.trim() : "";
  if (!text) return sendJson(res, 400, { error: "message is required" });
  checkTyped(text);
  const timeZone = timeZoneFrom(body.timeZone);
  const [conversationId, history] = await loadConversation("compass", body.conversationId);

  const send = openStream(res);
  send("meta", { conversationId });
  try {
    send("status", { text: "Checking your day…" });
    const today = await getToday(timeZone);
    const context = contextText(today);
    const userContent =
      (context === lastContext.get(conversationId) ? "" : `<today>\n${context}\n</today>\n`) + `<time>${today.time}</time>\n\n${text}`;

    const result = await runChat({
      feature: "compass",
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      effort: "medium",
      history,
      userContent,
      send,
      statusFor: (block) => (block.type === "server_tool_use" ? "Looking something up…" : null),
    });
    if (result.refused) {
      send("error", { message: "Compass declined to answer that request." });
      return;
    }
    await saveTurns("compass", conversationId, history.length, result.added);
    lastContext.set(conversationId, context);

    const plan = normalizePlan(extractPlan(result.text), today.date);
    if (plan) {
      await write("plan.set", plan, { source: "feature:compass", tz: timeZone });
      send("plan", { plan: await planFor(today.date) });
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

// POST { date, index, done }: ticks a priority on today's plan.
async function check(req, res) {
  const body = await readJson(req);
  const date = String(body.date);
  const plan = await planFor(date);
  const item = plan?.priorities[body.index];
  if (!item) return sendJson(res, 404, { error: "No such priority" });
  await write("plan.priority_done", { date, priority: item.text, done: Boolean(body.done) }, { source: "feature:compass" });
  sendJson(res, 200, { plan: await planFor(date) });
}

export default {
  name: "compass",
  publicDir: path.join(here, "public"),
  routes: {
    "POST api/chat": chat,
    "POST api/plan/check": check,
    "GET api/today": async (req, res, url) => sendJson(res, 200, await getToday(timeZoneFrom(url.searchParams.get("tz")))),
  },
};
