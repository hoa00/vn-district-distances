---
title: Static Coarse Road Routing
description: >-
  Add a free, static, approximate car-route API backed by a simplified
  OpenStreetMap major-road graph and a transparent straight-line fallback.
status: completed
priority: P1
branch: main
tags:
  - feature
  - backend
  - api
  - data
  - infra
blockedBy: []
blocks: []
created: '2026-07-28T11:27:50.257Z'
createdBy: 'ck:plan'
source: skill
---

# Static Coarse Road Routing

## Overview

Preserve the existing centroid-distance API and add
`GET /api/v1/road-routes`. The new endpoint returns an approximate car
distance and Polyline6 geometry using a versioned, simplified road graph built
offline from the pinned Vietnam OSM PBF. Runtime performs no third-party
network calls and uses only a bundled Cloudflare Static Asset.

The graph contains motorway, trunk, primary, secondary, and tertiary roads.
Centroids connect to the nearest accepted road with a bounded straight
connector. A deterministic `Haversine × 1.30` fallback is returned when a
commune cannot attach, components are disconnected, or the search budget is
exhausted.

## Public Contract

- Existing `/api/v1/distances`, `/health`, and `/meta/version` stay compatible.
- New `/api/v1/road-routes` accepts the existing two five-digit commune IDs.
- Geometry is Polyline6. Responses identify `identity`,
  `coarse-road-graph`, or `straight-line-fallback`.
- Known same-ID returns zero. Unknown IDs remain `404`.
- Missing, corrupt, or version-mismatched graph data returns
  `503 ROAD_GRAPH_UNAVAILABLE`; normal topological failures return a
  transparent `200` fallback.
- `/health/road-graph` and `/meta/road-graph` expose independent graph
  readiness and provenance.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Build coarse road graph](./phase-01-build-coarse-road-graph.md) | Completed |
| 2 | [Implement route runtime and API](./phase-02-implement-route-runtime-and-api.md) | Completed |
| 3 | [Validate release and deploy](./phase-03-validate-release-and-deploy.md) | Completed |

## Dependencies

- The completed `260728-1345-commune-distance-service` plan supplies the
  current dataset, API conventions, and release verifier.
- Execution: Phase 1 → Phase 2 → Phase 3.
- Deployment is allowed only after all release and live-smoke gates pass.

## Key Constraints

- Cloudflare Workers Free limits: 3 MiB compressed Worker code, 10 ms CPU,
  128 MiB memory; graph asset must remain below 25 MiB.
- No paid APIs, runtime routing service, D1, KV, or R2.
- V1 supports cars only. OSM turn restrictions are intentionally excluded.
- The route is approximate and must never be presented as turn-by-turn
  navigation.
