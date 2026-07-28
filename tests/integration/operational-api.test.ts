import { describe, expect, it } from "vitest";

import { createApp } from "../../src/app";
import type { RoadGraphManifest } from "../../src/contracts";
import type { RoadGraphProvider } from "../../src/data/load-road-graph";
import { loadRuntimeDataset } from "../../src/data/load-runtime-dataset";
import { createTestDataset } from "../fixtures/communes";

const ROAD_GRAPH_MANIFEST: RoadGraphManifest = {
  schemaVersion: 2,
  graphVersion: "test-road-graph",
  communeDatasetVersion: "test-2026-07-28",
  communeDatasetSha256: "a".repeat(64),
  osmAsOf: "2026-07-27T20:21:20Z",
  osmSourceSha256: "b".repeat(64),
  routingProfileHash: "c".repeat(64),
  assetPath: `/road-graph/${"d".repeat(64)}.bin`,
  assetSha256: "d".repeat(64),
  sizeBytes: 1024,
  nodeCount: 12,
  edgeCount: 24,
  snappedCommuneCount: 2,
  unroutableCommuneCount: 0,
  spatialCellSizeDegrees: 0.05,
  spatialCellCount: 12,
  spatialIndexNodeCount: 12,
  snapMaximumMeters: 10_000,
  minimumLatitude: 10.0,
  maximumLatitude: 11.0,
  minimumLongitude: 105.0,
  maximumLongitude: 106.0,
  attribution: "© OpenStreetMap contributors",
  licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
  shareAlikeNotice: "ODbL applies.",
};

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

  it("reports graph readiness and exposes safe graph metadata", async () => {
    const roadGraphProvider = {
      manifest: ROAD_GRAPH_MANIFEST,
      get: async () =>
        ({ manifest: ROAD_GRAPH_MANIFEST }) as Awaited<
          ReturnType<RoadGraphProvider["get"]>
        >,
    } satisfies RoadGraphProvider;
    const app = createApp(
      loadRuntimeDataset(createTestDataset(), { expectedRecordCount: 2 }),
      {
        roadGraphManifest: ROAD_GRAPH_MANIFEST,
        roadGraphProvider,
      },
    );

    const health = await app.request("/health/road-graph");
    const metadata = await app.request("/meta/road-graph");

    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({
      status: "ready",
      roadGraph: {
        loaded: true,
        version: "test-road-graph",
        nodeCount: 12,
        edgeCount: 24,
      },
    });
    expect(metadata.status).toBe(200);
    await expect(metadata.json()).resolves.toEqual(ROAD_GRAPH_MANIFEST);
  });

  it("reports a degraded graph when no static asset binding is available", async () => {
    const app = createApp(
      loadRuntimeDataset(createTestDataset(), { expectedRecordCount: 2 }),
      { roadGraphManifest: ROAD_GRAPH_MANIFEST },
    );

    const response = await app.request("/health/road-graph");

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "degraded",
      roadGraph: { loaded: false },
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
    expect(response.headers.get("x-robots-tag")).toBe(
      "noindex, nofollow, noarchive, nosnippet, noimageindex",
    );
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Route not found.",
      },
    });
  });

  it("serves robots.txt that disallows all crawlers including AI bots", async () => {
    const response = await createApp(
      loadRuntimeDataset(createTestDataset(), { expectedRecordCount: 2 }),
    ).request("/robots.txt");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/plain/);
    const body = await response.text();
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Disallow: /");
    expect(body).toContain("User-agent: GPTBot");
    expect(body).toContain("User-agent: ClaudeBot");
    expect(body).toContain("User-agent: Google-Extended");
    expect(body).toContain("User-agent: Bytespider");
    expect(body).toContain("User-agent: CCBot");
    expect(response.headers.get("x-robots-tag")).toBe(
      "noindex, nofollow, noarchive, nosnippet, noimageindex",
    );
  });
});
