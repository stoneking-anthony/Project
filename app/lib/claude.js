// The one Claude client and the one chat loop every feature uses
// (docs/DECISIONS.md 007). Features supply a system prompt, tools, and a
// runTool function; this streams the reply and handles pause_turn, tool calls,
// refusals and errors the same way everywhere.

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

let client = null;
export function claude() {
  if (!client) client = new Anthropic();
  return client;
}
// Tests swap in a fake.
export function setClaudeClient(fake) {
  client = fake;
}

export const modelFor = (feature) => config.models[feature] || config.model;

// Model round-trips per user message (tool calls and paused server-tool turns).
const MAX_TURNS = 8;

function collectSources(content, into) {
  for (const block of content) {
    if (block.type !== "text" || !block.citations) continue;
    for (const c of block.citations) {
      if (c.url && !into.has(c.url)) into.set(c.url, c.title || c.url);
    }
  }
}

export function errorMessage(err) {
  if (err instanceof Anthropic.RateLimitError) return "Rate limited. Try again in a moment.";
  if (err instanceof Anthropic.AuthenticationError) return "The server's Anthropic API key is missing or invalid.";
  if (err instanceof Anthropic.APIError) return `API error: ${err.message}`;
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return "The server has no ANTHROPIC_API_KEY set.";
  return "Something went wrong.";
}

// Runs one user message to completion.
//   history     earlier messages (left untouched)
//   userContent the new user turn's content
//   send        server-sent-event writer: status / delta events go out live
//   runTool     async (call) => { content, isError } for client tools
//   statusFor   (block) => status text when a tool block starts
// Returns { added, text, sources, refused }: `added` is every new message
// (the user turn first) to save if the reply completed.
export async function runChat({ feature, system, tools, effort, history, userContent, send, runTool, statusFor }) {
  const added = [{ role: "user", content: userContent }];
  const messages = () => [...history, ...added];
  const sources = new Map();
  let text = "";

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const stream = claude().beta.messages.stream({
      model: modelFor(feature),
      max_tokens: 64000,
      system,
      cache_control: { type: "ephemeral" },
      output_config: { effort },
      tools,
      messages: messages(),
      // Re-run on Anthropic's recommended model if a safety classifier declines.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    // Surface each web search as a status line ("Searching: NVDA earnings").
    const searchInputs = new Map();
    for await (const event of stream) {
      if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "server_tool_use") searchInputs.set(event.index, "");
        if (block.type === "server_tool_use" || block.type === "tool_use") {
          const status = statusFor?.(block);
          if (status) send("status", { text: status });
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          text += event.delta.text;
          send("delta", { text: event.delta.text });
        } else if (event.delta.type === "input_json_delta" && searchInputs.has(event.index)) {
          searchInputs.set(event.index, searchInputs.get(event.index) + event.delta.partial_json);
        }
      } else if (event.type === "content_block_stop" && searchInputs.has(event.index)) {
        try {
          const { query } = JSON.parse(searchInputs.get(event.index));
          if (query) send("status", { text: `Searching: ${query}` });
        } catch {
          // Partial or malformed input: the generic status line already went out.
        }
      }
    }

    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") return { added, text, sources, refused: true };

    added.push({ role: "assistant", content: message.content });
    collectSources(message.content, sources);

    if (message.stop_reason === "pause_turn") continue;

    if (message.stop_reason === "tool_use") {
      const calls = message.content.filter((b) => b.type === "tool_use");
      const results = await Promise.all(
        calls.map(async (call) => {
          const { content, isError } = runTool
            ? await runTool(call)
            : { content: `Unknown tool ${call.name}`, isError: true };
          return { type: "tool_result", tool_use_id: call.id, content, is_error: isError };
        }),
      );
      added.push({ role: "user", content: results });
      continue;
    }

    if (message.stop_reason === "max_tokens") send("status", { text: "Response was cut off at the length limit." });
    break;
  }
  return { added, text, sources, refused: false };
}
