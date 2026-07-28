# API Usage

The service exposes a small read-only API for distance lookup and operational checks.

## Endpoints

- `/api/v1/distances`: return centroid-to-centroid distance in kilometers.
- `/api/v1/road-routes`: return an approximate static road route as Polyline6.
- `/api/v1/road-routes/points`: return an approximate static road route for two WGS84 coordinates.
- `/health`: report bundled dataset readiness.
- `/health/road-graph`: report whether the static road graph can be loaded.
- `/meta/version`: return version, `asOf`, count, and hashes.
- `/meta/road-graph`: return the road graph manifest.
- `/openapi.json`: return the OpenAPI document.
- `/scalar`: return the Scalar API reference UI.

## Distance Request

```http
GET /api/v1/distances?originCommuneId=00004&destinationCommuneId=00292
```

Rules:

- Both IDs must be 5 digits.
- Same known ID returns `0`.
- Unknown origin or destination returns `404`.
- Invalid query input returns `400`.
- A broken bundled dataset returns `503`.

## Road Route Request

```http
GET /api/v1/road-routes?originCommuneId=00004&destinationCommuneId=00292
```

The road-route endpoint uses the same five-digit commune IDs as `/api/v1/distances`, but returns an explicitly approximate route over the static road graph.

Key behavior:

- `approximate` is always `true`.
- `calculationMethod` is one of `identity`, `coarse-road-graph`, or `straight-line-fallback`.
- `route.encoding` is always `polyline6`.
- `route.geometry` is an encoded Polyline6 string built from E6 coordinates.
- `snaps.originDistanceKm` and `snaps.destinationDistanceKm` are reported in kilometers and may be `null` when the connector is missing.
- When a commune has no road connector, the graph is disconnected, or the
  search budget is exhausted, the service falls back to straight-line distance
  multiplied by `1.3`. A missing, corrupt, or incompatible graph asset returns
  `503 ROAD_GRAPH_UNAVAILABLE` instead.

Warnings:

- `coarse-road-network`
- `long-road-snap`
- `uses-ferry`
- `no-road-connector`
- `disconnected-road-graph`
- `search-budget-fallback`
- `route-output-limit-fallback` — emitted when A* succeeds but the encoded geometry would exceed the response budget, so the service falls back to straight-line distance instead.

## Coordinate Road Route Request

```http
GET /api/v1/road-routes/points
  ?originLat=21.028511
  &originLng=105.804817
  &destinationLat=20.995138
  &destinationLng=105.866216
```

The coordinate endpoint accepts four WGS84 query parameters (latitude in `[-90, 90]`, longitude in `[-180, 180]`). Each point is normalized to six decimals (E6), snapped to the nearest node of the static road graph through an offline grid spatial index, and routed over the **same** A*/geometry/fallback kernel as the commune endpoint.

Key behavior:

- Same identity / `coarse-road-graph` / `straight-line-fallback` methods, same Polyline6 encoding, same `1.3` straight-line fallback factor.
- The response uses `originPoint`/`destinationPoint` (`{ latitude, longitude }`) instead of commune IDs.
- A point **clearly outside** the road-graph coverage area (the graph bounding box expanded by the snap radius) returns `422 OUTSIDE_ROAD_GRAPH_COVERAGE` — it does **not** return a meaningless global road distance.
- A point **inside** coverage but with no road node within the 10 km snap radius returns a transparent `200` straight-line fallback with the `no-road-connector` warning.
- Invalid (empty, non-finite, out-of-range) coordinates return `400 INVALID_REQUEST`. There is no `404` for coordinate errors.
- Responses carry `Cache-Control: private, no-store`; raw coordinates are not logged by the application.

```json
{
  "originPoint": { "latitude": 21.028511, "longitude": 105.804817 },
  "destinationPoint": { "latitude": 20.995138, "longitude": 105.866216 },
  "distanceKm": 8.42,
  "straightLineDistanceKm": 7.42,
  "unit": "km",
  "approximate": true,
  "calculationMethod": "coarse-road-graph",
  "datasetVersion": "2026.07.28",
  "roadGraphVersion": "v2-91ef533ce99a8507",
  "osmAsOf": "2026-07-27T20:21:20Z",
  "route": { "encoding": "polyline6", "geometry": "...", "pointCount": 12 },
  "snaps": { "originDistanceKm": 0.08, "destinationDistanceKm": 0.12 },
  "warnings": []
}
```

Snapping is node-only (MVP): a coordinate snaps to the nearest contracted graph node, not to an exact road segment. Distances are therefore approximate, bounded, and deterministic — not guaranteed shortest paths over the full road network.

## Response Shape

```json
{
  "originCommuneId": "00004",
  "destinationCommuneId": "00292",
  "distanceKm": 12.34,
  "unit": "km",
  "datasetVersion": "2026-07-28"
}
```

The road-route response adds:

```json
{
  "straightLineDistanceKm": 4.03,
  "approximate": true,
  "calculationMethod": "coarse-road-graph",
  "roadGraphVersion": "2026.07.28-abc123",
  "osmAsOf": "2026-07-27T20:21:20Z",
  "route": {
    "encoding": "polyline6",
    "geometry": "_p~iF~ps|U",
    "pointCount": 2
  },
  "snaps": {
    "originDistanceKm": 0.12,
    "destinationDistanceKm": 0.31
  },
  "warnings": ["coarse-road-network"]
}
```

## Operational Notes

- The API is read-only.
- The response contract does not change the centroid method.
- `/meta/version` exposes each input's attribution, license URL, share-alike notice, and derived-database notice.
- `/meta/road-graph` exposes the road graph manifest used by the static route service.
- `/health/road-graph` returns `200` when the graph is ready and `503` when the static asset binding or asset load fails.
- OSM geometry is ODbL 1.0; the official NSO catalog is used as public factual reference data with attribution.
