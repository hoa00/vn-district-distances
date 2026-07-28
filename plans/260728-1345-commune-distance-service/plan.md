---
title: "Vietnam Commune Distance Service MVP"
description: "Build a tested Hono Worker from official catalog data and ODbL-licensed OSM boundaries that returns centroid-to-centroid distances for all 3,321 current Vietnamese commune-level units."
status: completed
priority: P1
branch: "main"
tags: [feature, backend, api, infra, critical]
blockedBy: []
blocks: []
created: "2026-07-28T06:45:38.374Z"
createdBy: "ck:plan"
source: skill
---

# Vietnam Commune Distance Service MVP

## Overview

Implement the approved internal MVP from data acquisition through Worker release readiness. Runtime stays TypeScript/Hono; a pinned Python pipeline combines the official catalog with a timestamped Geofabrik OpenStreetMap extract under ODbL 1.0 to create a versioned, fully reconciled centroid snapshot. No auth, rate limit, database, admin UI, scheduled sync, paid service, or road-distance feature.

## Key Decisions

- Scope mode: HOLD SCOPE. Preserve the approved MVP boundary.
- Runtime: npm, strict TypeScript, Hono, `@hono/zod-openapi`, Zod, Scalar.
- Tests: TDD with Vitest 4.1+ Workers pool and pytest for the offline pipeline.
- Data: Python/uv + pyosmium/Shapely/pyproj; `EPSG:4326 → 6933 → 4326`.
- Sources: official NSO/Decision 19 catalog + timestamped Geofabrik Vietnam OSM PBF, `admin_level=6`, ODbL 1.0.
- Storage: static runtime JSON + Git-ignored local content-addressed raw archive; no runtime binding or paid cloud storage.
- Release gate: exact `3,321/3,321` reconciliation. The 2026-07-28 artifact passes using the pinned Geofabrik extract plus two full OSM island relations; Hoàng Sa is an explicit reviewed disputed-boundary exception.
- Licensing: public attribution to OpenStreetMap contributors and ODbL linkage; redistributed derived databases remain ODbL-compatible.
- Same-ID: lookup origin first; known identical ID returns `0`, unknown identical ID returns `404`.
- Invalid bundled centroid: fail dataset initialization and return degraded `503`; no runtime `422`.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Project Contracts and Test Harness](./phase-01-project-contracts-and-test-harness.md) | Completed |
| 2 | [Open Data Snapshot Pipeline](./phase-02-licensed-data-snapshot-pipeline.md) | Completed |
| 3 | [Distance Domain Core](./phase-03-distance-domain-core.md) | Completed |
| 4 | [Hono API OpenAPI and Scalar](./phase-04-hono-api-openapi-and-scalar.md) | Completed |
| 5 | [End-to-End Release Validation](./phase-05-end-to-end-release-validation.md) | Completed |

## Dependencies

- Cross-plan: none.
- Execution: Phase 1 → 2 → 3 → 4 → 5.
- Phase 2 was the hard data gate and is now satisfied by the checksummed 3,321-record artifact. Deployment still requires separate approval.

## Validation Gates

- `npm run check`: TypeScript, Vitest, Workers integration.
- `uv run pytest`: geometry, reconciliation, manifest, determinism tests.
- Snapshot: 3,321 unique 5-digit IDs; finite/range-safe centroids; checksums/provenance.
- Contract: OpenAPI, Scalar, status/error schemas, no request-time network/storage calls.
- Release: `npx wrangler deploy --dry-run --outdir dist` and bundle-size inspection.

## Resolved Data Gate

- The committed runtime artifact reconciles all 3,321 official rows to OSM geometry. The clipped Geofabrik extract is supplemented by full OSM relations `17296617` and `3479413`; the reviewed Hoàng Sa record preserves OSM's disputed-boundary provenance.
- No proprietary polygon, paid API, guessed point, or runtime cloud storage is used.

## Red Team Review

- 2026-07-28: 15 deduplicated findings; 13 applied/modified, 2 rejected as post-MVP.
- Applied: formal data rights, bounded repair, canonical manifest, atomic promotion/rollback, guarded runtime, production smoke, bundle/Scalar policy, file consolidation.
- Rejected: SBOM/signing infrastructure and full-history secret pipeline.
- Whole-plan sweep: 13 deltas checked; 2 contract decisions routed to validation.

## Validation Log

### Session 1 — 2026-07-28

- Trigger: `ck:plan --hard --tdd` post-red-team validation.
- Verification tier: Full; claims checked: 75; verified: 69; failed: 0; unverified: 6.
- Initial unverified: six. User resolved same-ID, `503`, source-rights gate, private R2 archive, and pinned Scalar CDN; the R2 decision was later superseded by Session 2, while emitted-artifact smoke remains implementation-verified.

#### Questions & Answers

1. **[Contract]** Unknown but identical IDs: existence-first (recommended) or format-only zero? **Answer:** existence-first.
2. **[Failure]** Invalid bundled centroid: dataset `503` (recommended) or per-request `422`? **Answer:** dataset `503`; remove `422`.
3. **[Legal — historical]** Geometry source: block for explicit rights (recommended), assume eKMap rights, or user-supplied licensed data? **Answer:** block for explicit rights; superseded by OSM/ODbL in Session 2.
4. **[Storage — historical]** Raw archive: private local SHA store, Cloudflare R2, or user storage? **Answer:** private Cloudflare R2; superseded by the local SHA archive in Session 2.
5. **[Docs]** Scalar assets: pinned CDN+CSP (recommended), self-host, or unpinned latest? **Answer:** pinned CDN+CSP.

#### Confirmed Decisions and Impact

- Phase 1/3/4: existence-first same-ID; remove `422`; use degraded `503`.
- Phase 2: this historical decision was superseded by Session 2 below; the source is now Geofabrik/OSM under ODbL with a local content-addressed archive.
- Phase 4: Scalar version-pinned CDN and tested CSP.
- Verification after propagation: failed 0; remaining implementation verification 1 (exact dry-run artifact smoke capability).
- Whole-plan sweep: plan + five phases reread; stale runtime artifact/API terms reconciled; unresolved contradictions: 0.

### Session 2 — 2026-07-28

- Trigger: user required a free/open-source-only implementation and explicitly approved updating the plan and proceeding.
- Geometry source: timestamped Geofabrik Vietnam OSM PBF under ODbL 1.0; Overpass is validation-only.
- Catalog source: official NSO/Decision 19 catalog; official five-digit codes remain canonical.
- Storage: Git-ignored local SHA-256 content-addressed raw archive; Cloudflare R2 and all paid/vendor services removed.
- Reconciliation: OSM `boundary=administrative`, `admin_level=6`; match by reviewed identifiers, normalized name/type/province, and topology. Live query baseline was `3,320`, so release remains fail-closed until `3,321/3,321`.
- License obligations: attribution plus ODbL-compatible availability of any publicly redistributed derivative database.
- Review gate: approved by the user's explicit instruction, "hãy cập nhập lại rồi triển khai theo hướng đó".

### Session 3 — 2026-07-28

- The current NSO grid was captured across all five pages: 3,321 rows and 3,321 unique five-digit codes.
- Pinned geometry inputs: Geofabrik `vietnam-260727.osm.pbf` plus full OSM relations `17296617` and `3479413`, all archived by SHA-256.
- The release artifact validates at `3,321/3,321`; production health and real-code distance smoke tests pass.
- Final matrix: 19 pytest tests, 57 Vitest tests across 10 files, strict TypeScript, Wrangler dry-run, and release verifier all pass. Dry-run reports no bindings.
