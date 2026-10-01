// Turns the model's ```plan block into a plan.set payload. Check marks are not
// part of the plan: they are plan.priority_done events (lib/views/plan.js).

// The last ```plan block in the reply, parsed, or null.
export function extractPlan(text) {
  const blocks = [...text.matchAll(/```plan\s*\n([\s\S]*?)```/g)];
  if (!blocks.length) return null;
  try {
    return JSON.parse(blocks[blocks.length - 1][1]);
  } catch {
    return null;
  }
}

// Normalizes a plan block from the model. Returns null if it is unusable.
export function normalizePlan(raw, date) {
  if (!raw || typeof raw !== "object") return null;
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const time = (v) => (/^\d{2}:\d{2}$/.test(str(v)) ? str(v) : null);

  const seen = new Set();
  const priorities = (Array.isArray(raw.priorities) ? raw.priorities : [])
    .map((p) => str(typeof p === "string" ? p : p?.text).slice(0, 300))
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .slice(0, 5);

  const blocks = (Array.isArray(raw.blocks) ? raw.blocks : [])
    .map((b) => ({
      start: time(b?.start),
      end: time(b?.end),
      title: str(b?.title).slice(0, 300),
      kind: str(b?.kind).toLowerCase() || "focus",
      fixed: Boolean(b?.fixed),
    }))
    .filter((b) => b.start && b.title)
    .sort((a, b) => a.start.localeCompare(b.start));

  if (!priorities.length && !blocks.length) return null;
  return { date, headline: str(raw.headline).slice(0, 300) || null, priorities, blocks };
}
