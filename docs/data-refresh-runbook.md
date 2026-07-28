# Data Refresh Runbook

This runbook covers a refresh of the committed static dataset artifact and the static road graph asset.

## Inputs

- Official NSO / Decision 19 commune catalog.
- Timestamped Geofabrik Vietnam OSM PBF.
- Full OpenStreetMap relation responses for `17296617` (Hoàng Sa disputed boundary) and `3479413` (Trường Sa), merged into the pinned island supplement PBF.
- `data/relation-overrides.csv` for reviewed disputed-boundary exceptions.
- Static road graph build inputs, including the bundled runtime dataset and the pinned OSM source used by `npm run data:road-graph:build`.

## Steps

1. Confirm the refresh is intended and record the target snapshot timestamp.
2. Capture all five pages of the current NSO commune grid and verify 3,321 unique five-digit codes.
3. Download a timestamped Geofabrik PBF; never use the moving `latest` alias for a release.
4. Download the two full OSM island relations from the URLs pinned in `data/sources.yaml`, merge them into one supplement PBF, and review `data/relation-overrides.csv`.
5. Verify MD5 where supplied, compute SHA-256 for every raw input, archive each file under `data/raw/sha256/<digest>/`, and update `data/sources.yaml`.
6. Run the offline pipeline with the Geofabrik PBF, island supplement, and override map to produce `src/data/runtime-dataset.json`.
7. Build the road graph asset and manifest with `npm run data:road-graph:build`. The build emits VNRG **ABI v2** (16 sections) and embeds the offline spatial index (cell keys + offsets + node indices) plus the graph bounds; the manifest records `spatialCellCount`, `spatialIndexNodeCount`, `snapMaximumMeters`, and the bbox.
8. Verify the road graph with `npm run data:road-graph:validate` (checks schema v2, the 16-section directory, spatial-index counts/bounds, and the node permutation).
9. Verify the output count is exactly `3,321/3,321` and run `npm run release:verify`.
10. Confirm OSM attribution, ODbL URL, share-alike notice, and derived-database notice are exposed by `/meta/version`.
11. Confirm the road graph health and metadata endpoints are coherent: `/health/road-graph` and `/meta/road-graph`.
12. Review the dataset artifact, road graph artifact, source manifest, override, and validation evidence diffs.
13. Commit the refreshed artifacts only when every validation passes.

## Checks

- No fabricated geometry.
- No cloud archive dependency.
- No paid service or vendor key.
- No runtime network access during the distance API.
- `upload_source_maps` remains disabled.
- Wrangler reports the expected static asset binding and serves static assets from `./public`.
- `/api/v1/road-routes` returns Polyline6 geometry and only approximate routes.
- `/api/v1/road-routes/points` snaps both WGS84 points to the nearest graph node and routes through the same kernel; points outside coverage return `422`, never a meaningless road distance. Coordinate responses carry `Cache-Control: private, no-store` and raw coordinates are not logged.
- Road-route fallback uses straight-line distance multiplied by `1.3` when a
  connector/path is unavailable or the search budget is exhausted; corrupt or
  incompatible graph assets return `503`. A geometry that would exceed the
  response budget falls back with `route-output-limit-fallback`.

## Rollback

- ABI v2 is not backward-compatible with v1 code/manifest. Deploy Worker code, manifest, and the content-addressed asset **atomically**; keep exactly one `.bin` in `public/road-graph/` (the verifier enforces this). Roll back to the previous Cloudflare deployment version (old code + manifest + versioned asset) rather than hand-editing the manifest or keeping two binaries in the tree.
- If the refresh is wrong, revert the artifact commit, restore the previous road graph asset and manifest, and rerun validation from the previous committed snapshot.
