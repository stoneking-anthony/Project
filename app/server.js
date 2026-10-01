// The one server (docs/DECISIONS.md 007). Login, the home screen, shared APIs,
// and every feature mounted under /<feature>/.

import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import {
  checkPassword, clearCookie, clearFails, isSignedIn, loginBlocked, recordFail, sameOrigin, sessionCookie,
} from "./lib/auth.js";
import { migrate } from "./lib/db.js";
import { readJson, sendJson, serveFile } from "./lib/http.js";
import { heartbeat, registerSources } from "./lib/sources.js";
import { isValidTimeZone } from "./lib/dates.js";
import { getToday } from "./lib/views/today.js";
import atlas from "./features/atlas/routes.js";
import compass from "./features/compass/routes.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, "public");
const FEATURES = Object.fromEntries([atlas, compass].map((f) => [f.name, f]));

// Browser libraries served straight from node_modules, at /vendor/ or /<feature>/vendor/.
const VENDOR = {
  "marked.min.js": path.join(here, "node_modules", "marked", "marked.min.js"),
  "purify.min.js": path.join(here, "node_modules", "dompurify", "dist", "purify.min.js"),
};

// Reachable without signing in.
const PUBLIC_PATHS = new Set(["/login", "/login.html", "/shell.css", "/icon.svg", "/manifest.webmanifest", "/healthz"]);

// The right-most X-Forwarded-For entry is the one our host's proxy added; earlier
// ones come from the client and could be forged to dodge the login limit.
const clientIp = (req) => req.headers["x-forwarded-for"]?.split(",").at(-1).trim() || req.socket.remoteAddress || "?";

async function login(req, res) {
  const ip = clientIp(req);
  if (loginBlocked(ip)) return sendJson(res, 429, { error: "Too many tries. Wait 15 minutes." });
  const { password } = await readJson(req, 4096);
  if (!checkPassword(password)) {
    recordFail(ip);
    return sendJson(res, 401, { error: "Wrong password." });
  }
  clearFails(ip);
  res.setHeader("Set-Cookie", sessionCookie());
  sendJson(res, 200, { ok: true });
}

const SHARED = {
  "POST /api/login": login,
  "POST /api/logout": (req, res) => {
    res.setHeader("Set-Cookie", clearCookie());
    sendJson(res, 200, { ok: true });
  },
  "GET /api/health": async (req, res) => sendJson(res, 200, { sources: await heartbeat() }),
  "GET /api/today": async (req, res, url) => {
    const tz = url.searchParams.get("tz");
    sendJson(res, 200, await getToday(isValidTimeZone(tz) ? tz : config.timeZone));
  },
};

async function handle(req, res) {
  let url;
  let pathname;
  try {
    url = new URL(req.url, "http://x");
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return res.writeHead(400).end();
  }

  if (pathname === "/healthz") return res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
  if (req.method !== "GET" && !sameOrigin(req)) return sendJson(res, 403, { error: "Cross-site request refused." });

  const vendor = /(?:^|\/)vendor\/([\w.-]+)$/.exec(pathname);
  if (req.method === "GET" && vendor && VENDOR[vendor[1]]) return serveFile(res, path.dirname(VENDOR[vendor[1]]), path.basename(VENDOR[vendor[1]]));

  const route = `${req.method} ${pathname}`;
  if (route === "POST /api/login") return login(req, res);

  if (!isSignedIn(req)) {
    if (PUBLIC_PATHS.has(pathname) && req.method === "GET") {
      return serveFile(res, PUBLIC_DIR, pathname === "/login" ? "login.html" : pathname.slice(1));
    }
    if (pathname.includes("/api/")) return sendJson(res, 401, { error: "Sign in first." });
    res.writeHead(302, { Location: `/login?next=${encodeURIComponent(pathname)}` }).end();
    return;
  }

  if (SHARED[route]) return SHARED[route](req, res, url);

  // /<feature>/... : the feature's API, then its static files.
  const [, name, ...rest] = pathname.split("/");
  const feature = FEATURES[name];
  if (feature) {
    if (rest.length === 0) return res.writeHead(301, { Location: `/${name}/` }).end();
    const sub = rest.join("/");
    const handler = feature.routes[`${req.method} ${sub}`];
    if (handler) return handler(req, res, url);
    if (sub.startsWith("api/")) return sendJson(res, 404, { error: "Not found" });
    if (req.method === "GET") return serveFile(res, feature.publicDir, sub || "index.html");
    return res.writeHead(405).end();
  }

  if (req.method === "GET") {
    if (pathname === "/login") return res.writeHead(302, { Location: "/" }).end();
    return serveFile(res, PUBLIC_DIR, pathname === "/" ? "index.html" : pathname.slice(1));
  }
  res.writeHead(405).end();
}

export function createServer() {
  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      if (res.headersSent) return res.end();
      sendJson(res, status, { error: status >= 500 ? "Something went wrong." : err.message });
    });
  });
}

export async function start() {
  if (!config.appPassword || config.appPassword.length < 12) {
    throw new Error("APP_PASSWORD must be set to at least 12 characters. It is the only thing between the internet and your data.");
  }
  await migrate();
  await registerSources();
  const server = createServer();
  await new Promise((resolve) => server.listen(config.port, resolve));
  console.log(`Running at http://localhost:${config.port} (model: ${config.model}, time zone: ${config.timeZone})`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) console.warn("Warning: ANTHROPIC_API_KEY is not set, so chats will fail.");
  if (!config.googleCalendarIcs.length) console.warn("Note: GOOGLE_CALENDAR_ICS_URL is not set, so Compass plans without your calendar.");
  if (!config.brain.token) console.warn("Note: BRAIN_GITHUB_TOKEN is not set, so Compass can't read your schedule and gym split.");
  if (!config.secUserAgent) console.warn("Note: SEC_USER_AGENT is not set, so Atlas can't look up insider trades.");
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
