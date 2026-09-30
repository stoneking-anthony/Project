"""Throwaway simulation of the proposed spine (docs/SPINE.md).

Not the app. Fake data only. Runs a synthetic 90-day life through the three
tables, then stress-tests the design. Findings are written up in
docs/SIMULATION.md.

    python3 sim/spine_sim.py
"""
import json
import random
import sqlite3
import time
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

LOCAL = ZoneInfo("America/New_York")
START = datetime(2026, 6, 1, tzinfo=LOCAL)
DAYS = 90
rng = random.Random(7)

SCHEMA = """
CREATE TABLE events(
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  v           INTEGER NOT NULL DEFAULT 1,
  occurred_at TEXT NOT NULL,              -- ISO, UTC
  recorded_at TEXT NOT NULL,
  payload     TEXT NOT NULL CHECK (json_valid(payload)),
  source      TEXT NOT NULL,
  source_ref  TEXT,
  corrects    TEXT REFERENCES events(id),
  UNIQUE (source, source_ref)
);
CREATE INDEX ev_kind_time ON events(kind, occurred_at);
CREATE INDEX ev_corrects  ON events(corrects);
CREATE TRIGGER ev_no_update BEFORE UPDATE ON events
  BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
CREATE TRIGGER ev_no_delete BEFORE DELETE ON events
  BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;

-- an event is live unless a later event corrects it
CREATE VIEW live AS
  SELECT * FROM events e
  WHERE NOT EXISTS (SELECT 1 FROM events c WHERE c.corrects = e.id)
    AND json_extract(payload, '$.retract') IS NULL;

CREATE TABLE sources(
  name               TEXT PRIMARY KEY,
  last_ok_at         TEXT,
  expect_every_hours REAL NOT NULL
);

CREATE TABLE standard(
  key        TEXT PRIMARY KEY,
  text       TEXT NOT NULL,
  written_at TEXT NOT NULL
);
"""


def utc(dt):
    return dt.astimezone(timezone.utc).isoformat()


class Spine:
    def __init__(self, path=":memory:"):
        self.db = sqlite3.connect(path)
        self.db.executescript(SCHEMA)
        self.ignored = 0

    def write(self, kind, occurred, payload, source, source_ref=None,
              corrects=None, v=1, recorded=None):
        eid = str(uuid.UUID(int=rng.getrandbits(128)))
        cur = self.db.execute(
            "INSERT OR IGNORE INTO events VALUES (?,?,?,?,?,?,?,?,?)",
            (eid, kind, v, utc(occurred), utc(recorded or occurred),
             json.dumps(payload), source, source_ref, corrects))
        if cur.rowcount == 0:
            self.ignored += 1
            return None
        return eid

    def source_ok(self, name, at):
        self.db.execute("UPDATE sources SET last_ok_at=? WHERE name=?",
                        (utc(at), name))

    def q(self, sql, *args):
        return self.db.execute(sql, args).fetchall()


# ---------------------------------------------------------------- features
# A feature is a writer and/or reader of kinds. None of them own storage.

FEATURES = {
    "capture":    {"writes": ["note"], "reads": []},
    "bank":       {"writes": ["money.txn", "money.balance"], "reads": []},
    "broker":     {"writes": ["money.holding"], "reads": []},
    "gym":        {"writes": ["body.workout"], "reads": []},
    "school":     {"writes": ["school.grade"], "reads": []},
    "hold_clock": {"writes": ["money.hold"], "reads": ["money.hold"]},
    "canon":      {"writes": [], "reads": ["money.balance", "money.holding",
                                           "money.txn", "body.workout",
                                           "school.grade"]},
}

MERCHANTS = [("grocery", "food"), ("gas", "transport"), ("takeout", "food"),
             ("streaming", "subs"), ("campus store", "school")]
SYMBOLS = {"VOO": 50000, "AAPL": 22000, "NVDA": 17000}  # price in cents


def txn_cents(row_v, payload):
    """Readers must understand every payload version of a kind."""
    p = json.loads(payload)
    return p["amount_cents"] if row_v >= 2 else round(p["amount"] * 100)


def simulate_life(s: Spine, days=DAYS, bank_dies_on=60, v2_from=45):
    s.db.executemany("INSERT INTO sources VALUES (?,?,?)", [
        ("import:bank", None, 24), ("import:broker", None, 24),
        ("manual", None, 24 * 7)])
    s.db.execute("INSERT INTO standard VALUES ('north_star', ?, ?)",
                 ("(the user's own sentence goes here)", utc(START)))

    balance = 150_000
    prices = dict(SYMBOLS)
    pending = []  # bank txns not yet imported
    for d in range(days):
        day = START + timedelta(days=d)

        for _ in range(rng.choice([0, 1, 1, 2, 3])):
            at = day.replace(hour=rng.randint(8, 23), minute=rng.randint(0, 59))
            s.write("note", at, {"text": f"note on day {d}"}, "manual")

        for _ in range(rng.choice([0, 1, 2, 2, 3])):
            at = day.replace(hour=rng.randint(7, 23), minute=rng.randint(0, 59))
            name, cat = rng.choice(MERCHANTS)
            cents = -rng.randint(300, 6000)
            balance += cents
            pending.append((at, f"TX{d:03d}{len(pending):04d}", name, cat, cents))
        if d % 14 == 0:
            at = day.replace(hour=6)
            balance += 102_779
            pending.append((at, f"PAY{d:03d}", "payroll", "income", 102_779))

        # bank import runs every morning and re-sends the last 3 days (overlap)
        if d < bank_dies_on:
            run_at = day.replace(hour=6, minute=30) + timedelta(days=1)
            for at, ref, name, cat, cents in pending:
                if at >= run_at - timedelta(days=4):
                    v = 2 if d >= v2_from else 1
                    payload = ({"amount_cents": cents, "merchant": name, "category": cat}
                               if v == 2 else
                               {"amount": cents / 100, "merchant": name, "category": cat})
                    s.write("money.txn", at, payload, "import:bank", ref, v=v,
                            recorded=run_at)
            s.write("money.balance", run_at, {"account": "checking", "cents": balance},
                    "import:bank", f"BAL{d:03d}", recorded=run_at)
            s.source_ok("import:bank", run_at)

        # brokerage snapshot every weekday morning (the Robinhood check)
        if day.weekday() < 5:
            snap = day.replace(hour=9, minute=35)
            for sym in prices:
                prices[sym] = max(100, int(prices[sym] * (1 + rng.gauss(0.0005, 0.015))))
                s.write("money.holding", snap,
                        {"symbol": sym, "shares": 2.0, "price_cents": prices[sym]},
                        "import:broker", f"{sym}-{snap.date()}")
            s.source_ok("import:broker", snap)

        if rng.random() < 0.55:
            at = day.replace(hour=17, minute=rng.randint(0, 59))
            s.write("body.workout", at, {"type": rng.choice(["push", "pull", "legs"]),
                                         "minutes": rng.randint(35, 80)}, "manual")
            s.source_ok("manual", at)

        if d in (20, 41, 62, 83):
            at = day.replace(hour=14)
            s.write("school.grade", at, {"course": "MATH 101", "item": f"quiz {d // 21}",
                                         "score": rng.randint(62, 98), "of": 100}, "manual")

        if d == 30:
            s.write("money.hold", day.replace(hour=21),
                    {"item": "new GPU", "cents": 120_000,
                     "until": str((day + timedelta(days=30)).date())},
                    "feature:hold_clock")
    s.db.commit()
    return START + timedelta(days=days)


# ---------------------------------------------------------------- readers

def canon(s: Spine, now):
    """Current facts. Each one carries value, previous, as_of, source."""
    facts = {}
    rows = s.q("SELECT payload, occurred_at, source FROM live "
               "WHERE kind='money.balance' ORDER BY occurred_at DESC LIMIT 2")
    if rows:
        cur, prev = rows[0], rows[1] if len(rows) > 1 else None
        facts["checking"] = {"value": json.loads(cur[0])["cents"] / 100,
                             "previous": prev and json.loads(prev[0])["cents"] / 100,
                             "as_of": cur[1][:16], "source": cur[2]}

    snap = s.q("SELECT max(occurred_at) FROM live WHERE kind='money.holding'")[0][0]
    if snap:
        hold = s.q("SELECT payload FROM live WHERE kind='money.holding' AND occurred_at=?", snap)
        total = sum(json.loads(p)["shares"] * json.loads(p)["price_cents"] for (p,) in hold)
        facts["portfolio"] = {"value": round(total / 100, 2), "as_of": snap[:16],
                              "source": "import:broker"}

    since = utc(now - timedelta(days=30))
    spend = sum(txn_cents(v, p) for v, p in s.q(
        "SELECT v, payload FROM live WHERE kind='money.txn' AND occurred_at>=? "
        "AND json_extract(payload,'$.category')!='income'", since))
    facts["spend_30d"] = {"value": -spend / 100, "source": "derived: money.txn"}

    last = s.q("SELECT max(occurred_at) FROM live WHERE kind='body.workout'")[0][0]
    facts["last_workout"] = {"value": last and (now - datetime.fromisoformat(last)).days,
                             "unit": "days ago", "source": "manual"}

    grades = s.q("SELECT payload, occurred_at FROM live WHERE kind='school.grade' "
                 "ORDER BY occurred_at")
    facts["grades"] = {"value": [json.loads(p)["score"] for p, _ in grades],
                       "source": "manual"}
    return facts


def heartbeat(s: Spine, now):
    out = []
    for name, last, every in s.q("SELECT * FROM sources"):
        age = None if last is None else (now - datetime.fromisoformat(last)).total_seconds() / 3600
        stale = age is None or age > every * 1.5
        out.append((name, "never" if age is None else f"{age / 24:.1f}d ago",
                    "STALE" if stale else "ok"))
    return out


# ---------------------------------------------------------------- report

def section(title):
    print(f"\n{'=' * 70}\n{title}\n{'=' * 70}")


def main():
    s = Spine()
    t0 = time.perf_counter()
    now = simulate_life(s)
    build_ms = (time.perf_counter() - t0) * 1000

    section("1. A 90-day life in three tables")
    for kind, n in s.q("SELECT kind, count(*) FROM events GROUP BY kind ORDER BY 2 DESC"):
        print(f"  {kind:<15} {n:>5}")
    total = s.q("SELECT count(*) FROM events")[0][0]
    print(f"  {'TOTAL':<15} {total:>5}   ({total / DAYS:.1f}/day, built in {build_ms:.0f} ms)")
    print(f"  duplicate imports silently skipped: {s.ignored}")

    section("2. The morning screen (what the phone would show)")
    for k, f in canon(s, now).items():
        print(f"  {k:<13} {f}")
    print("  heartbeat:")
    for row in heartbeat(s, now):
        print(f"    {row[0]:<15} {row[1]:<10} {row[2]}")

    section("3. Append-only is enforced by the database, not by discipline")
    for sql in ("UPDATE events SET payload='{}'", "DELETE FROM events"):
        try:
            s.db.execute(sql)
            print(f"  {sql:<32} -> ALLOWED (bad)")
        except sqlite3.DatabaseError as e:
            print(f"  {sql:<32} -> blocked: {e}")

    section("4. Corrections: fix a wrong grade without editing history")
    gid, gp = s.q("SELECT id, payload FROM events WHERE kind='school.grade' LIMIT 1")[0]
    fixed = dict(json.loads(gp), score=91)
    s.write("school.grade", START + timedelta(days=21), fixed, "manual", corrects=gid,
            recorded=now)
    print(f"  original score {json.loads(gp)['score']} -> corrected to 91")
    print(f"  grades now: {canon(s, now)['grades']['value']}")
    print(f"  rows in events for that grade: "
          f"{s.q('SELECT count(*) FROM events WHERE id=? OR corrects=?', gid, gid)[0][0]} "
          f"(both kept, one live)")

    section("5. Two devices correct the same event while offline")
    tid, tp = s.q("SELECT id, payload FROM events WHERE kind='money.txn' AND v=2 LIMIT 1")[0]
    s.write("money.txn", START, dict(json.loads(tp), category="food"), "manual",
            corrects=tid, v=2, recorded=now)
    s.write("money.txn", START, dict(json.loads(tp), category="school"), "manual",
            corrects=tid, v=2, recorded=now + timedelta(minutes=3))
    n = s.q("SELECT count(*) FROM live WHERE id IN "
            "(SELECT id FROM events WHERE corrects=?)", tid)[0][0]
    print(f"  live versions of that transaction: {n}  <- counted twice in spend")

    section("6. Payload versions: a reader that forgets v2")
    naive = sum(round(json.loads(p).get("amount", 0) * 100) for (p,) in s.q(
        "SELECT payload FROM live WHERE kind='money.txn' "
        "AND json_extract(payload,'$.category')!='income'"))
    right = sum(txn_cents(v, p) for v, p in s.q(
        "SELECT v, payload FROM live WHERE kind='money.txn' "
        "AND json_extract(payload,'$.category')!='income'"))
    print(f"  all-time spend, v1-only reader: ${-naive / 100:,.2f}")
    print(f"  all-time spend, versioned reader: ${-right / 100:,.2f}")

    section("7. A typo in a kind goes unnoticed")
    s.write("money.tnx", now, {"amount_cents": -5000, "merchant": "typo"}, "manual")
    known = {k for f in FEATURES.values() for k in f["writes"] + f["reads"]}
    stray = [k for (k,) in s.q("SELECT DISTINCT kind FROM events") if k not in known]
    print(f"  kinds no feature declares: {stray}")

    section("8. Delete a feature (hold_clock)")
    del FEATURES["hold_clock"]
    readers = {k for f in FEATURES.values() for k in f["reads"]}
    orphans = [(k, n) for k, n in s.q("SELECT kind, count(*) FROM events GROUP BY kind")
               if k not in readers and k != "note"]
    print(f"  events lost: 0 (no DELETE possible)")
    print(f"  kinds now written but unread: {orphans}")
    print(f"  canon still works: {'checking' in canon(s, now)}")

    section("9. Time zones: which day did a 11:30pm purchase happen?")
    late = s.q("SELECT occurred_at FROM events WHERE kind='money.txn' "
               "AND time(occurred_at) >= '03:30:00' AND time(occurred_at) < '04:00:00' LIMIT 1")
    if late:
        u = datetime.fromisoformat(late[0][0])
        print(f"  stored (UTC): {u.date()}   actually (local): {u.astimezone(LOCAL).date()}")
    bad = s.q("SELECT count(*) FROM events WHERE date(occurred_at) != "
              "date(occurred_at, '-4 hours')")[0][0]
    print(f"  events whose UTC date is not their local date: {bad} of {total}")

    section("10. Privacy: a secret pasted into a note")
    sid = s.write("note", now, {"text": "card 4111 1111 1111 1111"}, "manual")
    try:
        s.db.execute("UPDATE events SET payload='{\"redacted\":true}' WHERE id=?", (sid,))
        print("  redacted")
    except sqlite3.DatabaseError as e:
        print(f"  cannot remove it: {e}")
    print("  a 'retract' correction hides it from views, but the row still holds the text")

    section("11. Two devices, offline, then merged")
    laptop, phone = Spine(), Spine()
    for dev, n in ((laptop, 40), (phone, 25)):
        dev.db.executescript("")
        for i in range(n):
            dev.write("note", now + timedelta(minutes=i), {"text": f"{i}"}, "manual")
    phone_rows = phone.q("SELECT * FROM events")
    laptop.db.executemany("INSERT OR IGNORE INTO events VALUES (?,?,?,?,?,?,?,?,?)", phone_rows)
    laptop.db.executemany("INSERT OR IGNORE INTO events VALUES (?,?,?,?,?,?,?,?,?)", phone_rows)
    print(f"  laptop 40 + phone 25, merged twice -> "
          f"{laptop.q('SELECT count(*) FROM events')[0][0]} rows, no conflicts")

    section("12. Scale: how many years before reads get slow?")
    per_day = total / DAYS
    for years in (1, 5, 20, 500):
        big = Spine()
        n = int(per_day * 365 * years)
        base = START - timedelta(days=365 * years)
        kinds = ["note", "money.txn", "money.balance", "money.holding", "body.workout"]
        rows = []
        for i in range(n):
            at = base + timedelta(seconds=i * 86400 / per_day)
            k = kinds[i % len(kinds)]
            p = ({"account": "checking", "cents": 1000} if k == "money.balance" else
                 {"symbol": "VOO", "shares": 1, "price_cents": 50000} if k == "money.holding" else
                 {"amount_cents": -500, "category": "food"} if k == "money.txn" else {"x": 1})
            rows.append((str(uuid.uuid4()), k, 2, utc(at), utc(at), json.dumps(p),
                         "sim", None, None))
        big.db.executemany("INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?)", rows)
        big.db.execute("INSERT INTO sources VALUES ('sim', NULL, 24)")
        t0 = time.perf_counter()
        for _ in range(5):
            canon(big, START)
        ms = (time.perf_counter() - t0) * 1000 / 5
        size = big.q("SELECT page_count * page_size FROM pragma_page_count, pragma_page_size")[0][0]
        print(f"  {years:>3} yr  {n:>7,} events  {size / 1e6:6.1f} MB  full morning screen in {ms:6.1f} ms")


if __name__ == "__main__":
    main()
