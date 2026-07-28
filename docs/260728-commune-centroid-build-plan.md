# Commune Centroid Build Plan

> Research input only. File layout, artifact format, local archive, API semantics, and release gates are superseded by the validated [implementation plan](../plans/260728-1345-commune-distance-service/plan.md).

## Decision

Ranked choice for the build-time geometry pipeline:

1. Minimal Python pipeline with GeoPandas + Shapely + pyproj.
2. TypeScript-only pipeline with Turf + proj4js + extra glue packages.

Recommendation: choose option 1 for MVP.

Reason: the PRD needs deterministic OSM PBF extraction, geometry repair, CRS-safe centroiding, exact reconciliation against 3,321 commune codes, and reproducible provenance. Python with pyosmium, Shapely and pyproj covers those operations directly. The active source is a timestamped Geofabrik Vietnam PBF under ODbL 1.0, not eKMap or another paid API.

## Source-Based Comparison

### Python stack

- GeoPandas reads WKT and file-based vector data, supports `to_crs`, `centroid`, and `make_valid`.
- Shapely provides `from_wkt`, `shape`, `make_valid`, `covers`, `contains`, and `transform`.
- pyproj provides `Transformer.from_crs(..., always_xy=True)` for deterministic CRS conversion.
- Licensing is clean for MVP use: GeoPandas BSD-3-Clause, Shapely BSD-3-Clause, pyproj MIT.

Trade-offs:

- Pro: best fit for repair + projection + audit in one place.
- Pro: easier to write deterministic validation scripts.
- Pro: easier to pin and verify native geospatial behavior in CI.
- Con: adds Python toolchain alongside the existing TypeScript service.

### TypeScript-only stack

- Turf gives GeoJSON spatial ops, including `centroid`, `booleanPointInPolygon`, `rewind`, and `polygonize`.
- proj4js provides coordinate transforms.
- Turf is MIT-licensed and active, but its centroid is vertex-mean based, not the equal-area centroid workflow the PRD requires.
- `polygonize` expects correctly noded input; it is not a full invalid-polygon repair engine.

Trade-offs:

- Pro: single-language implementation for the build step.
- Pro: same ecosystem as the Worker runtime.
- Con: repair logic becomes custom glue across several packages.
- Con: higher risk of edge-case divergence on invalid multipolygons and boundary cases.
- Con: more burden to prove exact reconciliation and reproducibility.

## Recommendation

Use Python for the offline pipeline, TypeScript for the Worker runtime.

MVP flow:

1. Read catalog and geometry snapshots from build-time inputs.
2. Parse WKT or GeoJSON into Shapely geometries.
3. Repair invalid geometries with `make_valid`.
4. Reproject from EPSG:4326 to EPSG:6933 with pyproj.
5. Compute true centroid in projected space.
6. Transform centroid back to EPSG:4326.
7. Flag whether the centroid is outside the repaired original geometry.
8. Reconcile all records against the 3,321 commune catalog.
9. Emit `centroids.json`, `manifest.json`, and validation reports.

### Why this is the best fit

- Accuracy: built-in support for valid geometry repair and CRS-safe transforms.
- Complexity: fewer custom rules than a JS-only repair pipeline.
- Maintenance: easier to test and reason about data correctness offline.
- Reproducibility: easier to pin Python wheel versions and record provenance.
- License posture: permissive stack, no copyleft issue for an internal MVP.

## Reproducibility And ODbL Handling

- Pin exact versions in a lockfile, not loose ranges.
- Record input source URL, retrieval time, source version, and SHA-256 for every raw artifact.
- Record output SHA-256 for generated JSON artifacts.
- Pin a timestamped Geofabrik Vietnam PBF; do not build a release from the moving `latest` alias.
- Verify upstream MD5 and compute SHA-256 before moving raw inputs into the Git-ignored local content-addressed archive.
- Accept only OSM relations tagged `boundary=administrative`, `admin_level=6`.
- Fail the build if the snapshot count is not exactly 3,321 or if any commune code is missing, duplicated, or malformed.
- Fail the build if geometry repair or centroid validation produces non-finite coordinates.
- Keep OpenStreetMap attribution, ODbL URL, share-alike and derivative-database notices in the manifest and public docs.
- The observed `3.320/3.321` baseline is diagnostic only; never synthesize the missing relation.

## Exact Files To Add

### Build pipeline

- `scripts/geo/build_centroids.py`
- `scripts/geo/reconcile_catalog.py`
- `scripts/geo/validate_snapshot.py`
- `scripts/geo/write_manifest.py`

### Data artifacts

- `data/raw/catalog.csv`
- `data/raw/sha256/<digest>/vietnam-YYMMDD.osm.pbf`
- `data/out/centroids.json`
- `data/out/manifest.json`
- `data/out/validation-report.json`

### Runtime service

- `src/data/centroids.json`
- `src/data/manifest.json`
- `src/lib/geo/centroid-repository.ts`
- `src/lib/geo/haversine.ts`
- `src/routes/distances.ts`
- `src/routes/meta.ts`

### Tests

- `tests/data/build-centroids.test.py`
- `tests/data/reconcile-catalog.test.py`
- `tests/data/manifest.test.py`
- `tests/unit/geo-transform.test.py`
- `tests/unit/geo-containment.test.py`
- `tests/integration/distances-route.test.ts`
- `tests/contract/openapi.test.ts`

## Exact Commands

### Pipeline

```bash
uv sync
uv run python scripts/geo/build_centroids.py
uv run python scripts/geo/validate_snapshot.py
```

### Verification

```bash
uv run pytest
pnpm test
pnpm exec wrangler dev
pnpm exec wrangler deploy
```

## Planning Notes

- Do not attempt runtime geometry processing in the Worker.
- Do not use D1 or KV for the centroid snapshot in MVP.
- Do not substitute centroid geometry with admin-seat coordinates.
- Keep the centroid outside-geometry flag as an audit signal only.
- Treat `covers` as the boundary-safe containment check if the audit needs to treat boundary points as inside.
- Do not use eKMap, R2, a paid geometry API, or a fabricated boundary to close the reconciliation gap.

## Primary References

- [PRD](./research-PRD.md)
- [Research report](./260728-1209-current-commune-distance-research.md)
- [GeoPandas `from_wkt`](https://geopandas.org/en/latest/docs/reference/api/geopandas.GeoSeries.from_wkt.html)
- [pyosmium](https://docs.osmcode.org/pyosmium/latest/)
- [Geofabrik Vietnam extracts](https://download.geofabrik.de/asia/vietnam.html)
- [OpenStreetMap attribution guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)
- [GeoPandas `make_valid`](https://geopandas.org/en/latest/docs/reference/api/geopandas.GeoSeries.make_valid.html)
- [GeoPandas `to_crs`](https://geopandas.org/en/latest/docs/reference/api/geopandas.GeoSeries.to_crs.html)
- [GeoPandas `centroid`](https://geopandas.org/en/stable/docs/reference/api/geopandas.GeoSeries.centroid.html)
- [Shapely `from_wkt`](https://shapely.readthedocs.io/en/latest/reference/shapely.from_wkt.html)
- [Shapely `make_valid`](https://shapely.readthedocs.io/en/2.0.5/reference/shapely.make_valid.html)
- [Shapely `covers`](https://shapely.readthedocs.io/en/latest/reference/shapely.covers.html)
- [pyproj `Transformer.from_crs`](https://pyproj4.github.io/pyproj/stable/api/transformer.html)
- [Turf `centroid`](https://turfjs.org/docs/7.0.0/api/centroid)
- [Turf `booleanPointInPolygon`](https://turfjs.org/docs/7.1.0/api/booleanPointInPolygon)
- [Turf `polygonize`](https://turfjs.org/docs/7.0.0/api/polygonize)
- [proj4js README](https://github.com/proj4js/proj4js/blob/master/README.md)
- [Turf repo](https://github.com/turfjs/turf)
- [GeoPandas about](https://docs.geopandas.org/en/stable/about.html)
- [Shapely repo](https://github.com/shapely/shapely)
- [pyproj repo](https://github.com/pyproj4/pyproj)
