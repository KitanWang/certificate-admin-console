# Decision log

Material decisions, each linked to the AI session that produced it, the commit
that contains it, and the evidence used to accept or reject it.

Session identifiers refer to `ai/session-index.csv`. All times are `+08:00`.

---

## 1. Accepted — the runtime and storage proposal

- **Session:** S-001
- **Commit:** `e74bfc7` (scaffold), `66eca54` (client)
- **Type:** AI suggestion accepted

**Context.** The brief fixes the outer frame (Node/Python/Go, SQLite/MySQL/
PostgreSQL, React/Vue) but not the combination. The binding constraint is the
one-command startup on a machine that may have none of it installed.

**Suggestion.** Node + Express + better-sqlite3 (WAL) + React/Vite, with the CSV
export streaming in chunks and yielding to the event loop.

**Why accepted.**

- No external service means `npm start` can genuinely be the only command; a
  PostgreSQL or MySQL container would have made the reviewer's first step a
  prerequisite failure.
- WAL is required for the export scenario: the list endpoint must be served
  while a 100k-row read is in flight. A default rollback-journal database would
  serialise that.
- One language keeps the dependency tree and build to a single step, which
  matters when the entire deliverable is produced in one sitting.

**Evidence.** `npm run verify:export` → 14/14 checks, including
"100,018 rows in 608 ms, list served in 46 ms".

**Cost accepted.** SQLite serialises writers. Bulk issue touches tens of rows,
so this never becomes a bottleneck in scope. Recorded in `docs/decisions.md`
(D1) with the PostgreSQL migration path.

---

## 2. Corrected — the startup script inherited a closed database handle

- **Session:** S-001
- **Commit:** `1fa0d2b`
- **Type:** AI output corrected after running it

**What the AI produced.** `scripts/start.js` seeded the database and then called
`db.close()` on the handle it had obtained from `getDb()`.

**How it failed.** `server/db.js` caches one connection in a module-level
variable. Closing the handle directly leaves that cache pointing at a closed
connection, so the server that starts immediately afterwards reuses it:

```
TypeError: The database connection is not open
    at Database.exec (.../better-sqlite3/lib/methods/wrappers.js:9:14)
    at applySchema (server/db.js:40:6)
    at createApp (server/app.js:16:3)
```

`npm start` exited with code 1 after printing `[start] existing database reused`.

**Correction.** Close through the module (`closeDb()`), which both closes and
invalidates the cached handle, so the server opens its own connection. The same
change was applied to `migrate`, `seed`, `reset` and `generate-100k`.

**Evidence.** `npm start` → `[server] listening on http://localhost:4000`, then
`curl -o /dev/null -w "%{http_code}" localhost:4000/api/health` → `200`.

**Lesson recorded.** This is exactly the class of defect that a passing type
check and a reading of the diff both miss, and that one real execution finds in
two seconds. It is why the startup path is exercised end to end rather than
assumed.

---

## 3. Corrected — a verification assertion that only held on the small dataset

- **Session:** S-001
- **Commit:** `1fa0d2b`
- **Type:** AI output corrected by its own verification

**What the AI produced.** The A5 check asserted the local date by fetching
`/api/certificates?sort=issued_date&dir=desc&pageSize=50` and looking for
`EAS-000001` in the first page.

**How it failed.** It passed against the demo dataset and failed under
`npm run verify:export`, because 100,000 generated rows dated
February–March 2026 sort ahead of the January sample:

```
FAIL  A5 list sort and CSV use the local calendar date —
      Cannot read properties of undefined (reading 'issuedLocalDate')
```

**Correction.** Query by serial (`?q=EAS-000001`) so the assertion is
independent of dataset size. The product behaviour was correct; the test was
not.

**Why this is recorded.** It is the difference between "the suite is green" and
"the suite would still be green on the data the reviewer will actually use". The
verification script now runs the same assertions against both datasets.

**Evidence.** `npm run verify` → 12/12; `npm run verify:export` → 14/14.

---

## 4. Trade-off — materialising the tenant-local issue date

- **Session:** S-001
- **Commit:** `e74bfc7`
- **Type:** scope and design trade-off

**Context.** The date appears in three places that must agree: the list sort, the
CSV column, and the DST acceptance check. Sydney is UTC+11 in January, so a
stored offset or an SQL expression is wrong twice a year. SQLite ships no IANA
time zone database.

**Options.**

1. Convert per row at read time with `Intl`. Correct, but sorting 100k rows
   requires a full scan plus a sort on a derived value, and it must be repeated
   for every page and every export.
2. Convert in SQL with a fixed offset. Cheap and wrong across DST.
3. Store the local calendar date at write time, indexed, and render the
   wall-clock string per request.

**Decision.** Option 3.

**Reasoning.** The correctness-critical value is the calendar date; the
wall-clock rendering needs no index. Materialising the date keeps the sort and
the CSV on one indexed column, which is what makes the export fast and the two
orderings identical by construction rather than by coincidence.

**Cost.** Changing a tenant's time zone does not rewrite history. A product that
supported time-zone changes would need a backfill or a `zone_at_issue` column.
Out of scope here, listed in the README's known defects, and recorded as D3 in
`docs/decisions.md`.

**Verification.** `2026-01-10T13:30:00Z` → `2026-01-11 00:30` (Sydney) and
`2026-01-10 21:30` (Perth), asserted in A5 against both the detail endpoint and
the CSV.
