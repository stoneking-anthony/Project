// Google Calendar, read live through the calendar's private iCal address
// (docs/DECISIONS.md 004: Google keeps it, so it is never copied). Set
// GOOGLE_CALENDAR_ICS_URL to "Settings > (your calendar) > Secret address in
// iCal format"; comma-separate several calendars.

import ical from "node-ical";
import { config } from "../config.js";
import { hhmm, isoDate } from "./dates.js";
import { track } from "./sources.js";

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map(); // url -> { at, data }

async function fetchCalendar(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const data = await track("gcal", () => ical.async.fromURL(url));
  cache.set(url, { at: Date.now(), data });
  return data;
}

// All-day dates carry no time; read the calendar date they were written with.
function allDayDate(start) {
  if (start.tz) return isoDate(start, start.tz);
  const pad = (n) => String(n).padStart(2, "0");
  return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
}

// All-day events first, then by start time.
const byTime = (a, b) =>
  a.date.localeCompare(b.date) || (a.allDay !== b.allDay ? (a.allDay ? -1 : 1) : (a.start || "").localeCompare(b.start || ""));

// Events that fall on any of `days` ("YYYY-MM-DD" in `timeZone`), sorted by start.
export function eventsOn(parsed, days, timeZone) {
  const wanted = new Set(days);
  // Expand a generous window around the requested days, then filter by local date.
  const from = new Date(`${days[0]}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 2);
  const to = new Date(`${days[days.length - 1]}T00:00:00Z`);
  to.setUTCDate(to.getUTCDate() + 2);

  const out = [];
  for (const item of Object.values(parsed)) {
    if (item.type !== "VEVENT" || item.status === "CANCELLED") continue;
    let instances;
    try {
      instances = ical.expandRecurringEvent(item, { from, to, expandOngoing: true });
    } catch {
      continue;
    }
    for (const inst of instances) {
      if (inst.isFullDay) {
        const date = allDayDate(inst.start);
        if (wanted.has(date)) out.push({ date, allDay: true, title: inst.summary || "(untitled)" });
        continue;
      }
      const date = isoDate(inst.start, timeZone);
      if (!wanted.has(date)) continue;
      out.push({
        date,
        allDay: false,
        start: hhmm(inst.start, timeZone),
        end: inst.end ? hhmm(inst.end, timeZone) : null,
        title: inst.summary || "(untitled)",
        location: inst.event?.location || null,
      });
    }
  }
  return out.sort(byTime);
}

// Returns { connected, events, error? }.
export async function getEvents(days, timeZone) {
  const urls = config.googleCalendarIcs;
  if (!urls.length) return { connected: false, events: [] };
  const events = [];
  const errors = [];
  for (const url of urls) {
    try {
      events.push(...eventsOn(await fetchCalendar(url), days, timeZone));
    } catch (err) {
      errors.push(err.message);
    }
  }
  events.sort(byTime);
  return { connected: true, events, ...(errors.length ? { error: `Couldn't load a calendar: ${errors[0]}` } : {}) };
}
