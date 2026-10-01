// Shared test setup: a throwaway Postgres database and a scripted fake Claude.
// Set TEST_DATABASE_URL to point at a database the tests may wipe.

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || "postgres://postgres@localhost:5433/spine_test";
process.env.APP_PASSWORD = "correct horse battery staple";
process.env.TIMEZONE = "America/New_York";
process.env.SECURE_COOKIES = "false";
delete process.env.GOOGLE_CALENDAR_ICS_URL;
delete process.env.BRAIN_GITHUB_TOKEN;

const { db, migrate } = await import("../lib/db.js");
const { registerSources } = await import("../lib/sources.js");

// Drops everything and recreates the spine. The append-only triggers block
// TRUNCATE and DELETE, so the schema goes instead.
export async function freshDb() {
  await db().query("drop schema public cascade; create schema public;");
  await migrate();
  await registerSources();
}

// A fake Anthropic client. Each call to beta.messages.stream takes the next
// scripted reply: { content: [...blocks], stop_reason }.
export function fakeClaude(replies) {
  const calls = [];
  const queue = [...replies];
  return {
    calls,
    beta: {
      messages: {
        stream(params) {
          calls.push(structuredClone(params));
          const reply = queue.shift();
          if (!reply) throw new Error("fakeClaude: no reply scripted");
          const events = [];
          reply.content.forEach((block, index) => {
            if (block.type === "text") {
              events.push({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
              events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } });
            } else {
              events.push({ type: "content_block_start", index, content_block: block });
            }
            events.push({ type: "content_block_stop", index });
          });
          return {
            async *[Symbol.asyncIterator]() {
              yield* events;
            },
            finalMessage: async () => ({ role: "assistant", content: reply.content, stop_reason: reply.stop_reason || "end_turn" }),
          };
        },
      },
    },
  };
}

// Parses a server-sent event body into [{ event, data }].
export function parseEvents(body) {
  return body
    .split("\n\n")
    .filter(Boolean)
    .map((raw) => {
      let event = "message";
      let data = "";
      for (const line of raw.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      return { event, data: data ? JSON.parse(data) : {} };
    });
}
