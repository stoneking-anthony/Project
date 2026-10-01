// Today's plan, derived from plan.set (latest per date wins) and
// plan.priority_done (latest per priority wins). Check marks follow the
// priority's text, so they survive a re-plan.

import { latest, list } from "../spine.js";

export async function planFor(date) {
  const set = await latest("plan.set", date);
  if (!set) return null;
  const ticks = await list("plan.priority_done", { match: { date } });
  const done = new Map();
  for (const t of ticks) done.set(t.payload.priority.toLowerCase(), t.payload.done);
  const p = set.payload;
  return {
    date,
    headline: p.headline ?? null,
    priorities: p.priorities.map((text) => ({ text, done: done.get(text.toLowerCase()) === true })),
    blocks: p.blocks,
    updatedAt: set.occurredAt,
  };
}
