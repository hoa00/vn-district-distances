import { describe, expect, it } from "vitest";

import { createApp } from "../../src/app";
import { loadRuntimeDataset } from "../../src/data/load-runtime-dataset";
import { createTestDataset } from "../fixtures/communes";

function createReadyApp() {
  return createApp(
    loadRuntimeDataset(createTestDataset(), { expectedRecordCount: 2 }),
  );
}

describe("GET /api/v1/distances", () => {
  it("returns a valid distance", async () => {
    const response = await createReadyApp().request(
      "/api/v1/distances?originCommuneId=00004&destinationCommuneId=00292",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      originCommuneId: "00004",
      destinationCommuneId: "00292",
      unit: "km",
      datasetVersion: "test-2026-07-28",
    });
  });

  it.each([
    "/api/v1/distances",
    "/api/v1/distances?originCommuneId=4&destinationCommuneId=00292",
    "/api/v1/distances?originCommuneId=00004&destinationCommuneId=abcde",
  ])("returns a normalized 400 for malformed query %s", async (path) => {
    const response = await createReadyApp().request(path);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Both commune identifiers must contain exactly five digits.",
      },
    });
  });

  it.each([
    ["99999", "00292"],
    ["00004", "99999"],
    ["99999", "99999"],
  ])("returns a normalized 404 for unknown IDs", async (origin, destination) => {
    const response = await createReadyApp().request(
      `/api/v1/distances?originCommuneId=${origin}&destinationCommuneId=${destination}`,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "COMMUNE_NOT_FOUND",
        message: "One or more commune identifiers were not found.",
      },
    });
  });

  it("returns zero for a known same ID", async () => {
    const response = await createReadyApp().request(
      "/api/v1/distances?originCommuneId=00004&destinationCommuneId=00004",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ distanceKm: 0 });
  });

  it("fails closed when the bundled dataset is unavailable", async () => {
    const response = await createApp(loadRuntimeDataset(null)).request(
      "/api/v1/distances?originCommuneId=00004&destinationCommuneId=00292",
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "DATASET_UNAVAILABLE",
        message: "The commune dataset is temporarily unavailable.",
      },
    });
  });

  it("sanitizes unexpected failures", async () => {
    const app = createApp(
      loadRuntimeDataset(createTestDataset(), { expectedRecordCount: 2 }),
      {
      distanceService: {
        calculate() {
          throw new Error("sensitive internal detail");
        },
      },
      },
    );

    const response = await app.request(
      "/api/v1/distances?originCommuneId=00004&destinationCommuneId=00292",
    );

    expect(response.status).toBe(500);
    expect(await response.text()).toBe(
      JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred.",
        },
      }),
    );
  });
});
