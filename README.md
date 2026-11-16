# Certificate Admin Console

An internal, multi-tenant admin console for reviewing course completions, issuing
certificates in bulk, revoking them, and exporting certificate data as CSV.

Built for the Ocean AI Labs Beijing technical interview assessment (version 20261102).

- Stack: Node.js + Express, SQLite (better-sqlite3, WAL), React 18 + Vite
- One command starts everything: `npm start`
- Second command verifies the acceptance scenarios: `npm run verify`

## Quick start

```bash
npm start
```

That single command:

1. installs declared dependencies if `node_modules` is missing,
2. creates `data/app.db` and applies the schema,
3. seeds the demo dataset if the database is empty,
4. builds the React client into `web/dist`,
5. serves API and UI together on <http://localhost:4000>.

Use `PORT=4100 npm start` to change the port. The server serves the API and the
built client from the same origin, so there is no CORS setup and no second
process to run.

## Actors (no login UI, by design)

The console identifies the acting admin from the `X-Actor-Token` header. The UI
exposes a switcher in the top-right corner; API clients send the header.

| Tenant | Time zone          | Admin             | Token            |
| ------ | ------------------ | ----------------- | ---------------- |
| East   | `Australia/Sydney` | `alice@east.test` | `tok_east_alice` |
| West   | `Australia/Perth`  | `bob@west.test`   | `tok_west_bob`   |

`GET /api/actors` returns the same list; it is unauthenticated because the
switcher needs to know which identities exist.

## Demo data

Both tenants deliberately contain a course titled **Safety 101** and a learner
named **Alex Lee**, so isolation cannot be faked by filtering on names.

| Tenant | Course          | Learners                                                                          |
| ------ | --------------- | --------------------------------------------------------------------------------- |
| East   | Safety 101      | Alex Lee (certified), Priya Nair, Mei Chen, Sam Okafor (completed), Tom Becker (in progress) |
| East   | Manual Handling | Hana Ito, Omar Haddad (certified), Lena Fischer, Ravi Menon (completed), Ines Moreau (in progress) |
| East   | Fire Safety     | 9 certified learners, 3 completed without a certificate                            |
| West   | Safety 101      | Alex Lee (certified), Dana White (completed), Luis Ortega (in progress)             |
| West   | Food Hygiene    | Grace Park (certified), Marcus Reed, Ivy Chen (completed)                           |
| West   | Fire Safety     | Noah Field (certified), Rita Osei, Hugo Lind (completed)                            |

Two certificates share the UTC instant `2026-01-10T13:30:00Z`: East `EAS-000001`
and West `WES-000013`. They are the fixed samples for the DST scenario.

`npm run reset` drops the database and re-seeds this dataset. Run it after
exploring the workflows, so the numbers below stay reproducible.

## Reproducing the acceptance scenarios

Start the app, then run the commands below. Set the base URL once:

```bash
BASE=http://localhost:4000
```

### A1 — Tenant isolation

```bash
# Bob lists certificates: only West rows come back
curl -s "$BASE/api/certificates?pageSize=50" -H "X-Actor-Token: tok_west_bob" | head -c 400

# Bob requests an East certificate by id: 404, no serial in the body
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/api/certificates/1" -H "X-Actor-Token: tok_west_bob"

# Bob exports: no EAS-* serials present
curl -s "$BASE/api/certificates/export" -H "X-Actor-Token: tok_west_bob" | grep -c EAS- || echo "no EAS rows"

# Bob bulk-issues an East course: 404, nothing written
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE/api/bulk-issue" \
  -H "X-Actor-Token: tok_west_bob" -H "Idempotency-Key: a1-demo" \
  -H "Content-Type: application/json" -d '{"courseId":1}'
```

### A2 — Retry safety

```bash
# Same key twice, sequentially: identical batchId and counts, no new rows
for i in 1 2; do
  curl -s -X POST "$BASE/api/bulk-issue" -H "X-Actor-Token: tok_east_alice" \
    -H "Idempotency-Key: a2-demo" -H "Content-Type: application/json" \
    -d '{"courseId":2}' | python -c "import json,sys;d=json.load(sys.stdin);print(d['batchId'],d['counts'])"
done

# Same key twice, concurrently: one logical operation
curl -s -X POST "$BASE/api/bulk-issue" -H "X-Actor-Token: tok_east_alice" \
  -H "Idempotency-Key: a2-concurrent-demo" -H "Content-Type: application/json" \
  -d '{"courseId":3}' & \
curl -s -X POST "$BASE/api/bulk-issue" -H "X-Actor-Token: tok_east_alice" \
  -H "Idempotency-Key: a2-concurrent-demo" -H "Content-Type: application/json" \
  -d '{"courseId":3}' & wait
```

Both responses carry the same `batchId`, and the second one has the header
`X-Idempotent-Replay: true`. Re-running the operation writes no additional
certificates or audit events.

### A3 — Key misuse

```bash
# Reuse the A2 key with a different course: 409
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE/api/bulk-issue" \
  -H "X-Actor-Token: tok_east_alice" -H "Idempotency-Key: a2-demo" \
  -H "Content-Type: application/json" -d '{"courseId":1}'
```

Re-sending the original payload still returns the original result, unchanged.

### A4 — Learner outcomes

```bash
curl -s -X POST "$BASE/api/bulk-issue" -H "X-Actor-Token: tok_east_alice" \
  -H "Idempotency-Key: a4-demo" -H "Content-Type: application/json" \
  -d '{"courseId":1}'
```

Expected for East `Safety 101`: `issued: 3` (Priya, Mei, Sam), `skipped: 2` with
reasons `already_certified` (Alex) and `enrolment_not_completed` (Tom),
`failed: 0`. `npm run reset` first to reproduce exactly.

### A5 — DST and local date

```bash
curl -s "$BASE/api/certificates/1" -H "X-Actor-Token: tok_east_alice"
curl -s "$BASE/api/certificates/13" -H "X-Actor-Token: tok_west_bob"
```

Both rows are `2026-01-10T13:30:00Z`. East renders `2026-01-11 00:30`
(Sydney, UTC+11 in January) and West renders `2026-01-10 21:30` (Perth, UTC+8).
List sorting and the CSV `issue_date` column use the same tenant-local calendar
date, so `EAS-000001` exports as `2026-01-11`.

### A6 — Export growth

```bash
npm run gen:100k      # 100,000 East certificates, ~2s
npm run verify:export # asserts the full scenario below
```

Manual check:

```bash
# ~600-900ms for 100,018 rows; start it in the background
curl -s "$BASE/api/certificates/export?sort=learner&dir=asc" \
  -H "X-Actor-Token: tok_east_alice" -o /tmp/export1.csv &

# the list must answer while the export streams
time curl -s "$BASE/api/certificates?pageSize=20" -H "X-Actor-Token: tok_east_alice" > /dev/null
wait

# run it again and compare
curl -s "$BASE/api/certificates/export?sort=learner&dir=asc" \
  -H "X-Actor-Token: tok_east_alice" -o /tmp/export2.csv
cmp /tmp/export1.csv /tmp/export2.csv && echo "byte identical"
wc -l /tmp/export1.csv
```

`npm run gen:100k` only affects a manual run: `npm start` never triggers it,
and `npm run reset` removes the generated rows. The generator uses 5,000
repeating learner names across 20,000 learners, so `sort=learner` produces
large groups of equal sort keys on purpose.

### A7 — Revocation audit

```bash
curl -s -X POST "$BASE/api/certificates/16/revoke" -H "X-Actor-Token: tok_east_alice"
curl -s -X POST "$BASE/api/certificates/16/revoke" -H "X-Actor-Token: tok_east_alice"
```

The first call returns `alreadyRevoked: false` and an `auditEventId`; the repeat
returns `alreadyRevoked: true` with `auditEventId: null`. The detail endpoint
shows exactly one `REVOKE` event.

## Verification

```bash
npm run verify        # A1-A5, A7 on an isolated temporary database
npm run verify:export # adds A6: 100k rows, timing, ordering, repeatability
```

The script seeds its own throw-away database, boots the app on an ephemeral
port, and prints a PASS/FAIL line per assertion. It never touches `data/app.db`.

Current result: **14/14 checks passed** (100,018 rows exported in 608 ms, list
served in 46 ms while the export was streaming).

## Project layout

```
server/          Express app, routes, SQLite schema and demo seed
  app.js         Wiring, static client, error handling
  schema.sql     Tables, indexes and constraints
  time.js        IANA time-zone conversion (never a fixed offset)
  lib/query.js   Shared filter/sort construction for list and export
  routes/        certificates, export, bulkIssue, catalog
web/             React 18 + Vite client
scripts/         start, migrate, seed, reset, generate-100k, verify
docs/            Architecture, data model, API and decision records
ai/              AI session evidence (see ai/completeness.md)
```

## Known defects and unfinished work

Honest list of what is not production-ready:

1. **No authentication.** By design, per the assessment scope. Any caller with a
   token header is trusted; tokens are plain constants in the seed.
2. **Idempotency records never expire.** `bulk_batches` grows without bound. A
   real deployment needs a retention job and a TTL on the key namespace.
3. **Stranded `IN_PROGRESS` batches.** If the process dies mid-operation the row
   stays `IN_PROGRESS` and later callers poll for 10 seconds, then receive 409.
   There is no takeover/expiry rule yet.
4. **Export is single-process.** It streams correctly and does not block the
   event loop, but a 100k export still occupies one Node worker. A multi-process
   deployment would need sticky routing or an async job + signed URL.
5. **`issued_local_date` is materialised at write time.** Changing a tenant's
   time zone later would leave historical rows on the old calendar date.
   Acceptable trade-off here; documented in `docs/decisions.md`.
6. **No pagination cursor.** The list uses `LIMIT/OFFSET`. Fine at 100k rows on
   SQLite; it would need keyset pagination at millions.
7. **Revocation is a hard state change.** There is no "reissue" flow beyond
   issuing a new certificate after revocation, and no reason/comment capture.
8. **No automated browser tests.** Coverage is the API-level verification
   script; the UI was verified manually.
9. **Concurrency is exercised within one process.** The design also holds under
   multiple workers thanks to the unique constraints, but the verification runs
   single-process.
