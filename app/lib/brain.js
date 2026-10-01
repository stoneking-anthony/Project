// The user's own rules, read live from the private `brain` repo
// (docs/DECISIONS.md 009). Never copied into this repo: it is public.
// Needs BRAIN_GITHUB_TOKEN: a fine-grained token, `brain` only, Contents read-only.

import { config } from "../config.js";
import { track } from "./sources.js";

const CACHE_MS = 5 * 60 * 1000;
// A file older than this is a claim, not a fact (brain's own freshness law).
const STALE_DAYS = 10;
const cache = new Map(); // path -> { at, file }

export function frontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return [{}, text];
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return [fields, text.slice(m[0].length)];
}

export function describe(path, raw, now = new Date()) {
  const text = raw.replace(/^﻿/, "");
  const [fields, body] = frontMatter(text);
  const updated = /^\d{4}-\d{2}-\d{2}$/.test(fields.updated || "") ? fields.updated : null;
  const ageDays = updated ? Math.floor((now - new Date(`${updated}T12:00:00Z`)) / 86_400_000) : null;
  return { path, fields, body, text, updated, ageDays, stale: ageDays == null || ageDays > STALE_DAYS };
}

// Returns the file, or null when brain isn't connected.
export async function readBrain(path) {
  if (!config.brain.token) return null;
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.file;
  const raw = await track("brain", async () => {
    const res = await fetch(`https://api.github.com/repos/${config.brain.repo}/contents/${path}`, {
      headers: {
        Accept: "application/vnd.github.raw+json",
        Authorization: `Bearer ${config.brain.token}`,
        "User-Agent": "project-app",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) throw new Error(`GitHub returned ${res.status} for ${path}`);
    return res.text();
  });
  const file = describe(path, raw);
  cache.set(path, { at: Date.now(), file });
  return file;
}

const DAY_ABBR = { monday: "mon", tuesday: "tue", wednesday: "wed", thursday: "thu", friday: "fri", saturday: "sat", sunday: "sun" };

// Today's session from body/gym.md. Its front matter has
//   days: Mon|early AM|Push — chest, shoulders, triceps; Wed|...
//   off: Tue, Thu
// and its body has "**Push · Mon, 55–65 min**" followed by "- exercise" lines.
export function workoutFor(gym, weekday) {
  const abbr = DAY_ABBR[weekday];
  const entry = (gym.fields.days || "")
    .split(";")
    .map((s) => s.split("|").map((x) => x.trim()))
    .find(([day]) => day?.toLowerCase().startsWith(abbr));
  if (!entry) return null;
  const [, when, session] = entry;
  const name = session || "Workout";
  const word = name.split(/[\s,—-]+/)[0];
  const lines = gym.body.split(/\r?\n/);
  const at = lines.findIndex((l) => l.startsWith(`**${word}`));
  let duration = null;
  const exercises = [];
  if (at >= 0) {
    duration = /(\d+(?:[–-]\d+)?\s*min)/.exec(lines[at])?.[1] ?? null;
    for (const l of lines.slice(at + 1)) {
      if (l.startsWith("- ")) exercises.push(l.slice(2).trim());
      else if (exercises.length || l.trim()) break;
    }
  }
  return { name, when: when || null, duration, exercises, optional: when === "optional" };
}
