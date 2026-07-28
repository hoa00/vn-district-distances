import { describe, expect, it, vi } from "vitest";

import type {
  CommuneCentroid,
  RoadGraphManifest,
} from "../../src/contracts";
import type {
  RoadGraph,
  RoadGraphConnector,
} from "../../src/data/load-road-graph";
import {
  CommuneNotFoundError,
  RoadGraphUnavailableError,
} from "../../src/domain/errors";
import {
  RouteService,
  encodePolyline6,
  type RoadGraphProvider,
} from "../../src/services/route-service";

const COMMUNES = [
  {
    id: "00004",
    name: "Origin",
    type: "phuong",
    provinceId: "01",
    latitude: 0,
    longitude: -0.001,
    centroidOutsideGeometry: false,
  },
  {
    id: "00292",
    name: "Destination",
    type: "phuong",
    provinceId: "01",
    latitude: 0,
    longitude: 0.031,
    centroidOutsideGeometry: false,
  },
] satisfies readonly CommuneCentroid[];

const MANIFEST: RoadGraphManifest = {
  schemaVersion: 1,
  graphVersion: "graph-v1",
  communeDatasetVersion: "dataset-v1",
  communeDatasetSha256: "a".repeat(64),
  osmAsOf: "2026-07-27T20:21:20Z",
  osmSourceSha256: "b".repeat(64),
  routingProfileHash: "c".repeat(64),
  assetPath: "/road-graph/test.bin",
  assetSha256: "d".repeat(64),
  sizeBytes: 1_000,
  nodeCount: 4,
  edgeCount: 4,
  snappedCommuneCount: 2,
  unroutableCommuneCount: 0,
  attribution: "OpenStreetMap contributors",
  licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
  shareAlikeNotice: "ODbL applies.",
};

function deltaRecords(
  records: readonly (readonly (readonly [number, number])[])[],
): { offsets: Uint32Array; deltas: Int32Array } {
  const offsets = [0];
  const deltas: number[] = [];
  for (const record of records) {
    let previousLatitude = 0;
    let previousLongitude = 0;
    record.forEach(([latitude, longitude], index) => {
      deltas.push(
        index === 0 ? latitude : latitude - previousLatitude,
        index === 0 ? longitude : longitude - previousLongitude,
      );
      previousLatitude = latitude;
      previousLongitude = longitude;
    });
    offsets.push(offsets[offsets.length - 1]! + record.length);
  }
  return {
    offsets: new Uint32Array(offsets),
    deltas: new Int32Array(deltas),
  };
}

function connector(
  index: number,
  node: number,
  snapMeters: number | null,
  geometryStart: number,
  geometryEnd: number,
): RoadGraphConnector {
  return Object.freeze({
    index,
    node,
    snapMeters,
    geometryStart,
    geometryEnd,
  });
}

function createGraph(
  overrides: Partial<RoadGraph> & {
    readonly manifest?: Readonly<RoadGraphManifest>;
  } = {},
): RoadGraph {
  const edgeGeometry = deltaRecords([
    [
      [0, 0],
      [0, 10_000],
    ],
    [
      [0, 0],
      [0, 20_000],
    ],
    [
      [0, 10_000],
      [0, 20_000],
    ],
    [
      [0, 20_000],
      [0, 30_000],
    ],
  ]);
  const connectorGeometry = deltaRecords([
    [
      [0, -1_000],
      [0, 0],
    ],
    [
      [0, 31_000],
      [0, 30_000],
    ],
  ]);
  return {
    manifest: MANIFEST,
    nodeLatE6: new Int32Array([0, 0, 0, 0]),
    nodeLngE6: new Int32Array([0, 10_000, 20_000, 30_000]),
    csrOffsets: new Uint32Array([0, 2, 3, 4, 4]),
    edgeTargets: new Uint32Array([1, 2, 2, 3]),
    edgeWeightsM: new Uint32Array([1_200, 5_000, 1_200, 1_200]),
    edgeFlags: new Uint8Array([0, 0, 0, 0]),
    edgeGeometryOffsets: edgeGeometry.offsets,
    edgeGeometryDeltas: edgeGeometry.deltas,
    connectorGeometryDeltas: connectorGeometry.deltas,
    connectors: new Map([
      ["00004", connector(0, 0, 100, 0, 2)],
      ["00292", connector(1, 3, 200, 2, 4)],
    ]),
    ...overrides,
  };
}

function createRepository() {
  const records = new Map(COMMUNES.map((commune) => [commune.id, commune]));
  return {
    version: "dataset-v1",
    findById: (id: string) => records.get(id),
  };
}

function providerFor(graph: RoadGraph) {
  const get = vi.fn(async () => graph);
  return {
    provider: { manifest: graph.manifest, get } satisfies RoadGraphProvider,
    get,
  };
}

function decodePolyline6(encoded: string): Array<readonly [number, number]> {
  const points: Array<readonly [number, number]> = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  const nextValue = () => {
    let result = 0;
    let shift = 0;
    let value: number;
    do {
      value = encoded.charCodeAt(index) - 63;
      index += 1;
      result |= (value & 0x1f) << shift;
      shift += 5;
    } while (value >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    latitude += nextValue();
    longitude += nextValue();
    points.push([latitude, longitude]);
  }
  return points;
}

describe("RouteService", () => {
  it("returns the exact shortest fixture path and concatenated Polyline6", async () => {
    const graph = createGraph();
    const { provider } = providerFor(graph);
    const result = await new RouteService(
      createRepository(),
      provider,
    ).calculate("00004", "00292");

    expect(result).toMatchObject({
      distanceKm: 3.9,
      calculationMethod: "coarse-road-graph",
      roadGraphVersion: "graph-v1",
      snaps: { originDistanceKm: 0.1, destinationDistanceKm: 0.2 },
      warnings: ["coarse-road-network"],
    });
    expect(decodePolyline6(result.route.geometry)).toEqual([
      [0, -1_000],
      [0, 0],
      [0, 10_000],
      [0, 20_000],
      [0, 30_000],
      [0, 31_000],
    ]);
    expect(result.route.pointCount).toBe(6);
  });

  it("reports long snaps and ferry use from the selected path", async () => {
    const graph = createGraph({
      edgeFlags: new Uint8Array([1, 0, 0, 0]),
      connectors: new Map([
        ["00004", connector(0, 0, 1_001, 0, 2)],
        ["00292", connector(1, 3, 200, 2, 4)],
      ]),
    });
    const { provider } = providerFor(graph);

    const result = await new RouteService(
      createRepository(),
      provider,
    ).calculate("00004", "00292");

    expect(result.warnings).toEqual([
      "coarse-road-network",
      "long-road-snap",
      "uses-ferry",
    ]);
  });

  it("returns identity without loading the graph", async () => {
    const graph = createGraph();
    const { provider, get } = providerFor(graph);

    const result = await new RouteService(
      createRepository(),
      provider,
    ).calculate("00004", "00004");

    expect(result).toMatchObject({
      distanceKm: 0,
      straightLineDistanceKm: 0,
      calculationMethod: "identity",
      warnings: [],
      snaps: { originDistanceKm: 0, destinationDistanceKm: 0 },
    });
    expect(result.route.pointCount).toBe(1);
    expect(get).not.toHaveBeenCalled();
  });

  it("falls back transparently for an unroutable connector", async () => {
    const graph = createGraph({
      connectors: new Map([
        ["00004", connector(0, -1, null, 0, 0)],
        ["00292", connector(1, 3, 200, 2, 4)],
      ]),
    });
    const { provider } = providerFor(graph);

    const result = await new RouteService(
      createRepository(),
      provider,
    ).calculate("00004", "00292");

    expect(result.calculationMethod).toBe("straight-line-fallback");
    expect(result.distanceKm).toBeCloseTo(
      result.straightLineDistanceKm * 1.3,
      1,
    );
    expect(result.warnings).toEqual(["no-road-connector"]);
    expect(result.snaps.originDistanceKm).toBeNull();
  });

  it("distinguishes disconnected and search-budget fallbacks", async () => {
    const disconnected = createGraph({
      csrOffsets: new Uint32Array([0, 1, 1, 1, 1]),
      edgeTargets: new Uint32Array([1]),
      edgeWeightsM: new Uint32Array([1_200]),
      edgeFlags: new Uint8Array([0]),
    });
    const disconnectedProvider = providerFor(disconnected).provider;
    const disconnectedResult = await new RouteService(
      createRepository(),
      disconnectedProvider,
    ).calculate("00004", "00292");
    expect(disconnectedResult.warnings).toEqual([
      "disconnected-road-graph",
    ]);

    const graph = createGraph();
    const cappedResult = await new RouteService(
      createRepository(),
      providerFor(graph).provider,
      { searchNodeCap: 1 },
    ).calculate("00004", "00292");
    expect(cappedResult.warnings).toEqual(["search-budget-fallback"]);
  });

  it("falls back before an oversized route geometry can exceed the response budget", async () => {
    const longEdge = Array.from(
      { length: 50_000 },
      (_, index) => [0, index] as const,
    );
    const edgeGeometry = deltaRecords([
      longEdge,
      [
        [0, 0],
        [0, 20_000],
      ],
      [
        [0, 10_000],
        [0, 20_000],
      ],
      [
        [0, 20_000],
        [0, 30_000],
      ],
    ]);
    const graph = createGraph({
      edgeGeometryOffsets: edgeGeometry.offsets,
      edgeGeometryDeltas: edgeGeometry.deltas,
    });

    const result = await new RouteService(
      createRepository(),
      providerFor(graph).provider,
    ).calculate("00004", "00292");

    expect(result.calculationMethod).toBe("straight-line-fallback");
    expect(result.warnings).toEqual(["search-budget-fallback"]);
    expect(result.route.geometry.length).toBeLessThan(96 * 1024);
  });

  it("preserves existence-first lookup errors and normalizes provider failures", async () => {
    const graph = createGraph();
    const failingProvider: RoadGraphProvider = {
      manifest: graph.manifest,
      get: vi.fn(async () => {
        throw new Error("asset detail");
      }),
    };
    const service = new RouteService(createRepository(), failingProvider);

    await expect(service.calculate("99999", "00004")).rejects.toBeInstanceOf(
      CommuneNotFoundError,
    );
    await expect(service.calculate("00004", "99999")).rejects.toBeInstanceOf(
      CommuneNotFoundError,
    );
    await expect(service.calculate("00004", "00292")).rejects.toBeInstanceOf(
      RoadGraphUnavailableError,
    );
  });

  it("encodes signed Polyline6 deltas", () => {
    expect(
      decodePolyline6(
        encodePolyline6([
          { latE6: 1_000_000, lngE6: -2_000_000 },
          { latE6: 999_999, lngE6: -1_999_998 },
        ]),
      ),
    ).toEqual([
      [1_000_000, -2_000_000],
      [999_999, -1_999_998],
    ]);
  });
});
