// One snapshot of the user's day: date, calendar, the fixed week and today's
// workout from brain, and the saved plan. Compass hands it to the planner, and
// GET /api/today returns it for any screen that wants it.

import { config } from "../../config.js";
import { readBrain, workoutFor } from "../brain.js";
import { getEvents } from "../calendar.js";
import { addDays, hhmm, isoDate, weekday } from "../dates.js";
import { planFor } from "./plan.js";

async function brainFile(path) {
  try {
    return { file: await readBrain(path), error: null };
  } catch (err) {
    return { file: null, error: err.message };
  }
}

const freshness = (f) => (f ? { updated: f.updated, ageDays: f.ageDays, stale: f.stale } : null);

export async function getToday(timeZone, now = new Date()) {
  const date = isoDate(now, timeZone);
  const tomorrow = addDays(date, 1);
  const day = weekday(now, timeZone);

  const [calendar, schedule, gym, plan] = await Promise.all([
    getEvents([date, tomorrow], timeZone),
    brainFile("SCHEDULE.md"),
    brainFile("body/gym.md"),
    planFor(date),
  ]);
  const brainConnected = Boolean(config.brain.token);

  return {
    date,
    weekday: day,
    time: hhmm(now, timeZone),
    timeZone,
    location: config.homeLocation,
    calendar: {
      connected: calendar.connected,
      error: calendar.error || null,
      today: calendar.events.filter((e) => e.date === date),
      tomorrow: calendar.events.filter((e) => e.date === tomorrow),
    },
    schedule: {
      connected: brainConnected,
      error: schedule.error,
      ...freshness(schedule.file),
      text: schedule.file?.body ?? null,
    },
    workout: {
      connected: brainConnected,
      error: gym.error,
      ...freshness(gym.file),
      today: gym.file ? workoutFor(gym.file, day) : null,
    },
    plan,
  };
}

function eventLine(e) {
  const when = e.allDay ? "all day" : `${e.start}${e.end ? `-${e.end}` : ""}`;
  return `- ${when}: ${e.title}${e.location ? ` (${e.location})` : ""}`;
}

const age = (f) => (f.updated ? `last updated ${f.updated}, ${f.ageDays} days ago${f.stale ? "; treat as possibly out of date and confirm anything that matters" : ""}` : "no updated date");

// The snapshot as plain text for the model. The clock time is left out so the
// text only changes when the day does; the chat sends the time separately.
export function contextText(t) {
  const lines = [`Date: ${t.weekday[0].toUpperCase()}${t.weekday.slice(1)}, ${t.date}`, `Time zone: ${t.timeZone}`];
  if (t.location) lines.push(`Home location: ${t.location}`);

  lines.push("", "## Calendar");
  if (!t.calendar.connected) lines.push("Not connected. Ask the user about fixed commitments.");
  else {
    if (t.calendar.error) lines.push(`Warning: ${t.calendar.error}`);
    lines.push("Today:", ...(t.calendar.today.length ? t.calendar.today.map(eventLine) : ["- Nothing scheduled"]));
    lines.push("Tomorrow:", ...(t.calendar.tomorrow.length ? t.calendar.tomorrow.map(eventLine) : ["- Nothing scheduled"]));
  }

  lines.push("", "## The user's fixed week (their own rules, from brain/SCHEDULE.md)");
  if (!t.schedule.connected) lines.push("Not connected. Ask about wake time, fixed commitments and work hours if they matter.");
  else if (!t.schedule.text) lines.push(`Couldn't read it: ${t.schedule.error || "unknown error"}.`);
  else lines.push(`(${age(t.schedule)})`, "", t.schedule.text.trim());

  lines.push("", "## Today's workout (from brain/body/gym.md)");
  const w = t.workout;
  if (!w.connected) lines.push("Not connected.");
  else if (w.error) lines.push(`Couldn't read it: ${w.error}.`);
  else if (!w.today) lines.push("Rest day.");
  else {
    lines.push(`${w.today.name}${w.today.when ? ` (${w.today.when})` : ""}${w.today.duration ? `, ${w.today.duration}` : ""}${w.today.optional ? ", optional" : ""}`);
    for (const ex of w.today.exercises) lines.push(`- ${ex}`);
  }

  lines.push("", "## Today's saved plan");
  if (!t.plan) lines.push("None yet.");
  else {
    if (t.plan.headline) lines.push(`Headline: ${t.plan.headline}`);
    for (const p of t.plan.priorities) lines.push(`- [${p.done ? "x" : " "}] ${p.text}`);
    for (const b of t.plan.blocks) lines.push(`- ${b.start}${b.end ? `-${b.end}` : ""} ${b.title} (${b.kind})`);
  }
  return lines.join("\n");
}
