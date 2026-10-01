// Insider trades from SEC EDGAR Form 4 filings.
//
// Form 4 is the report company officers, directors, and 10%+ owners must file
// within two business days of trading the company's stock. EDGAR is free and
// needs no API key, but the SEC requires a User-Agent that identifies you:
// set SEC_USER_AGENT to something like "Your App Name you@example.com".
// Fair-access limit: 10 requests per second.

import { XMLParser } from "fast-xml-parser";

const SEC_WWW = "https://www.sec.gov";
const SEC_DATA = "https://data.sec.gov";
const SEC_SEARCH = "https://efts.sec.gov/LATEST/search-index";
const CACHE_MS = 10 * 60 * 1000;
const CONCURRENCY = 4;

export const MAX_LIMIT = 25;

// What each Form 4 transaction code means, in plain words.
export const TRANSACTION_CODES = {
  P: "Buy",
  S: "Sell",
  A: "Grant",
  M: "Option exercise",
  X: "Option exercise",
  C: "Conversion",
  F: "Tax withholding",
  G: "Gift",
  D: "Returned to company",
  J: "Other",
  W: "Inheritance",
  I: "Discretionary",
  V: "Voluntary report",
};

const xml = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false, // keep CIKs and dates as strings
  isArray: (name) => ["reportingOwner", "nonDerivativeTransaction", "derivativeTransaction", "footnote"].includes(name),
});

const cache = new Map();

function userAgent() {
  const ua = process.env.SEC_USER_AGENT;
  if (!ua) throw new InsiderError("SEC_USER_AGENT is not set. Add it to .env, e.g. SEC_USER_AGENT=\"Atlas Research you@example.com\".");
  return ua;
}

export class InsiderError extends Error {}

async function secFetch(url, as = "json") {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.body;
  const res = await fetch(url, { headers: { "User-Agent": userAgent(), Accept: as === "json" ? "application/json" : "application/xml" } });
  if (!res.ok) throw new InsiderError(`SEC request failed (${res.status}) for ${url}`);
  const body = as === "json" ? await res.json() : await res.text();
  cache.set(url, { at: Date.now(), body });
  return body;
}

const pad10 = (cik) => String(cik).replace(/^0+/, "").padStart(10, "0");
const num = (v) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const val = (node) => (node && typeof node === "object" ? node.value : node) ?? null;
const flag = (v) => v === "1" || v === "true" || v === 1 || v === true;

// Parses one Form 4 XML document into owners and non-derivative transactions.
export function parseForm4(text) {
  const doc = xml.parse(text).ownershipDocument;
  if (!doc) throw new InsiderError("Not a Form 4 ownership document");

  const owners = (doc.reportingOwner || []).map((o) => {
    const rel = o.reportingOwnerRelationship || {};
    const roles = [];
    if (flag(rel.isDirector)) roles.push("Director");
    if (flag(rel.isOfficer)) roles.push(rel.officerTitle || "Officer");
    if (flag(rel.isTenPercentOwner)) roles.push("10% owner");
    if (flag(rel.isOther)) roles.push(rel.otherText || "Other");
    return { name: o.reportingOwnerId?.rptOwnerName ?? null, cik: o.reportingOwnerId?.rptOwnerCik ?? null, roles };
  });

  const planFiling = flag(doc.aff10b5One);
  const transactions = (doc.nonDerivativeTable?.nonDerivativeTransaction || []).map((t) => {
    const code = t.transactionCoding?.transactionCode ?? null;
    const shares = num(val(t.transactionAmounts?.transactionShares));
    const price = num(val(t.transactionAmounts?.transactionPricePerShare));
    return {
      date: val(t.transactionDate),
      security: val(t.securityTitle),
      code,
      type: TRANSACTION_CODES[code] || code,
      direction: val(t.transactionAmounts?.transactionAcquiredDisposedCode) === "D" ? "disposed" : "acquired",
      shares,
      price,
      value: shares != null && price ? Math.round(shares * price) : null,
      sharesAfter: num(val(t.postTransactionAmounts?.sharesOwnedFollowingTransaction)),
      ownership: val(t.ownershipNature?.directOrIndirectOwnership) === "I" ? val(t.ownershipNature?.natureOfOwnership) || "Indirect" : "Direct",
    };
  });

  return {
    issuer: {
      name: doc.issuer?.issuerName ?? null,
      ticker: doc.issuer?.issuerTradingSymbol ?? null,
      cik: doc.issuer?.issuerCik ?? null,
    },
    owners,
    tradingPlan: planFiling, // filed under a pre-arranged Rule 10b5-1 plan
    transactions,
    derivativeCount: (doc.derivativeTable?.derivativeTransaction || []).length,
  };
}

// Lists the Form 4 filings in an EDGAR submissions record (company or person).
async function listForm4s(cik, limit) {
  const data = await secFetch(`${SEC_DATA}/submissions/CIK${pad10(cik)}.json`);
  const r = data.filings?.recent;
  if (!r) return { name: data.name, filings: [] };
  const filings = [];
  for (let i = 0; i < r.form.length && filings.length < limit; i++) {
    if (r.form[i] !== "4" && r.form[i] !== "4/A") continue;
    filings.push({
      accession: r.accessionNumber[i],
      filed: r.filingDate[i],
      amendment: r.form[i] === "4/A",
      // primaryDocument points at the rendered HTML; the raw XML drops the xsl folder.
      document: r.primaryDocument[i].replace(/^xsl[^/]+\//, ""),
    });
  }
  return { name: data.name, filings };
}

async function loadFiling(cik, filing) {
  const folder = `${SEC_WWW}/Archives/edgar/data/${Number(cik)}/${filing.accession.replace(/-/g, "")}`;
  const parsed = parseForm4(await secFetch(`${folder}/${filing.document}`, "text"));
  return { filed: filing.filed, amendment: filing.amendment, url: `${folder}/${filing.accession}-index.htm`, ...parsed };
}

async function mapLimited(items, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i]);
      } catch (err) {
        out[i] = { error: err.message };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return out;
}

let tickerMap = null;
async function tickerToCik(ticker) {
  if (!tickerMap) {
    const data = await secFetch(`${SEC_WWW}/files/company_tickers.json`);
    tickerMap = new Map(Object.values(data).map((c) => [c.ticker.toUpperCase(), { cik: c.cik_str, name: c.title }]));
  }
  return tickerMap.get(ticker.toUpperCase().replace(".", "-")) || null;
}

const tokens = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length > 1);

// Parses EDGAR full-text-search display names like "THIEL PETER  (CIK 0001211060)".
export function parseDisplayName(s) {
  const m = /^(.*?)\s*(?:\(([^()]*)\)\s*)?\(CIK (\d+)\)\s*$/.exec(s.trim());
  return m ? { name: m[1].trim(), ticker: m[2]?.trim() || null, cik: m[3] } : null;
}

// Finds EDGAR filer ids (CIKs) whose name contains every word of the query.
// EDGAR stores people as "LAST FIRST MIDDLE", so word order is ignored.
export function matchPeople(hits, query) {
  const want = tokens(query);
  const found = new Map();
  for (const hit of hits) {
    for (const dn of hit._source?.display_names || []) {
      const e = parseDisplayName(dn);
      if (!e || e.ticker) continue; // entries with a ticker are the companies
      const have = tokens(e.name);
      if (want.every((w) => have.includes(w))) {
        const prev = found.get(e.cik);
        found.set(e.cik, { ...e, extra: have.length - want.length, hits: (prev?.hits || 0) + 1 });
      }
    }
  }
  return [...found.values()].sort((a, b) => a.extra - b.extra || b.hits - a.hits);
}

async function findPeople(name) {
  const q = encodeURIComponent(tokens(name).join(" "));
  const data = await secFetch(`${SEC_SEARCH}?q=${q}&forms=4`);
  return matchPeople(data.hits?.hits || [], name);
}

function summarize(filings) {
  let bought = 0;
  let sold = 0;
  let buys = 0;
  let sells = 0;
  for (const f of filings) {
    for (const t of f.transactions || []) {
      if (t.code === "P") {
        buys++;
        bought += t.value || 0;
      } else if (t.code === "S") {
        sells++;
        sold += t.value || 0;
      }
    }
  }
  return { openMarketBuys: buys, openMarketSells: sells, boughtValue: bought, soldValue: sold };
}

// Recent Form 4 filings for a company (by ticker) or a person (by name).
export async function getInsiderTrades({ ticker, person, limit = 10 } = {}) {
  userAgent(); // fail fast with setup instructions
  limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(Number(limit) || 10)));

  if (ticker) {
    const company = await tickerToCik(String(ticker));
    if (!company) return { mode: "company", query: ticker, found: false, message: `No SEC-registered company with ticker ${ticker}.` };
    const { filings } = await listForm4s(company.cik, limit);
    const loaded = (await mapLimited(filings, (f) => loadFiling(company.cik, f))).filter((f) => !f.error);
    return {
      mode: "company",
      query: ticker.toUpperCase(),
      found: true,
      subject: company.name,
      summary: summarize(loaded),
      filings: loaded,
      source: `${SEC_WWW}/cgi-bin/browse-edgar?action=getcompany&CIK=${pad10(company.cik)}&type=4&owner=include`,
    };
  }

  if (person) {
    const matches = (await findPeople(String(person))).slice(0, 3);
    if (!matches.length) {
      return {
        mode: "person",
        query: person,
        found: false,
        message: `No SEC Form 4 filings found for "${person}". Only company officers, directors, and 10%+ shareholders file them.`,
      };
    }
    const lists = await Promise.all(matches.map(async (m) => ({ m, ...(await listForm4s(m.cik, limit)) })));
    const queue = lists
      .flatMap(({ m, filings }) => filings.map((f) => ({ cik: m.cik, f })))
      .sort((a, b) => b.f.filed.localeCompare(a.f.filed))
      .slice(0, limit);
    const loaded = (await mapLimited(queue, ({ cik, f }) => loadFiling(cik, f))).filter((f) => !f.error);
    return {
      mode: "person",
      query: person,
      found: true,
      subject: matches.map((m) => m.name).join(", "),
      filers: matches.map(({ name, cik }) => ({ name, cik })),
      summary: summarize(loaded),
      filings: loaded,
      source: `${SEC_WWW}/cgi-bin/browse-edgar?action=getcompany&CIK=${pad10(matches[0].cik)}&type=4&owner=include`,
    };
  }

  throw new InsiderError("Give a ticker or a person's name.");
}
