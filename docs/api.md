# HTTP API

Base URL: `http://localhost:4000`

All certificate endpoints require the acting admin:

```
X-Actor-Token: tok_east_alice
```

Requests without a token, or with an unknown one, receive `401`.

Errors are JSON: `{ "error": "machine_code", "message": "human readable" }`.

---

## GET /api/health

`200 { "status": "ok" }`. No token required.

## GET /api/actors

Returns the identities the console can act as. Unauthenticated on purpose: the
actor switcher must render before any actor is selected.

```json
[
  {
    "email": "alice@east.test",
    "name": "Alice Nguyen",
    "token": "tok_east_alice",
    "tenantSlug": "east",
    "tenantName": "East Training",
    "timezone": "Australia/Sydney"
  }
]
```

## GET /api/courses

Courses of the acting tenant, with counts used to drive the bulk-issue control.

```json
[{ "id": 1, "title": "Safety 101", "enrolments": 5, "completed": 4, "eligible": 3 }]
```

`eligible` = completed enrolments without an active certificate.

## GET /api/certificates

| Query | Default | Notes |
| --- | --- | --- |
| `q` | — | Matches learner name or serial (case-insensitive substring) |
| `sort` | `issued_date` | `learner` \| `course` \| `serial` \| `issued_date` |
| `dir` | per sort | `asc` \| `desc`. Text sorts default `asc`, dates `desc` |
| `page` | `1` | |
| `pageSize` | `10` | Max `200` |

```json
{
  "items": [
    {
      "id": 1,
      "serial": "EAS-000001",
      "learnerId": 1,
      "learnerName": "Alex Lee",
      "courseId": 1,
      "courseTitle": "Safety 101",
      "status": "ACTIVE",
      "issuedAtUtc": "2026-01-10T13:30:00Z",
      "issuedLocalDate": "2026-01-11",
      "issuedLocalDateTime": "2026-01-11 00:30",
      "revokedAtUtc": null,
      "revokedLocalDateTime": null
    }
  ],
  "page": 1,
  "pageSize": 10,
  "total": 12,
  "totalPages": 2,
  "sort": "issued_date",
  "dir": "desc",
  "query": "",
  "tenant": { "slug": "east", "name": "East Training", "timezone": "Australia/Sydney" }
}
```

`issuedLocalDate*` is rendered in the tenant's zone. `issue_date` in the CSV is
the same value, and the `issued_date` sort is applied to it.

## GET /api/certificates/:id

Adds `batchId` and `auditEvents`:

```json
{
  "id": 1,
  "serial": "EAS-000001",
  "auditEvents": [
    {
      "id": 1,
      "action": "ISSUE",
      "actorEmail": "alice@east.test",
      "batchId": null,
      "createdAtUtc": "2026-01-10T13:30:00Z",
      "createdAtLocal": "2026-01-11 00:30",
      "detail": "Seeded demo certificate"
    }
  ]
}
```

A certificate owned by another tenant returns `404`, identical to a missing one.

## POST /api/certificates/:id/revoke

No body. Idempotent.

| Case | Status | Body |
| --- | --- | --- |
| Active certificate | `200` | `{ alreadyRevoked: false, auditEventId: 42, ... }` |
| Already revoked | `200` | `{ alreadyRevoked: true, auditEventId: null, ... }` |
| Other tenant / missing | `404` | `{ error: "certificate_not_found" }` |

Only the call that flips `ACTIVE -> REVOKED` writes a `REVOKE` audit event.

## POST /api/bulk-issue

Headers: `X-Actor-Token`, `Idempotency-Key` (required).

```json
{ "courseId": 1 }
```

Response `200`:

```json
{
  "batchId": "81bbbff8-b49e-4e66-9c3f-5adb8bb924de",
  "courseId": 1,
  "courseTitle": "Safety 101",
  "idempotencyKey": "a4-demo",
  "createdAtUtc": "2026-11-16T11:50:40Z",
  "counts": { "issued": 3, "skipped": 2, "failed": 0, "total": 5 },
  "results": [
    { "learnerId": 1, "learnerName": "Alex Lee", "outcome": "skipped", "reason": "already_certified", "certificateId": 1 },
    { "learnerId": 3, "learnerName": "Mei Chen", "outcome": "issued", "reason": null, "certificateId": 16, "serial": "EAS-000016" },
    { "learnerId": 5, "learnerName": "Tom Becker", "outcome": "skipped", "reason": "enrolment_not_completed" }
  ]
}
```

Outcomes: `issued`, `skipped` (`already_certified` | `enrolment_not_completed`),
`failed` (`issue_failed`).

Idempotency behaviour:

| Situation | Result |
| --- | --- |
| New key | Executes, stores the response snapshot |
| Same key, same payload | `200` with the stored body and `X-Idempotent-Replay: true` |
| Same key, different course or payload | `409 idempotency_key_reused`, nothing written |
| Same key while still running | Waits up to 10 s for the winner, then replays; otherwise `409 operation_in_progress` |
| Course belongs to another tenant | `404 course_not_found`, nothing written |
| Missing key | `400 missing_idempotency_key` |

## GET /api/certificates/export

Same `q`, `sort`, `dir` parameters as the list. Pagination is ignored: the export
always contains every matching row, in the list's order.

```
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="certificates-east.csv"
X-Total-Rows: 100018
```

```csv
learner_name,course_title,serial_number,issue_date
Alex Lee,Safety 101,EAS-000001,2026-01-11
```

The response streams in 200-row chunks, yielding to the event loop between
chunks, so unrelated requests are served while it runs. Ordering is
deterministic: the requested sort key followed by `id ASC`.
