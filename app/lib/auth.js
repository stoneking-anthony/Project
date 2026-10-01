// Single-user login (docs/DECISIONS.md 010): one password from APP_PASSWORD,
// then a signed, HttpOnly session cookie. Every /api route requires it.

import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

const COOKIE = "session";
const LIFETIME_MS = 30 * 24 * 3600 * 1000;
const MAX_FAILS = 5;
const FAIL_WINDOW_MS = 15 * 60 * 1000;

// Derived from the password, so changing APP_PASSWORD signs everyone out.
let key = null;
function signingKey() {
  if (!key) key = scryptSync(config.appPassword, "project-app-session-v1", 32);
  return key;
}

const sign = (value) => createHmac("sha256", signingKey()).update(value).digest("base64url");

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkPassword(given) {
  if (!config.appPassword || typeof given !== "string") return false;
  // Compare digests so the comparison takes the same time for any length.
  const h = (s) => createHmac("sha256", "pw").update(s).digest();
  return timingSafeEqual(h(given), h(config.appPassword));
}

export function sessionCookie(now = Date.now()) {
  const value = `${now + LIFETIME_MS}`;
  const flags = ["HttpOnly", "SameSite=Lax", "Path=/", `Max-Age=${LIFETIME_MS / 1000}`];
  if (config.secureCookies) flags.push("Secure");
  return `${COOKIE}=${value}.${sign(value)}; ${flags.join("; ")}`;
}

export function clearCookie() {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${config.secureCookies ? "; Secure" : ""}`;
}

function readCookie(req) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=");
  }
  return null;
}

export function isSignedIn(req, now = Date.now()) {
  const raw = readCookie(req);
  if (!raw || !config.appPassword) return false;
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return false;
  const value = raw.slice(0, dot);
  if (!safeEqual(raw.slice(dot + 1), sign(value))) return false;
  return Number(value) > now;
}

// A state-changing request must come from this site. SameSite=Lax already
// stops most cross-site posts; this closes the rest.
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin fetches from older browsers, curl
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// Failed logins per client address.
const fails = new Map();

export function loginBlocked(ip, now = Date.now()) {
  const f = fails.get(ip);
  if (!f || now - f.first > FAIL_WINDOW_MS) return false;
  return f.count >= MAX_FAILS;
}

export function recordFail(ip, now = Date.now()) {
  const f = fails.get(ip);
  if (!f || now - f.first > FAIL_WINDOW_MS) fails.set(ip, { first: now, count: 1 });
  else f.count++;
}

export function clearFails(ip) {
  fails.delete(ip);
}
