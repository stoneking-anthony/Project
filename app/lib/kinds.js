// The kind registry (docs/SPINE.md). A kind not listed here cannot be written.
//
//   shape    "happening": something occurred; views fold them up.
//            "snapshot":  the full current state; the latest per `key` wins.
//   v        the current payload version. `upgrade[n]` turns version n into n+1,
//            so readers only ever see the current shape.
//   capture  true when the payload holds text the user typed: it is checked for
//            secrets (card numbers, SSNs) before it is written.
//   check    returns an error string, or null when the payload is valid.

const isStr = (v, max = 10_000) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = (v) => typeof v === "string" && /^\d{2}:\d{2}$/.test(v);
const isUuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;

const fail = (cond, msg) => (cond ? null : msg);
const first = (...checks) => checks.find((c) => c !== null) ?? null;

const ticker = (p) => fail(typeof p.ticker === "string" && TICKER.test(p.ticker), "ticker must be like NVDA or BRK.B");
const person = (p) => fail(isStr(p.name, 80), "name is required (max 80 characters)");

export const KINDS = {
  note: {
    shape: "happening",
    v: 1,
    capture: true,
    check: (p) => fail(isStr(p.text), "text is required"),
  },

  // Not `capture`: a stored user turn also holds app context (calendar, plans).
  // lib/chat.js checks the user's own words before the turn is built.
  "chat.turn": {
    shape: "happening",
    v: 1,
    check: (p) =>
      first(
        fail(isUuid(p.conversation_id), "conversation_id must be a uuid"),
        fail(isStr(p.feature, 40), "feature is required"),
        fail(p.role === "user" || p.role === "assistant", "role must be user or assistant"),
        fail(Number.isInteger(p.seq) && p.seq >= 0, "seq must be a non-negative integer"),
        fail(typeof p.content === "string" || Array.isArray(p.content), "content must be a string or an array of blocks"),
      ),
  },

  "stock.watch": { shape: "happening", v: 1, check: ticker },
  "stock.unwatch": { shape: "happening", v: 1, check: ticker },
  "insider.track": { shape: "happening", v: 1, check: person },
  "insider.untrack": { shape: "happening", v: 1, check: person },

  "stock.rating": {
    shape: "happening",
    v: 1,
    check: (p) =>
      first(
        ticker(p),
        fail(isStr(p.rating, 40), "rating is required"),
        fail(p.price == null || isNum(p.price), "price must be a number"),
        fail(p.target == null || isNum(p.target), "target must be a number"),
        fail(p.price_as_of == null || isDate(p.price_as_of), "price_as_of must be YYYY-MM-DD"),
      ),
  },

  "plan.set": {
    shape: "snapshot",
    key: "date",
    v: 1,
    check: (p) =>
      first(
        fail(isDate(p.date), "date must be YYYY-MM-DD"),
        fail(p.headline == null || isStr(p.headline, 300), "headline is too long"),
        fail(Array.isArray(p.priorities) && p.priorities.every((t) => isStr(t, 300)), "priorities must be a list of text"),
        fail(
          Array.isArray(p.blocks) &&
            p.blocks.every((b) => b && isTime(b.start) && (b.end == null || isTime(b.end)) && isStr(b.title, 300)),
          "blocks must have start (HH:MM), optional end, and title",
        ),
      ),
  },

  "plan.priority_done": {
    shape: "happening",
    v: 1,
    check: (p) =>
      first(
        fail(isDate(p.date), "date must be YYYY-MM-DD"),
        fail(isStr(p.priority, 300), "priority is required"),
        fail(typeof p.done === "boolean", "done must be true or false"),
      ),
  },

  "workout.done": {
    shape: "happening",
    v: 1,
    capture: true,
    check: (p) =>
      first(
        fail(isStr(p.type, 80), "type is required"),
        fail(p.minutes == null || (Number.isInteger(p.minutes) && p.minutes > 0), "minutes must be a positive whole number"),
      ),
  },

  // Registered for Bellwether; nothing writes it yet.
  "broker.positions": {
    shape: "snapshot",
    key: "account",
    v: 1,
    check: (p) =>
      first(
        fail(isStr(p.account, 80), "account is required"),
        fail(
          Array.isArray(p.positions) && p.positions.every((x) => x && typeof x.symbol === "string" && isNum(x.shares)),
          "positions must be a list of {symbol, shares}",
        ),
      ),
  },
};

// Brings a stored payload up to the kind's current version.
export function upgrade(kind, v, payload) {
  const def = KINDS[kind];
  let out = payload;
  for (let n = v; def && n < def.v; n++) out = def.upgrade[n](out);
  return out;
}

// Secrets that must never reach the record (docs/SPINE.md rule 2).
const SSN = /\b\d{3}-?\d{2}-?\d{4}\b/;
const CARD = /\b(?:\d[ -]?){13,19}\b/g;

function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

// Returns a reason string if `text` looks like it contains a secret.
export function findSecret(text) {
  if (typeof text !== "string") return null;
  if (SSN.test(text)) return "looks like a Social Security number";
  for (const m of text.matchAll(CARD)) {
    const digits = m[0].replace(/[ -]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return "looks like a card number";
  }
  return null;
}

// The user-typed text inside a payload.
export function typedText(payload) {
  return Object.values(payload).filter((v) => typeof v === "string");
}
