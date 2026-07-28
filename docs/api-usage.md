# API Usage

The service exposes a small read-only API for distance lookup and operational checks.

## Endpoints

- `/api/v1/distances`: return centroid-to-centroid distance in kilometers.
- `/api/v1/road-routes`: return an approximate static road route as Polyline6.
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
