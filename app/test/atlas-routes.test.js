import { test } from "node:test";
import assert from "node:assert/strict";

test("conversation rebuild keeps insider tables and skips errors", async () => {
  const { exchangesFrom } = await import("../features/atlas/routes.js");
  const data = { found: true, mode: "company", subject: "X Corp", filings: [] };
  const ex = exchangesFrom([
    { role: "user", content: "Insiders at X?" },
    { role: "assistant", content: [{ type: "tool_use", id: "a", name: "sec_insider_trades", input: {} }, { type: "tool_use", id: "b", name: "sec_insider_trades", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: JSON.stringify(data) }, { type: "tool_result", tool_use_id: "b", content: "SEC lookup failed", is_error: true }] },
    { role: "assistant", content: [{ type: "text", text: "Quiet." }] },
  ]);
  assert.equal(ex.length, 1, "tool results are not new questions");
  assert.deepEqual(ex[0].insiders, [data]);
  assert.equal(ex[0].answer, "Quiet.");
});
