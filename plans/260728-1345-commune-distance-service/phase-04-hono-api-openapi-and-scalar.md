---
phase: 4
title: "Hono API OpenAPI and Scalar"
status: completed
priority: P1
dependencies: [3]
effort: "1-1.5 days"
---

# Phase 4: Hono API OpenAPI and Scalar

## Overview

Expose the domain service through a small Hono Worker with schema-first validation, generated OpenAPI, Scalar, operational endpoints, and normalized errors.

## Context Links

- [PRD HTTP API](../../docs/research-PRD.md#7-http-api)
- [PRD errors](../../docs/research-PRD.md#8-error-contract)
- [Phase 3 domain](./phase-03-distance-domain-core.md)

## Key Insights

- `@hono/zod-openapi` aligns runtime validation and OpenAPI.
- `createApp(dependencies)` supports both ready and typed dataset-unavailable initialization.
- OpenAPI schemas cover every actual status.
- Scalar is the only UI; `/openapi.json` is canonical.

## Requirements

- Functional: distance, health, metadata, OpenAPI, Scalar.
- Non-functional: standardized JSON errors, no unhandled exception, request-time I/O, or DB.
- CORS omitted unless a real cross-origin browser consumer is added.

## Architecture

```text
src/index.ts -> production deps -> createApp() -> routes
Zod query -> DistanceService -> response schema
errors -> centralized onError -> ErrorResponse
```

Exact contracts:

- `/health`: ready `200` or degraded `503`, with `{ status, dataset: { loaded, version?, recordCount? } }`.
- `/meta/version`: safe manifest subset; no credentials/local paths.
- Distance: PRD body with `unit: "km"` and `datasetVersion`.
- Errors: `{ error: { code, message, details? } }`; `DATASET_UNAVAILABLE` is `503`.

## Related Code Files

- Create: `/Users/hoadev/Projects/pet/vn-district-distances/src/app.ts`
- Create: `/Users/hoadev/Projects/pet/vn-district-distances/src/index.ts`
- Create: `/Users/hoadev/Projects/pet/vn-district-distances/src/schemas/api.ts`
- Create: `/Users/hoadev/Projects/pet/vn-district-distances/tests/integration/distance-api.test.ts`
- Create: `/Users/hoadev/Projects/pet/vn-district-distances/tests/integration/operational-api.test.ts`
- Create: `/Users/hoadev/Projects/pet/vn-district-distances/tests/contract/openapi.test.ts`
- Create: `/Users/hoadev/Projects/pet/vn-district-distances/tests/contract/scalar.test.ts`

## Tests Before

1. Worker tests: valid distance; `400`; origin/destination/both `404`; sanitized `500`; degraded `503`.
2. Same-ID tests follow the approved Phase 1 truth table.
3. Operational ready/degraded schema, `503`, content-type, and version-count coherence tests.
4. OpenAPI operation IDs, regex/examples, and every response schema/status.
5. Scalar HTML references `/openapi.json`; do not test third-party CDN internals.

## Implementation Steps

1. Create Zod schemas for query, success responses, manifest subset, errors.
2. Define `GET /api/v1/distances`; consume `c.req.valid("query")`.
3. Map `CommuneNotFoundError` → 404. Invalid artifact never becomes a request record; initialization maps to dataset-level 503.
4. Map Zod failures → 400 `INVALID_REQUEST`; do not echo arbitrary input.
5. Map unknown failures → 500 `INTERNAL_ERROR`; sanitize output.
6. If initialization is unavailable, keep `/health` reachable with `503 DATASET_UNAVAILABLE`; data endpoints also fail closed with sanitized `503`.
7. Add ready `/health` using actual repository/manifest values.
8. Add `/meta/version` with schema/version, `asOf`, input effective dates, count, and audit hashes.
9. Generate OpenAPI 3.1 at `/openapi.json`.
10. Mount Scalar `/scalar` with `url: "/openapi.json"` and an immutable version-pinned CDN URL—never `latest`.
11. Add tested security headers: `nosniff`, referrer policy, and a Scalar-compatible CSP allowing only self plus the pinned asset origin. Document any required inline-script exception.
12. Implement dependency-injected `createApp` and production default export.
13. Do not add permissive CORS; Scalar is same-origin.

## Refactor

- Derive types from Zod where practical; remove duplicate response shapes.
- Domain errors stay HTTP-independent.
- Route handlers contain no math or lookup details.

## Tests After

- Snapshot normalized JSON bodies, not full Scalar HTML.
- Structurally validate the generated OpenAPI document.
- Assert degraded initialization through the production-shaped bootstrap path.
- Decide/document unknown-route behavior rather than silently invent a contract.
- Assert routes do not call `fetch` or Workers bindings.

## Todo

- [x] API tests red then green for every status.
- [x] OpenAPI and actual schemas agree.
- [x] Scalar points to canonical document.
- [x] Unexpected errors are sanitized.
- [x] Known/unknown same-ID and dataset `503` decisions match validation.
- [x] Degraded `503` path remains reachable and sanitized.

## Regression Gate

```bash
npm run typecheck
npm test -- tests/unit tests/integration tests/contract
npx wrangler deploy --dry-run --outdir dist
```

## Success Criteria

- [x] All endpoints return documented statuses/content types.
- [x] `400/404/500/503` share one envelope.
- [x] OpenAPI covers every response and Scalar loads it.
- [x] Worker uses bundled data and no binding.

## Risk Assessment

- Pin compatible Hono/Zod/OpenAPI versions and inspect the document.
- Scalar asset origin/version and CSP are explicit; CDN uptime is not claimed.

## Security Considerations

- Sanitize 500 and validation details.
- `/meta/version` exposes no secrets or controlled-archive credentials.
- Auth/rate limit are intentionally absent; deployment access stays an operational boundary.

## Next Steps

Phase 5 verifies real artifacts and release readiness without deploying.
