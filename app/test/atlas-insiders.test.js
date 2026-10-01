import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseForm4, parseDisplayName, matchPeople, getInsiderTrades } from "../features/atlas/insiders.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => fs.readFileSync(path.join(here, "fixtures", name), "utf8");

test("parses a sale under a 10b5-1 plan", () => {
  const f = parseForm4(fixture("form4-sale.xml"));
  assert.deepEqual(f.issuer, { name: "Palantir Technologies Inc.", ticker: "PLTR", cik: "0001321655" });
  assert.deepEqual(f.owners, [{ name: "SAMPLE PERSON A", cik: "0009999001", roles: ["Director"] }]);
  assert.equal(f.tradingPlan, true);
  assert.equal(f.transactions.length, 1);
  const t = f.transactions[0];
  assert.equal(t.type, "Sell");
  assert.equal(t.direction, "disposed");
  assert.equal(t.shares, 100000);
  assert.equal(t.price, 180.25);
  assert.equal(t.value, 18025000);
  assert.equal(t.sharesAfter, 2500000);
  assert.equal(t.ownership, "By LLC");
});

test("parses a buy and a gift with roles given as true/false", () => {
  const f = parseForm4(fixture("form4-buy.xml"));
  assert.deepEqual(f.owners[0].roles, ["Director", "Chief Executive Officer", "10% owner"]);
  assert.equal(f.tradingPlan, false);
  assert.deepEqual(
    f.transactions.map((t) => [t.type, t.shares, t.value, t.ownership]),
    [
      ["Buy", 5000, 100000, "Direct"],
      ["Gift", 1000, null, "Direct"],
    ],
  );
});

test("reads EDGAR search display names", () => {
  assert.deepEqual(parseDisplayName("THIEL PETER  (CIK 0001211060)"), { name: "THIEL PETER", ticker: null, cik: "0001211060" });
  assert.deepEqual(parseDisplayName("Palantir Technologies Inc.  (PLTR)  (CIK 0001321655)"), {
    name: "Palantir Technologies Inc.",
    ticker: "PLTR",
    cik: "0001321655",
  });
});

test("matches people regardless of name order and skips companies", () => {
  const hits = [
    { _source: { display_names: ["DOE JOHN Q  (CIK 0000000011)", "Doe Holdings Inc.  (DOE)  (CIK 0000000099)"] } },
    { _source: { display_names: ["DOE JOHN  (CIK 0000000010)"] } },
    { _source: { display_names: ["John Doe Revocable Trust  (CIK 0000000012)", "SMITH JANE  (CIK 0000000013)"] } },
  ];
  const found = matchPeople(hits, "John Doe");
  // Middle initials don't count against a match; extra words (like "Trust") do.
  assert.deepEqual(found.slice(0, 2).map((f) => f.cik).sort(), ["0000000010", "0000000011"]);
  assert.equal(found[2].cik, "0000000012");
});

test("finds no one when names don't match", () => {
  assert.deepEqual(matchPeople([{ _source: { display_names: ["SMITH JANE  (CIK 0000000013)"] } }], "Nobody Here"), []);
});

// End-to-end with EDGAR mocked out.
const realFetch = globalThis.fetch;
let requested;
beforeEach(() => {
  process.env.SEC_USER_AGENT = "Atlas tests test@example.com";
  requested = [];
  globalThis.fetch = async (url, opts) => {
    requested.push({ url, ua: opts.headers["User-Agent"] });
    const json = (body) => ({ ok: true, json: async () => body });
    const text = (body) => ({ ok: true, text: async () => body });
    if (url.endsWith("/files/company_tickers.json")) return json({ 0: { cik_str: 1321655, ticker: "PLTR", title: "Palantir Technologies Inc." } });
    if (url.includes("efts.sec.gov")) {
      return json({ hits: { hits: [{ _source: { display_names: ["SAMPLE PERSON A  (CIK 0009999001)", "Palantir Technologies Inc.  (PLTR)  (CIK 0001321655)"] } }] } });
    }
    if (url.includes("/submissions/CIK")) {
      return json({
        name: "x",
        filings: {
          recent: {
            form: ["4", "8-K", "4/A"],
            accessionNumber: ["0001209191-25-000001", "0001209191-25-000002", "0001209191-25-000003"],
            filingDate: ["2025-11-05", "2025-11-01", "2025-10-17"],
            primaryDocument: ["xslF345X05/sale.xml", "8k.htm", "xslF345X05/buy.xml"],
          },
        },
      });
    }
    if (url.endsWith("/sale.xml")) return text(fixture("form4-sale.xml"));
    if (url.endsWith("/buy.xml")) return text(fixture("form4-buy.xml"));
    return { ok: false, status: 404 };
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("company lookup reads only Form 4s, uses raw XML, and totals buys and sells", async () => {
  const r = await getInsiderTrades({ ticker: "pltr", limit: 5 });
  assert.equal(r.found, true);
  assert.equal(r.subject, "Palantir Technologies Inc.");
  assert.equal(r.filings.length, 2);
  assert.equal(r.filings[1].amendment, true);
  assert.equal(r.filings[0].url, "https://www.sec.gov/Archives/edgar/data/1321655/000120919125000001/0001209191-25-000001-index.htm");
  assert.deepEqual(r.summary, { openMarketBuys: 1, openMarketSells: 1, boughtValue: 100000, soldValue: 18025000 });
  assert.ok(requested.every((q) => q.ua === "Atlas tests test@example.com"));
  assert.ok(!requested.some((q) => q.url.includes("xslF345")), "should fetch raw XML, not the rendered page");
});

test("person lookup resolves the filer and returns their filings", async () => {
  const r = await getInsiderTrades({ person: "Person A Sample" });
  assert.equal(r.found, true);
  assert.deepEqual(r.filers, [{ name: "SAMPLE PERSON A", cik: "0009999001" }]);
  assert.equal(r.filings.length, 2);
});

test("unknown ticker and missing user agent are reported clearly", async () => {
  assert.equal((await getInsiderTrades({ ticker: "ZZZZ" })).found, false);
  delete process.env.SEC_USER_AGENT;
  await assert.rejects(getInsiderTrades({ ticker: "NEWCO" }), /SEC_USER_AGENT/);
});
