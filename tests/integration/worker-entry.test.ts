/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { RoadGraphManifest } from "../../src/contracts";
import worker from "../../src/index";
import { loadRoadGraph } from "../../src/data/load-road-graph";
import roadGraphManifest from "../../src/data/road-graph-manifest.json";
import runtimeDataset from "../../src/data/runtime-dataset.json";

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

  it("serves an identity route without an Assets binding", async () => {
    const response = await worker.fetch(
      new Request(
        "https://example.test/api/v1/road-routes?originCommuneId=00004&destinationCommuneId=00004",
      ),
      {},
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      distanceKm: 0,
      calculationMethod: "identity",
      route: { encoding: "polyline6", pointCount: 1 },
    });
  });

  it("loads the real static graph and serves an approximate route", async () => {
    const asset = await env.ASSETS.fetch(
      new Request(`https://example.test${roadGraphManifest.assetPath}`),
    );
    expect(asset.status).toBe(200);
    expect((await asset.arrayBuffer()).byteLength).toBe(
      roadGraphManifest.sizeBytes,
    );
    const providerAsset = await env.ASSETS.fetch(
      new URL(roadGraphManifest.assetPath, "https://assets.local"),
    );
    expect(providerAsset.status).toBe(200);
    const providerBuffer = await providerAsset.arrayBuffer();
    expect(providerBuffer.byteLength).toBe(roadGraphManifest.sizeBytes);
    const initialization = await loadRoadGraph({
      manifest: roadGraphManifest as RoadGraphManifest,
      buffer: providerBuffer,
      expectedDatasetVersion: runtimeDataset.manifest.version,
      expectedDatasetSha256: runtimeDataset.manifest.runtimeDatasetSha256,
    });
    expect(initialization.ok).toBe(true);

    const health = await SELF.fetch(
      "https://example.test/health/road-graph",
    );
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({
      status: "ready",
      roadGraph: {
        loaded: true,
        nodeCount: 102507,
        edgeCount: 223488,
      },
    });

    const response = await SELF.fetch(
      "https://example.test/api/v1/road-routes?originCommuneId=00004&destinationCommuneId=00008",
    );
    expect(response.status).toBe(200);
    const route = (await response.json()) as {
      calculationMethod: string;
      distanceKm: number;
      route: { encoding: string; geometry: string; pointCount: number };
    };
    expect(route.calculationMethod).toBe("coarse-road-graph");
    expect(route.distanceKm).toBeGreaterThan(0);
    expect(route.route.encoding).toBe("polyline6");
    expect(route.route.geometry.length).toBeGreaterThan(0);
    expect(route.route.pointCount).toBeGreaterThan(1);

    const fallbackResponse = await SELF.fetch(
      "https://example.test/api/v1/road-routes?originCommuneId=01304&destinationCommuneId=00004",
    );
    expect(fallbackResponse.status).toBe(200);
    await expect(fallbackResponse.json()).resolves.toMatchObject({
      calculationMethod: "straight-line-fallback",
      warnings: ["no-road-connector"],
      snaps: { originDistanceKm: null },
      route: { encoding: "polyline6", pointCount: 2 },
    });
  });

  it("keeps the representative route corpus small and warm routing fast", async () => {
    const pairs = [
      ["00004", "00008"],
      ["00985", "04429"],
      ["00004", "32248"],
      ["01304", "00004"],
      ["23246", "27994"],
    ] as const;
    for (const [originCommuneId, destinationCommuneId] of pairs) {
      const response = await SELF.fetch(
        `https://example.test/api/v1/road-routes?originCommuneId=${originCommuneId}&destinationCommuneId=${destinationCommuneId}`,
      );
      expect(response.status).toBe(200);
      expect((await response.text()).length).toBeLessThanOrEqual(100 * 1024);
    }

    const timings: number[] = [];
    for (let sample = 0; sample < 25; sample += 1) {
      const started = performance.now();
      const response = await SELF.fetch(
        "https://example.test/api/v1/road-routes?originCommuneId=00004&destinationCommuneId=00008",
      );
      expect(response.status).toBe(200);
      await response.arrayBuffer();
      timings.push(performance.now() - started);
    }
    timings.sort((left, right) => left - right);
    const percentile = (ratio: number) =>
      timings[Math.ceil(timings.length * ratio) - 1]!;
    expect(percentile(0.95)).toBeLessThanOrEqual(6);
    expect(percentile(0.99)).toBeLessThan(9);
  });
});
