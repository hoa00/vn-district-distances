import { describe, expect, it } from "vitest";

import { createApp } from "../../src/app";
import { loadRuntimeDataset } from "../../src/data/load-runtime-dataset";
import { createTestDataset } from "../fixtures/communes";

describe("operational endpoints", () => {
  it("reports a coherent ready dataset", async () => {
    const app = createApp(
      loadRuntimeDataset(createTestDataset(), { expectedRecordCount: 2 }),
    );

    const health = await app.request("/health");
    const metadata = await app.request("/meta/version");

    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({
      status: "ready",
      dataset: {
        loaded: true,
        version: "test-2026-07-28",
        recordCount: 2,
      },
    });
    expect(metadata.status).toBe(200);
    await expect(metadata.json()).resolves.toMatchObject({
      schemaVersion: 1,
      version: "test-2026-07-28",
      recordCount: 2,
      inputs: expect.arrayContaining([
        expect.objectContaining({
          role: "geometry",
          shareAlikeNotice: "ODbL share-alike applies.",
          derivedDatabaseNotice: "Derived database is offered under ODbL.",
        }),
      ]),
    });
  });

  it("keeps health reachable in degraded mode", async () => {
    const app = createApp(loadRuntimeDataset(null));

    const response = await app.request("/health");

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "degraded",
      dataset: { loaded: false },
    });
  });

  it("normalizes unknown routes and emits security headers", async () => {
    const response = await createApp(
      loadRuntimeDataset(createTestDataset(), { expectedRecordCount: 2 }),
    ).request("/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Route not found.",
      },
    });
  });
});
