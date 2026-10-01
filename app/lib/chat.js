// Conversations live in the spine as chat.turn events (docs/DECISIONS.md 005),
// so they survive restarts and belong to the record.

import { randomUUID } from "node:crypto";
import { findSecret } from "./kinds.js";
import { SpineError, list, writeAll } from "./spine.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Returns [conversationId, messages]. Unknown or missing ids start fresh.
export async function loadConversation(feature, conversationId) {
  if (typeof conversationId !== "string" || !UUID.test(conversationId)) return [randomUUID(), []];
  const turns = await list("chat.turn", { match: { conversation_id: conversationId, feature }, limit: 10_000 });
  if (!turns.length) return [randomUUID(), []];
  turns.sort((a, b) => a.payload.seq - b.payload.seq);
  return [conversationId, turns.map((t) => ({ role: t.payload.role, content: t.payload.content }))];
}

// Throws a SpineError if the user's own words contain a secret. Run on the raw
// message, before the app wraps it in context.
export function checkTyped(text) {
  const secret = findSecret(text);
  if (secret) throw new SpineError(`Not sent: that ${secret}. Remove it and try again.`);
}

export async function saveTurns(feature, conversationId, startSeq, messages) {
  await writeAll(
    messages.map((m, i) => ({
      kind: "chat.turn",
      payload: { conversation_id: conversationId, feature, role: m.role, seq: startSeq + i, content: m.content },
      source: `feature:${feature}`,
    })),
  );
}
