// Every setting in one place. Values come from the environment (.env locally,
// the host's settings panel in production). See .env.example.

const env = process.env;

export const config = {
  port: Number(env.PORT) || 3000,
  // The default Claude model for every feature. A feature may override it below.
  model: env.CLAUDE_MODEL || "claude-opus-5-5",
  models: {
    atlas: env.ATLAS_MODEL || null,
    compass: env.COMPASS_MODEL || null,
  },
  timeZone: env.TIMEZONE || "America/New_York",
  homeLocation: env.HOME_LOCATION || null,
  databaseUrl: env.DATABASE_URL || "",
  // PEM of the database's CA certificate. Without it the connection is still
  // encrypted, but the server's certificate isn't verified (Supabase's pooler
  // uses its own CA, so most setups leave this blank).
  databaseCa: env.DATABASE_CA || null,
  appPassword: env.APP_PASSWORD || "",
  secureCookies: env.SECURE_COOKIES ? env.SECURE_COOKIES === "true" : env.NODE_ENV === "production",
  googleCalendarIcs: (env.GOOGLE_CALENDAR_ICS_URL || "").split(",").map((s) => s.trim()).filter(Boolean),
  brain: {
    token: env.BRAIN_GITHUB_TOKEN || "",
    repo: env.BRAIN_REPO || "stoneking-anthony/brain",
  },
  secUserAgent: env.SEC_USER_AGENT || "",
};
