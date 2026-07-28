# API Usage

The service exposes a small read-only API for distance lookup and operational checks.

## Endpoints

- `/api/v1/distances`: return centroid-to-centroid distance in kilometers.
- `/health`: report bundled dataset readiness.
- `/meta/version`: return version, `asOf`, count, and hashes.
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

## Operational Notes

- The API is read-only.
- The response contract does not change the centroid method.
- `/meta/version` exposes each input's attribution, license URL, share-alike notice, and derived-database notice.
- OSM geometry is ODbL 1.0; the official NSO catalog is used as public factual reference data with attribution.
