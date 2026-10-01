// Confidence score for a rating card: how strongly the evidence backs the call.
//
// It is a rule-based score, not a probability of profit. It rewards evidence
// that points the same way as the rating, a narrow range of outcomes, complete
// and verified data, and the analyst's own conviction. It never reaches 100%.
//
// Loaded as a plain script in the browser (defines globalThis.computeConfidence)
// and imported by the tests.

(function () {
  const FLOOR = 5;
  const CEILING = 95;
  const UNVERIFIED_PRICE_CAP = 60;
  const EARNINGS_WINDOW_DAYS = 14;
  const EARNINGS_PENALTY = 5;

  // Range, data, and conviction set how solid the analysis is. Agreement of the
  // evidence then scales it: a well-researched call the evidence contradicts
  // should still score low.
  const WEIGHTS = { range: 35, data: 30, judgment: 35 };
  const AGREEMENT_BASE = 0.2; // share of the score kept when every signal disagrees

  const RATING_SCORE = { "strong buy": 2, buy: 1, hold: 0, sell: -1, "strong sell": -2 };
  const GRADE_POINTS = { A: 4, B: 3, C: 2, D: 1, E: 0, F: 0 };
  const CONVICTION = { low: 0.35, medium: 0.6, high: 0.85 };
  const INSIDER = { "net buying": 1, routine: 0, "net selling": -1 };

  const isNum = (n) => typeof n === "number" && Number.isFinite(n);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const ratingOf = (r) => RATING_SCORE[String(r || "").toLowerCase()];

  function gradeAverage(grades) {
    if (!grades) return null;
    const pts = Object.values(grades)
      .map((g) => (typeof g === "string" ? g.trim().toUpperCase() : ""))
      .filter((g) => g[0] in GRADE_POINTS)
      .map((g) => GRADE_POINTS[g[0]] + (g[1] === "+" ? 0.3 : g[1] === "-" ? -0.3 : 0));
    return pts.length >= 3 ? pts.reduce((a, b) => a + b, 0) / pts.length : null;
  }

  // How well one signal (on a -1..1 scale) agrees with the call's direction.
  function agrees(direction, signal) {
    if (direction === 0) return 1 - Math.abs(signal); // a Hold is backed by neutral signals
    return clamp01((1 + direction * signal) / 2);
  }

  function computeConfidence(card) {
    const rating = ratingOf(card.rating);
    if (rating === undefined) return null;
    const direction = Math.sign(rating);
    const factors = [];

    // 1. Do the other signals point the same way as the rating?
    const signals = [];
    const street = ratingOf(card.street?.rating);
    if (street !== undefined) {
      const s = agrees(direction, street / 2);
      signals.push(s);
      factors.push({ key: "street", label: "Wall Street", score: s,
        note: s >= 0.66 ? `Analysts' consensus (${card.street.rating}) agrees.` : s >= 0.4 ? `Analysts' consensus (${card.street.rating}) is lukewarm on this call.` : `Analysts' consensus (${card.street.rating}) disagrees.` });
    }
    const gpa = gradeAverage(card.grades);
    if (gpa != null) {
      const s = agrees(direction, (gpa - 2) / 2);
      signals.push(s);
      factors.push({ key: "grades", label: "Factor grades", score: s,
        note: s >= 0.66 ? "The grades back the call." : s >= 0.4 ? "The grades are mixed." : "The grades point the other way." });
    }
    const insider = INSIDER[String(card.insiders || "").toLowerCase()];
    if (insider !== undefined && card.insiders) {
      // Insider selling is a weak signal (often routine), so it counts for less than buying.
      const s = agrees(direction, insider > 0 ? 1 : insider < 0 ? -0.5 : 0);
      signals.push(s);
      factors.push({ key: "insiders", label: "Insiders", score: s,
        note: insider > 0 ? "Insiders have been buying." : insider < 0 ? "Insiders have been selling." : "Insider activity is routine." });
    }
    const agreement = signals.length ? signals.reduce((a, b) => a + b, 0) / signals.length : null;

    // 2. How wide is the range of outcomes? Wider means less certain.
    let range = null;
    const sc = card.scenarios;
    if (sc && isNum(sc.bear) && isNum(sc.bull) && isNum(card.price) && card.price > 0) {
      const spread = (sc.bull - sc.bear) / card.price;
      range = clamp01((1.2 - spread) / 0.9); // 30% spread or less = 1, 120% or more = 0
      factors.push({ key: "range", label: "Range of outcomes", score: range,
        note: `Bear to bull case spans ${Math.round(spread * 100)}% of today's price${range >= 0.66 ? ", a fairly tight range." : range >= 0.33 ? "." : ", a very wide range."}` });
    }

    // 3. How complete and verified is the data?
    const checks = [
      isNum(card.price) && !!card.price_as_of,
      street !== undefined && isNum(card.street?.avg_target),
      gpa != null,
      !!(sc && isNum(sc.bear) && isNum(sc.base) && isNum(sc.bull)),
      !!card.next_earnings,
    ];
    const data = checks.filter(Boolean).length / checks.length;
    factors.push({ key: "data", label: "Data quality", score: data,
      note: `${checks.filter(Boolean).length} of ${checks.length} key data points verified.` });

    // 4. The analyst's own conviction.
    const judgment = CONVICTION[String(card.conviction || "").toLowerCase()];
    if (judgment !== undefined) {
      factors.push({ key: "judgment", label: "Analyst conviction", score: judgment, note: `Atlas's own conviction is ${card.conviction}.` });
    }

    const parts = [
      [WEIGHTS.range, range],
      [WEIGHTS.data, data],
      [WEIGHTS.judgment, judgment ?? null],
    ].filter(([, s]) => s != null);
    const weight = parts.reduce((a, [w]) => a + w, 0);
    const quality = parts.reduce((a, [w, s]) => a + w * s, 0) / weight;
    const scaled = agreement == null ? quality : quality * (AGREEMENT_BASE + (1 - AGREEMENT_BASE) * agreement);
    let score = FLOOR + (CEILING - FLOOR) * scaled;

    const warnings = [];
    if (!isNum(card.price) || !card.price_as_of) {
      if (score > UNVERIFIED_PRICE_CAP) score = UNVERIFIED_PRICE_CAP;
      warnings.push(`The current price couldn't be verified, so the score is capped at ${UNVERIFIED_PRICE_CAP}%.`);
    }
    if (card.next_earnings && card.price_as_of) {
      const days = (new Date(card.next_earnings) - new Date(card.price_as_of)) / 86400000;
      if (days >= 0 && days <= EARNINGS_WINDOW_DAYS) {
        score -= EARNINGS_PENALTY;
        warnings.push(`Earnings are ${Math.round(days)} days away and can move the stock sharply (−${EARNINGS_PENALTY} points).`);
      }
    }

    const value = Math.round(Math.max(FLOOR, Math.min(CEILING, score)));
    const level = value >= 75 ? "High" : value >= 60 ? "Solid" : value >= 40 ? "Moderate" : "Low";
    return { value, level, factors, warnings };
  }

  globalThis.computeConfidence = computeConfidence;
})();
