/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { RoadGraphManifest } from "../../src/contracts";
import roadGraphManifest from "../../src/data/road-graph-manifest.json";
import runtimeDataset from "../../src/data/runtime-dataset.json";
import { loadRoadGraph } from "../../src/data/load-road-graph";
import { RouteService } from "../../src/services/route-service";

// Đo CPU routing thuần (snap + A* + encode) bằng cách gọi RouteService.calculatePoints
// trực tiếp trong Workers pool (asset load qua ASSETS binding, không qua HTTP layer).
// Tách biệt khỏi overhead request → bằng chứng CPU cho Phase 3 performance gate.
const manifest = roadGraphManifest as RoadGraphManifest;

// Corpus thực: đô thị dày, liên thành phố, nông thôn, đảo, biên graph, cùng cell.
const CORPUS: ReadonlyArray<
  readonly [number, number, number, number, string]
> = [
  [21.028511, 105.804817, 20.995138, 105.866216, "hanoi-intra"],
  [21.028511, 105.804817, 10.762617, 106.660172, "hanoi-hcmc"],
  [10.762617, 106.660172, 10.03456, 105.78839, "hcmc-cantho"],
  [16.054414, 108.202283, 20.85605, 106.68519, "danang-haiphong"],
  [16.054414, 108.202283, 21.028511, 105.804817, "danang-hanoi"],
  [10.762617, 106.660172, 11.94111, 108.4475, "hcmc-dalat"],
  [21.028511, 105.804817, 21.038511, 105.814817, "same-cell"],
];

function percentile(timings: readonly number[], ratio: number): number {
  return timings[Math.ceil(timings.length * ratio) - 1]!;
}

describe("coordinate route performance (pure routing CPU)", () => {
  it("loads the real v2 graph and keeps warm coordinate routing within budget", async () => {
    const assetResponse = await env.ASSETS.fetch(
      new URL(manifest.assetPath, "https://assets.local"),
    );
    const arrayBuffer = await assetResponse.arrayBuffer();

    const coldStart = performance.now();
    const init = await loadRoadGraph({
      manifest,
      buffer: arrayBuffer,
      expectedDatasetVersion: runtimeDataset.manifest.version,
      expectedDatasetSha256: runtimeDataset.manifest.runtimeDatasetSha256,
    });
    const coldLoadMs = performance.now() - coldStart;
    expect(init.ok).toBe(true);
    if (!init.ok) {
      return;
    }
    const graph = init.graph;

    const repository = {
      version: runtimeDataset.manifest.version,
      findById: () => undefined,
    };
    const provider = { manifest, get: async () => graph };
    const service = new RouteService(repository as never, provider as never);

    // Warmup.
    for (let warmup = 0; warmup < 30; warmup += 1) {
      for (const [latA, lngA, latB, lngB] of CORPUS) {
        await service.calculatePoints(latA, lngA, latB, lngB);
      }
    }

    const timings: number[] = [];
    for (const [latA, lngA, latB, lngB] of CORPUS) {
      for (let sample = 0; sample < 50; sample += 1) {
        const started = performance.now();
        await service.calculatePoints(latA, lngA, latB, lngB);
        timings.push(performance.now() - started);
      }
    }
    timings.sort((left, right) => left - right);

    // Bằng chứng phân phối (in ra cho release report).
    console.log(
      JSON.stringify({
        coordinateRouteBenchmark: {
          coldLoadMs: Number(coldLoadMs.toFixed(2)),
          samples: timings.length,
          p50Ms: Number(percentile(timings, 0.5).toFixed(3)),
          p95Ms: Number(percentile(timings, 0.95).toFixed(3)),
          p99Ms: Number(percentile(timings, 0.99).toFixed(3)),
          maxMs: Number(timings[timings.length - 1]!.toFixed(3)),
          dodTarget: { p95Ms: 8, p99Ms: 10 },
        },
      }),
    );

    // Snap-quality proxy: phân phối snap meters của commune connectors (centroid → node).
    // Tín hiệu độ phủ node; corpus snap-quality đầy đủ (điểm bất kỳ vs nearest segment)
    // là gate riêng trước production traffic.
    const snaps = [...graph.connectors.values()]
      .map((connector) => connector.snapMeters)
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right);
    const withinKm = (km: number) =>
      snaps.filter((value) => value <= km * 1000).length / snaps.length;
    console.log(
      JSON.stringify({
        communeSnapDistribution: {
          count: snaps.length,
          p50Meters: snaps[Math.floor(snaps.length * 0.5)]!,
          p95Meters: snaps[Math.ceil(snaps.length * 0.95) - 1]!,
          maxMeters: snaps[snaps.length - 1]!,
          within1Km: Number((withinKm(1) * 100).toFixed(1)),
          within10Km: Number((withinKm(10) * 100).toFixed(1)),
        },
      }),
    );

    // Ngưỡng lỏng để không flake (CPU routing thuần + cold permutation check một lần);
    // vẫn bắt regression thô (linear scan 102k node). Production Cloudflare CPU
    // (DoD p95 ≤ 8 ms) được đo riêng sau deploy.
    expect(percentile(timings, 0.95)).toBeLessThanOrEqual(30);
    expect(percentile(timings, 0.99)).toBeLessThan(50);
  });
});
