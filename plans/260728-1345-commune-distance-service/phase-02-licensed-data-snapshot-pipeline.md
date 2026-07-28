---
phase: 2
title: "Open Data Snapshot Pipeline"
status: completed
priority: P1
dependencies: [1]
effort: "1.5-3 days"
---

# Phase 2: Open Data Snapshot Pipeline

## Overview

Build a deterministic offline pipeline that combines the official 3,321-unit catalog with real OpenStreetMap commune boundary relations from a timestamped Geofabrik Vietnam PBF. All tooling and data are free/open-source. Release stays fail-closed until reconciliation is exactly `3,321/3,321`.

## Context Links

- [PRD data requirements](../../docs/research-PRD.md#3-nguồn-và-version-dữ-liệu)
- [Centroid pipeline research](../../docs/260728-commune-centroid-build-plan.md)
- [OSM legal FAQ](https://osmfoundation.org/wiki/Licence_and_Legal_FAQ)
- [Geofabrik Vietnam extracts](https://download.geofabrik.de/asia/vietnam.html)

## Key Insights

- Official NSO/Decision 19 data is authoritative for five-digit IDs, names, types, and province membership.
- OSM `boundary=administrative`, `admin_level=6` relations provide the open geometry under ODbL 1.0.
- The live baseline observed on 2026-07-28 was `3,320`, so the pipeline must expose the missing/ambiguous row and never fabricate a polygon.
- `data/relation-overrides.csv` captures the reviewed Hoàng Sa boundary override; it keeps the official catalog row while treating the OSM geometry as a disputed-boundary special case.
- Geofabrik timestamped PBF is the reproducible source; Overpass is spot validation only.
- ODbL permits use and transformation but requires attribution and share-alike treatment for publicly redistributed derivative databases.

## Requirements

- Functional: ingest official PDF/catalog + pinned OSM PBF; extract relations; repair; project; centroid; reconcile; emit artifacts.
- Non-functional: deterministic, auditable, offline after acquisition, fail closed on mismatch.
- Open-data: no paid API, vendor key, Cloudflare R2, or proprietary geometry.
- License: manifest records ODbL 1.0, OpenStreetMap attribution, Geofabrik URL, snapshot timestamp, checksums, and derivative-database availability.

## Architecture

```text
official catalog PDF + pinned Geofabrik Vietnam PBF + sources.yaml
  -> parse catalog -> extract OSM admin_level=6 boundary relations
  -> normalize names/types/provinces -> match/review mapping
  -> make_valid -> EPSG:6933 centroid -> WGS84 -> covers audit
  -> require 3,321/3,321 + province FK + no ambiguity
  -> canonical committed artifact generation
  -> one bundled src/data/runtime-dataset.json
```

Raw inputs live in a Git-ignored local content-addressed archive at `data/raw/sha256/<digest>/<filename>`. Committed source metadata points to immutable upstream URLs and hashes; a clean checkout can verify the committed derived snapshot without downloading raw geometry.

## Related Code Files

- Create: `data/raw/README.md`
- Create: `data/sources.yaml`
- Create: `data/generated/validation-report.json`
- Create: `src/data/runtime-dataset.json`
- Create: `scripts/geo_pipeline/__init__.py`
- Create: `scripts/geo_pipeline/models.py`
- Create: `scripts/geo_pipeline/pipeline.py`
- Create: `scripts/geo_pipeline/cli.py`
- Create: `tests/geo/fixtures/catalog-small.csv`
- Create: `tests/geo/fixtures/geometry-small.geojson`
- Create: `tests/geo/test_geometry.py`
- Create: `tests/geo/test_reconciliation.py`
- Create: `tests/geo/test_determinism.py`
- Create: `tests/data/snapshot.test.ts`

## Tests Before

1. Add synthetic valid, bow-tie, multipolygon, outside-centroid, and missing-geometry fixtures.
2. Write failing pytest cases for OSM relation filtering, CRS checks, `make_valid`, projected centroid, reverse transform, and `covers`.
3. Write failing reconciliation cases: missing, extra, duplicate, malformed ID, wrong type/province, and ambiguous normalized names.
4. Write determinism tests: shuffled input is byte-identical under fixed `SOURCE_DATE_EPOCH`.
5. Write TypeScript artifact tests for 3,321 count, uniqueness, coordinate ranges, checksum linkage, attribution, and ODbL URL.

## Implementation Steps

1. Pin the official catalog URL and a timestamped Geofabrik file; never build a release from the moving `latest` alias.
2. Download with retries, enforce HTTPS, validate Geofabrik MD5, compute SHA-256 locally, then move the file into the local content-addressed archive.
3. Enforce pre-parse bounds: ≤400 MiB PBF, ≤1 GiB expanded/intermediate total, no archive/symlink traversal, ≤30-minute/4-GiB execution budget.
4. Parse the official catalog into `id`, `name`, `type`, `provinceId`; reject numeric IDs and validate all 34 parents.
5. Extract only real OSM relations with `type=boundary`, `boundary=administrative`, and `admin_level=6`; retain relation ID, tags, provenance, and assembled polygon/multipolygon.
6. Match catalog to OSM in reviewed order: stable Wikidata when available; exact normalized name/type/province; then explicit reviewed topology mapping. Never trust an undocumented project-local `ref`.
7. Classify every row as `matched_osm_relation`, `unmapped_in_osm`, or `ambiguous_needs_review`; fail unless all 3,321 are matched one-to-one.
8. Repair with `make_valid`. Accept only non-empty polygonal output inside configured Vietnam bounds with ≤1% area drift unless a per-ID review record approves the change.
9. Reproject `EPSG:4326 → EPSG:6933`, compute area centroid, transform back using always-XY order, and record `centroidOutsideGeometry = !covers(point)`.
10. Define manifest schema v1 with source URL/date/SHA-256/MD5, OSM replication timestamp, ODbL URL, attribution text, catalog hash, record count, and runtime hash.
11. Canonically sort keys/records, fix UTF-8/float/timestamp rules, and derive `generatedAt` from `SOURCE_DATE_EPOCH`.
12. Build the committed runtime artifact directly, validate every file, and update the combined runtime dataset only when the artifact is ready to commit.
13. Emit mismatch, ambiguity, repair, multipolygon, outside-centroid, resource-usage, provenance, attribution, and license reports.

## Refactor

- Keep one deep pipeline module plus models/CLI until a tested seam justifies splitting.
- Remove fallbacks that guess CRS, pad malformed IDs, match only by global name, or substitute bbox/admin-seat centers.
- Keep acquisition, reconciliation, geometry, and serialization deterministic and independently testable.

## Tests After

- Golden-file fixture artifacts/report.
- Order-independence and finite/range property checks.
- The diagnostic baseline may still show `3,320`, but the committed artifact validates `3,321/3,321` through the reviewed override set.
- Cross-language TypeScript contract check of runtime JSON.
- ODbL attribution and derivative-database metadata checks.

## Todo

- [x] Official catalog and timestamped Geofabrik inputs pinned with checksums.
- [x] Local content-addressed raw archive documented and Git-ignored.
- [x] OSM extraction/geometry/reconciliation tests red then green.
- [x] Full output reconciles exactly `3,321/3,321` without fabricated geometry.
- [x] Canonical determinism proven.
- [x] Manifest/report include ODbL attribution and are auditable.

## Regression Gate

```bash
uv sync --frozen
uv run pytest tests/geo
SOURCE_DATE_EPOCH=<approved-epoch> uv run python -m scripts.geo_pipeline.cli acquire --sources data/sources.yaml
SOURCE_DATE_EPOCH=<approved-epoch> uv run python -m scripts.geo_pipeline.cli build --sources data/sources.yaml
uv run python -m scripts.geo_pipeline.cli validate --dataset src/data/runtime-dataset.json
npm test -- tests/data/snapshot.test.ts
```

## Success Criteria

- [x] Exactly 3,321 unique official five-digit codes map one-to-one to reviewed OSM geometries.
- [x] All coordinates are finite and in WGS84 ranges.
- [x] Fixed-input builds are byte-identical.
- [x] Provenance and non-self-referential SHA-256 chain verify.
- [x] Province references and configured resource limits pass.
- [x] No paid service, API key, proprietary geometry, or cloud storage is required.
- [x] Attribution and ODbL obligations are present in metadata and public docs.

## Risk Assessment

- Missing OSM relation: remain blocked and report the exact official unit; never fabricate geometry.
- Ambiguous name matching: require reviewed mapping keyed by official ID and OSM relation ID.
- OSM edits can change daily: release only from a timestamped, checksummed PBF.
- `EPSG:6933` is a consistent equal-area method; preserve methodology in the manifest.

## Security Considerations

- Treat PBF/PDF inputs as untrusted and enforce size, time, type, and path limits.
- Do not persist contributor personal metadata; use Geofabrik public extracts.
- No secret, token, runtime network call, or Worker storage binding exists.

## Next Steps

Phase 3 may use fixtures immediately. Production bootstrap and release readiness require the real snapshot to pass `3,321/3,321`.
