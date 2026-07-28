import { describe, expect, it } from "vitest";

import type { RoadRouteResponse } from "../../src/contracts";
import { createApp } from "../../src/app";
import { loadRuntimeDataset } from "../../src/data/load-runtime-dataset";
import {
  CommuneNotFoundError,
  RoadGraphUnavailableError,
} from "../../src/domain/errors";
import { createTestDataset } from "../fixtures/communes";

const GRAPH_ROUTE_RESPONSE: RoadRouteResponse = {
  originCommuneId: "00004",
  destinationCommuneId: "00292",
  distanceKm: 5.12,
  straightLineDistanceKm: 4.03,
  unit: "km",
  approximate: true,
  calculationMethod: "coarse-road-graph",
  datasetVersion: "test-2026-07-28",
  roadGraphVersion: "test-road-graph",
  osmAsOf: "2026-07-27T20:21:20Z",
  route: {
    encoding: "polyline6",
    geometry: "_p~iF~ps|U_ulLnnqC",
    pointCount: 2,
  },
  snaps: {
    originDistanceKm: 0.1,
    destinationDistanceKm: 0.2,
  },
  warnings: ["coarse-road-network"],
};

function createRouteApp(
  calculate: (
    originCommuneId: string,
    destinationCommuneId: string,
  ) => Promise<RoadRouteResponse> = async () => GRAPH_ROUTE_RESPONSE,
) {
  return createApp(
    loadRuntimeDataset(createTestDataset(), { expectedRecordCount: 2 }),
    {
      roadRouteService: {
        calculate,
        calculatePoints: async () => {
          throw new Error("calculatePoints is not exercised by commune route tests");
        },
      },
    },
  );
}

describe("GET /api/v1/road-routes", () => {
  it("returns an explicitly approximate Polyline6 route", async () => {
    const response = await createRouteApp().request(
      "/api/v1/road-routes?originCommuneId=00004&destinationCommuneId=00292",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(GRAPH_ROUTE_RESPONSE);
  });

  it("returns the normalized query error", async () => {
    const response = await createRouteApp().request(
      "/api/v1/road-routes?originCommuneId=4&destinationCommuneId=00292",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
  });

  it("maps missing communes to 404", async () => {
    const response = await createRouteApp(async () => {
      throw new CommuneNotFoundError(["99999"]);
    }).request(
      "/api/v1/road-routes?originCommuneId=99999&destinationCommuneId=00292",
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "COMMUNE_NOT_FOUND" },
    });
  });

  it("maps graph initialization failure to 503", async () => {
    const response = await createRouteApp(async () => {
      throw new RoadGraphUnavailableError();
    }).request(
      "/api/v1/road-routes?originCommuneId=00004&destinationCommuneId=00292",
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "ROAD_GRAPH_UNAVAILABLE",
        message: "The static road graph is temporarily unavailable.",
      },
    });
  });
});
