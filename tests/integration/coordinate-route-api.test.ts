import { describe, expect, it } from "vitest";

import type { CoordinateRoadRouteResponse } from "../../src/contracts";
import { createApp } from "../../src/app";
import { loadRuntimeDataset } from "../../src/data/load-runtime-dataset";
import {
  OutsideRoadGraphCoverageError,
  RoadGraphUnavailableError,
} from "../../src/domain/errors";
import { createTestDataset } from "../fixtures/communes";

const POINT_RESPONSE: CoordinateRoadRouteResponse = {
  originPoint: { latitude: 21.028511, longitude: 105.804817 },
  destinationPoint: { latitude: 20.995138, longitude: 105.866216 },
  distanceKm: 8.42,
  straightLineDistanceKm: 7.42,
  unit: "km",
  approximate: true,
  calculationMethod: "coarse-road-graph",
  datasetVersion: "test-2026-07-28",
  roadGraphVersion: "test-road-graph",
  osmAsOf: "2026-07-27T20:21:20Z",
  route: { encoding: "polyline6", geometry: "_p~iF~ps|U", pointCount: 12 },
  snaps: { originDistanceKm: 0.08, destinationDistanceKm: 0.12 },
  warnings: [],
};

function createPointApp(
  calculatePoints: (
    originLat: number,
    originLng: number,
    destinationLat: number,
    destinationLng: number,
  ) => Promise<CoordinateRoadRouteResponse>,
) {
  return createApp(
    loadRuntimeDataset(createTestDataset(), { expectedRecordCount: 2 }),
    {
      roadRouteService: {
        calculate: async () => {
          throw new Error("commune route is not exercised by coordinate tests");
        },
        calculatePoints,
      },
    },
  );
}

const VALID_QUERY =
  "?originLat=21.028511&originLng=105.804817&destinationLat=20.995138&destinationLng=105.866216";

describe("GET /api/v1/road-routes/points", () => {
  it("returns an approximate coordinate route with no-store cache control", async () => {
    const response = await createPointApp(async () => POINT_RESPONSE).request(
      `/api/v1/road-routes/points${VALID_QUERY}`,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(POINT_RESPONSE);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("accepts a same-point identity request", async () => {
    const response = await createPointApp(async () => POINT_RESPONSE).request(
      "/api/v1/road-routes/points?originLat=21&originLng=105&destinationLat=21&destinationLng=105",
    );

    expect(response.status).toBe(200);
  });

  it("rejects non-numeric coordinates with 400", async () => {
    const response = await createPointApp(async () => POINT_RESPONSE).request(
      "/api/v1/road-routes/points?originLat=abc&originLng=105&destinationLat=20&destinationLng=105",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
  });

  it("rejects out-of-range latitude with 400", async () => {
    const response = await createPointApp(async () => POINT_RESPONSE).request(
      "/api/v1/road-routes/points?originLat=91&originLng=105&destinationLat=20&destinationLng=105",
    );

    expect(response.status).toBe(400);
  });

  it("rejects empty coordinates with 400", async () => {
    const response = await createPointApp(async () => POINT_RESPONSE).request(
      "/api/v1/road-routes/points?originLat=&originLng=105&destinationLat=20&destinationLng=105",
    );

    expect(response.status).toBe(400);
  });

  it("maps outside-coverage to 422 and never 404", async () => {
    const response = await createPointApp(async () => {
      throw new OutsideRoadGraphCoverageError();
    }).request(`/api/v1/road-routes/points${VALID_QUERY}`);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "OUTSIDE_ROAD_GRAPH_COVERAGE" },
    });
  });

  it("maps graph unavailability to 503", async () => {
    const response = await createPointApp(async () => {
      throw new RoadGraphUnavailableError();
    }).request(`/api/v1/road-routes/points${VALID_QUERY}`);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ROAD_GRAPH_UNAVAILABLE" },
    });
  });

  it("does not declare a 404 response for coordinate errors", async () => {
    const document = (await createApp(
      loadRuntimeDataset(createTestDataset(), { expectedRecordCount: 2 }),
    ).request("/openapi.json")) as unknown as { json: () => Promise<unknown> };
    const body = (await document.json()) as {
      paths: Record<string, { get?: { responses?: Record<string, unknown> } }>;
    };
    expect(
      Object.keys(
        body.paths["/api/v1/road-routes/points"]?.get?.responses ?? {},
      ),
    ).not.toContain("404");
  });
});
