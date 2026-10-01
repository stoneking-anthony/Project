import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ical from "node-ical";
import { freshDb } from "./helpers.js";
import { closeDb } from "../lib/db.js";
import { describe, workoutFor } from "../lib/brain.js";
import { eventsOn } from "../lib/calendar.js";
import { write } from "../lib/spine.js";
import { planFor } from "../lib/views/plan.js";
import { contextText } from "../lib/views/today.js";
import { extractPlan, normalizePlan } from "../features/compass/plans.js";

const here = path.dirname(fileURLToPath(import.meta.url));

before(freshDb);
after(closeDb);

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:allday
DTSTART;VALUE=DATE:20260928
DTEND;VALUE=DATE:20260929
SUMMARY:Birthday
END:VEVENT
BEGIN:VEVENT
UID:standup
DTSTART;TZID=America/New_York:20260901T090000
DTEND;TZID=America/New_York:20260901T093000
RRULE:FREQ=WEEKLY;BYDAY=MO,TU
EXDATE;TZID=America/New_York:20260929T090000
SUMMARY:Standup
END:VEVENT
BEGIN:VEVENT
UID:late
DTSTART:20260929T033000Z
DTEND:20260929T043000Z
SUMMARY:Late call
LOCATION:Zoom
END:VEVENT
END:VCALENDAR`;

test("calendar expands recurrences, honors EXDATE, and buckets by local date", () => {
  const events = eventsOn(ical.sync.parseICS(ICS), ["2026-09-28", "2026-09-29"], "America/New_York");
  assert.deepEqual(events, [
    { date: "2026-09-28", allDay: true, title: "Birthday" },
    { date: "2026-09-28", allDay: false, start: "09:00", end: "09:30", title: "Standup", location: null },
    // 03:30 UTC on the 29th is 23:30 on the 28th in New York.
    { date: "2026-09-28", allDay: false, start: "23:30", end: "00:30", title: "Late call", location: "Zoom" },
  ]);
});

test("gym.md: today's session, rest days, optional days, and freshness", () => {
  const gym = describe("body/gym.md", fs.readFileSync(path.join(here, "fixtures", "gym.md"), "utf8"), new Date("2026-10-05T12:00:00Z"));
  assert.equal(gym.updated, "2026-09-20");
  assert.equal(gym.ageDays, 15);
  assert.equal(gym.stale, true);
  assert.deepEqual(workoutFor(gym, "monday"), {
    name: "Push — chest, shoulders",
    when: "early AM",
    duration: "50–60 min",
    exercises: ["Bench press — 4 × 6–8", "Overhead press — 3 × 8"],
    optional: false,
  });
  assert.equal(workoutFor(gym, "tuesday"), null);
  assert.equal(workoutFor(gym, "sunday").optional, true);
});

test("normalizePlan cleans model output", () => {
  const raw = extractPlan('Here.\n```plan\n{"headline":" Ship it ","priorities":["Deck",{"text":"Call bank"},"","deck"],"blocks":[{"start":"13:00","end":"14:00","title":"Gym","kind":"Workout"},{"start":"9:00","title":"bad time"},{"start":"08:00","title":"Wake"}]}\n```');
  assert.deepEqual(normalizePlan(raw, "2026-10-01"), {
    date: "2026-10-01",
    headline: "Ship it",
    priorities: ["Deck", "Call bank"],
    blocks: [
      { start: "08:00", end: null, title: "Wake", kind: "focus", fixed: false },
      { start: "13:00", end: "14:00", title: "Gym", kind: "workout", fixed: false },
    ],
  });
  assert.equal(normalizePlan({ priorities: [] }, "2026-10-01"), null);
});

test("check marks follow the priority's text across a re-plan", async () => {
  const blocks = [{ start: "09:00", end: "10:00", title: "Work", kind: "focus", fixed: false }];
  await write("plan.set", { date: "2026-10-03", headline: null, priorities: ["Deck", "Call bank"], blocks }, { occurredAt: new Date("2026-10-03T12:00:00Z") });
  await write("plan.priority_done", { date: "2026-10-03", priority: "Deck", done: true });
  await write("plan.set", { date: "2026-10-03", headline: "Replanned", priorities: ["deck", "Groceries"], blocks }, { occurredAt: new Date("2026-10-03T15:00:00Z") });
  const plan = await planFor("2026-10-03");
  assert.equal(plan.headline, "Replanned");
  assert.deepEqual(plan.priorities, [{ text: "deck", done: true }, { text: "Groceries", done: false }]);
});

test("context text marks an old schedule as possibly out of date", () => {
  const text = contextText({
    date: "2026-10-01", weekday: "thursday", timeZone: "America/New_York", location: null,
    calendar: { connected: false, today: [], tomorrow: [] },
    schedule: { connected: true, text: "Wake 07:30.", updated: "2026-09-15", ageDays: 16, stale: true },
    workout: { connected: true, today: null },
    plan: null,
  });
  assert.match(text, /Wake 07:30\./);
  assert.match(text, /16 days ago; treat as possibly out of date/);
  assert.match(text, /## Today's workout[^\n]*\nRest day\./);
});
