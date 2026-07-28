---
phase: 1
title: Build coarse road graph
status: completed
priority: P1
dependencies: []
effort: 1-2 days
---

# Phase 1: Build coarse road graph

## Overview

Create a deterministic offline graph artifact from the pinned Vietnam OSM PBF
and the 3,321 committed commune centroids. Keep topology and original road
lengths accurate while aggressively simplifying display geometry.

## Requirements

- Accept motorway, trunk, primary, secondary, tertiary, their link classes,
  and motor-vehicle ferries.
- Respect one-way direction, way/node access restrictions, and barriers.
- Contract degree-2 chains. Preserve junctions, endpoints, class/mode changes,
  and direction changes.
- Calculate edge meters from unsimplified WGS84 geometry before simplifying
  Polyline6 display geometry.
- Assign every commune exactly one `snapped` or `unroutable` connector status.
- Snap distance above 10 km is `unroutable`; above 1 km is low confidence.
- Emit a content-addressed binary Static Asset plus a small manifest.

## Architecture

`PBF → filtered directed ways → topology contraction → geometry simplification
→ centroid spatial snap → CSR binary + manifest`

The binary ABI is little-endian with `VNRG` magic, schema version, a bounded
section directory, aligned numeric arrays, CSR offsets, node E6 coordinates,
directed targets/weights/flags, delta geometry, and connector records.

## Related Code Files

- Create `scripts/geo_pipeline/road_graph.py`.
- Modify `scripts/geo_pipeline/cli.py` and Python models as required.
- Generate `public/road-graph/<content-hash>.bin` and
  `src/data/road-graph-manifest.json`.
- Add focused Python fixtures/tests under `tests/python/`.

## Implementation Steps

1. Add highway/access/barrier/ferry filter and deterministic direction rules.
2. Stream the pinned PBF, retain accepted node coordinates, and build directed
   topology without materializing unrelated OSM features.
3. Contract degree-2 chains; retain original accumulated meters and simplified
   delta geometry separately.
4. Build a grid spatial index over retained road nodes and assign connectors
   for all runtime records with the approved 1 km/10 km thresholds.
5. Serialize the strict binary ABI and canonical manifest with dataset/PBF
   hashes, build-profile hash, ODbL attribution, coverage, sizes, and checksum.
6. Add CLI `build-road-graph` and `validate-road-graph` commands.
7. Add deterministic fixtures for one-way, access, barrier, ferry, contraction,
   simplification, snapping, corruption, and version drift.

## Success Criteria

- [x] Exactly 3,321 connector statuses; no missing or duplicate IDs.
- [x] Edge weights equal unsimplified source lengths within rounding tolerance.
- [x] Repeated builds are byte-identical.
- [x] Binary ABI and manifest validation reject corrupt or stale artifacts.
- [x] Asset is below 25 MiB and estimated decoded memory is below 64 MiB.
- [x] Raw PBF, catalog PDF, and local archives are never copied to `public/`.

## Risk Assessment

The graph can exceed the target size. Mitigate by simplifying geometry more
aggressively before dropping tertiary roads. If a centroid cannot attach
within 10 km, preserve it as explicit `unroutable`; do not invent a road node.
