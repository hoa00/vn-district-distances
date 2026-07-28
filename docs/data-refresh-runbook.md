# Data Refresh Runbook

This runbook covers a refresh of the committed static dataset artifact.

## Inputs

- Official NSO / Decision 19 commune catalog.
- Timestamped Geofabrik Vietnam OSM PBF.
- Full OpenStreetMap relation responses for `17296617` (Hoàng Sa disputed boundary) and `3479413` (Trường Sa), merged into the pinned island supplement PBF.
- `data/relation-overrides.csv` for reviewed disputed-boundary exceptions.

## Steps

1. Confirm the refresh is intended and record the target snapshot timestamp.
2. Capture all five pages of the current NSO commune grid and verify 3,321 unique five-digit codes.
3. Download a timestamped Geofabrik PBF; never use the moving `latest` alias for a release.
4. Download the two full OSM island relations from the URLs pinned in `data/sources.yaml`, merge them into one supplement PBF, and review `data/relation-overrides.csv`.
5. Verify MD5 where supplied, compute SHA-256 for every raw input, archive each file under `data/raw/sha256/<digest>/`, and update `data/sources.yaml`.
6. Run the offline pipeline with the Geofabrik PBF, island supplement, and override map to produce `src/data/runtime-dataset.json`.
7. Verify the output count is exactly `3,321/3,321` and run `npm run release:verify`.
8. Confirm OSM attribution, ODbL URL, share-alike notice, and derived-database notice are exposed by `/meta/version`.
9. Review the artifact, source manifest, override, and validation evidence diffs.
10. Commit the refreshed artifact only when every validation passes.

## Checks

- No fabricated geometry.
- No cloud archive dependency.
- No paid service or vendor key.
- No runtime network access during the distance API.
- `upload_source_maps` remains disabled and Wrangler reports no bindings.

## Rollback

- If the refresh is wrong, revert the artifact commit and rerun validation from the previous committed snapshot.
