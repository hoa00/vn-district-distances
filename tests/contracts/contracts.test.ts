import { describe, expect, it } from "vitest";

import {
  type CoordinateRoadRouteResponse,
  DISTANCE_LOOKUP_TRUTH_TABLE,
  ERROR_CODES,
  isCommuneId,
  ROAD_ROUTE_WARNINGS,
  type DatasetManifest,
  type DistanceResponse,
  type ErrorResponse,
  type RoadRouteResponse,
  type RuntimeDataset,
} from "../../src/contracts";

describe("isCommuneId", () => {
  it.each([
    ["00004", true],
    ["01234", true],
    ["12345", true],
    ["4", false],
    ["123456", false],
    ["12A45", false],
    ["", false],
  ])("validates %j as %s", (value, expected) => {
    expect(isCommuneId(value)).toBe(expected);
  });
});

describe("immutable API decisions", () => {
  it("locks every distance lookup outcome", () => {
    expect(DISTANCE_LOOKUP_TRUTH_TABLE).toEqual([
      { scenario: "malformed", status: 400, errorCode: "INVALID_REQUEST" },
      { scenario: "known-same", status: 200, distanceKm: 0 },
      { scenario: "unknown-same", status: 404, errorCode: "COMMUNE_NOT_FOUND" },
      { scenario: "origin-missing", status: 404, errorCode: "COMMUNE_NOT_FOUND" },
      {
        scenario: "destination-missing",
        status: 404,
        errorCode: "COMMUNE_NOT_FOUND",
      },
      { scenario: "both-missing", status: 404, errorCode: "COMMUNE_NOT_FOUND" },
      {
        scenario: "dataset-unavailable",
        status: 503,
        errorCode: "DATASET_UNAVAILABLE",
      },
    ]);
  });

  it("locks the public error codes", () => {
    expect(ERROR_CODES).toEqual([
      "INVALID_REQUEST",
      "COMMUNE_NOT_FOUND",
      "DATASET_UNAVAILABLE",
      "ROAD_GRAPH_UNAVAILABLE",
      "OUTSIDE_ROAD_GRAPH_COVERAGE",
      "INTERNAL_ERROR",
    ]);
  });

  it("locks the road route warning catalog including output-limit fallback", () => {
    expect(ROAD_ROUTE_WARNINGS).toEqual([
      "coarse-road-network",
      "long-road-snap",
      "uses-ferry",
      "no-road-connector",
      "disconnected-road-graph",
      "search-budget-fallback",
      "route-output-limit-fallback",
    ]);
  });
});

describe("JSON contracts", () => {
  it("preserves five-digit IDs and manifest provenance", () => {
    const manifest = {
      schemaVersion: 1,
      version: "2026-07-28",
      asOf: "2026-07-27",
      generatedAt: "2026-07-28T00:00:00Z",
      recordCount: 1,
      inputs: [
        {
          role: "geometry",
          sourceUrl: "https://download.geofabrik.de/asia/vietnam-260727.osm.pbf",
          archivePath:
            "data/raw/sha256/abc/vietnam-260727.osm.pbf",
          effectiveAt: "2026-07-27",
          retrievedAt: "2026-07-28T00:00:00Z",
          sha256: "abc",
          attribution: "© OpenStreetMap contributors",
          licenseUrl: "https://www.openstreetmap.org/copyright",
          shareAlikeNotice: "ODbL share-alike applies.",
          derivedDatabaseNotice: "Derived database is offered under ODbL.",
        },
      ],
      runtimeDatasetSha256: "def",
    } satisfies DatasetManifest;

    const dataset = {
      manifest,
      records: [
        {
          id: "00004",
          name: "Phường Ba Đình",
          type: "phuong",
          provinceId: "01",
          latitude: 21.034,
          longitude: 105.814,
          centroidOutsideGeometry: false,
        },
      ],
    } satisfies RuntimeDataset;

    const response = {
      originCommuneId: dataset.records[0]!.id,
      destinationCommuneId: "00292",
      distanceKm: 12.34,
      unit: "km",
      datasetVersion: manifest.version,
    } satisfies DistanceResponse;

    expect(JSON.parse(JSON.stringify(response))).toMatchObject({
      originCommuneId: "00004",
      unit: "km",
    });
    expect(typeof manifest.recordCount).toBe("number");
  });

  it("represents an explicitly approximate road route", () => {
    const response = {
      originCommuneId: "00004",
      destinationCommuneId: "00292",
      distanceKm: 7.25,
      straightLineDistanceKm: 4.03,
      unit: "km",
      approximate: true,
      calculationMethod: "coarse-road-graph",
      datasetVersion: "2026.07.28",
      roadGraphVersion: "2026.07.28-abc123",
      osmAsOf: "2026-07-27T20:21:20Z",
      route: {
        encoding: "polyline6",
        geometry: "_p~iF~ps|U",
        pointCount: 2,
      },
      snaps: {
        originDistanceKm: 0.12,
        destinationDistanceKm: 0.31,
      },
      warnings: ["coarse-road-network"],
    } satisfies RoadRouteResponse;

    expect(response.approximate).toBe(true);
    expect(response.route.encoding).toBe("polyline6");
  });

  it("represents a coordinate road route with origin/destination points", () => {
    const response = {
      originPoint: { latitude: 21.028511, longitude: 105.804817 },
      destinationPoint: { latitude: 20.995138, longitude: 105.866216 },
      distanceKm: 8.42,
      straightLineDistanceKm: 7.42,
      unit: "km",
      approximate: true,
      calculationMethod: "coarse-road-graph",
      datasetVersion: "2026.07.28",
      roadGraphVersion: "v2-91ef533ce99a8507",
      osmAsOf: "2026-07-27T20:21:20Z",
      route: { encoding: "polyline6", geometry: "_p~iF~ps|U", pointCount: 12 },
      snaps: { originDistanceKm: 0.08, destinationDistanceKm: 0.12 },
      warnings: [],
    } satisfies CoordinateRoadRouteResponse;

    expect(response.originPoint.latitude).toBe(21.028511);
    expect(response.approximate).toBe(true);
  });

  it("allows structured unknown error details without any", () => {
    const response = {
      error: {
        code: "INVALID_REQUEST",
        message: "Invalid commune identifier.",
        details: { field: "originCommuneId", received: null },
      },
    } satisfies ErrorResponse;

    expect(response.error.details).toEqual({
      field: "originCommuneId",
      received: null,
    });
  });
});
