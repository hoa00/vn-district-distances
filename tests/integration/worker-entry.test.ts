import { describe, expect, it } from "vitest";

import worker from "../../src/index";

describe("production Worker entry", () => {
  it("starts ready with the fully reconciled production artifact", async () => {
    const response = await worker.fetch(
      new Request("https://example.test/health"),
      {},
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      dataset: {
        loaded: true,
        version: "2026.07.28",
        recordCount: 3321,
      },
    });
  });

  it("serves a distance from real production commune codes", async () => {
    const response = await worker.fetch(
      new Request(
        "https://example.test/api/v1/distances?originCommuneId=00004&destinationCommuneId=00008",
      ),
      {},
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      originCommuneId: "00004",
      destinationCommuneId: "00008",
      unit: "km",
    });
  });
});
