---
phase: 2
title: Implement route runtime and API
status: completed
priority: P1
dependencies:
  - 1
effort: 1-2 days
---

# Phase 2: Implement route runtime and API

## Overview

Add a fail-closed binary graph loader, bounded A* route service, Polyline6
response assembly, transparent fallback, and additive Hono/OpenAPI routes.

## Requirements

- Configure `ASSETS` with Worker-first handling for API paths.
- Load and validate the graph once per isolate; cache only successful immutable
  state.
- Use standard A* (`w=1`) with a binary heap and a 10,000-settled-node cap.
- Include centroid-to-snap and snap-to-centroid connector lengths and geometry.
- Return a full straight-line fallback on connector, component, no-route, or
  search-budget failure.
- Preserve every existing distance API behavior and response.

## Public API

`GET /api/v1/road-routes?originCommuneId=00004&destinationCommuneId=00292`

Response includes IDs, estimated/straight-line kilometers, method, versions,
OSM timestamp, Polyline6 geometry/point count, snap distances, and a closed
warning list. Fallback distance is `Haversine × 1.30`; same-ID uses `identity`.

## Related Code Files

- Create `src/data/load-road-graph.ts` and `src/services/route-service.ts`.
- Modify contracts, schemas, Hono app/bootstrap, Wrangler configuration, and
  generated Worker environment types.
- Add unit, integration, OpenAPI, and compatibility tests.

## Implementation Steps

1. Freeze route response, warning, manifest, health, metadata, and error types.
2. Configure the Static Assets directory/binding and inject `ASSETS` through
   typed Hono bindings; keep test overrides for asset/provider fixtures.
3. Validate asset status, content length, SHA-256, ABI header/sections,
   alignment, CSR monotonicity, indices, weights, and dataset/PBF versions.
4. Implement immutable typed-array graph views, heap, bounded A*, path
   reconstruction, delta-geometry decoding, and Polyline6 encoding.
5. Implement identity, graph-route, and fallback branches with rounding once.
6. Register route, road-graph health, and road-graph metadata endpoints.
7. Extend OpenAPI and regression tests without changing existing distance
   response semantics.

## Success Criteria

- [x] Existing `/api/v1/distances` contract tests remain byte-compatible.
- [x] Graph fixture routes match exact Dijkstra cost on the same fixture.
- [x] Directed roads, ferries, connectors, disconnected graphs, and cap fallback
  behave as specified.
- [x] Missing/corrupt/mismatched graph returns `503 ROAD_GRAPH_UNAVAILABLE`.
- [x] Known same-ID returns zero without loading the graph; unknown same-ID is
  still `404`.
- [x] Polyline6 decodes to the advertised point count and endpoints.

## Risk Assessment

Large allocations or unbounded search can exceed the Worker Free CPU/memory
budget. Use zero-copy typed views, touched-node reset, bounded search, and lazy
geometry decoding. Graph-load failure must not degrade the old distance API.
