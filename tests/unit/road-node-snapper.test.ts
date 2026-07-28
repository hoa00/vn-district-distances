import { describe, expect, it } from "vitest";

import type { RoadGraphManifest } from "../../src/contracts";
import type { RoadGraph } from "../../src/data/load-road-graph";
import { haversineMeters } from "../../src/domain/geo";
import {
  normalizeE6,
  snapNearestNode,
} from "../../src/services/road-node-snapper";

const CELLS_PER_DEGREE = 20;
const COLUMNS_PER_ROW = 7201;

// Mirror công thức cell key của snapper/builder để dựng spatial index test.
function cellKey(latitude: number, longitude: number): number {
  const row = Math.floor((latitude + 90) * CELLS_PER_DEGREE);
  const column = Math.floor((longitude + 180) * CELLS_PER_DEGREE);
  return row * COLUMNS_PER_ROW + column;
}

function buildManifest(overrides: Partial<RoadGraphManifest>): RoadGraphManifest {
  return {
    schemaVersion: 2,
    graphVersion: "snapper-test",
    communeDatasetVersion: "d",
    communeDatasetSha256: "a".repeat(64),
    osmAsOf: "2026-07-27T20:21:20Z",
    osmSourceSha256: "b".repeat(64),
    routingProfileHash: "c".repeat(64),
    assetPath: "/road-graph/x.bin",
    assetSha256: "d".repeat(64),
    sizeBytes: 1,
    nodeCount: 0,
    edgeCount: 0,
    snappedCommuneCount: 0,
    unroutableCommuneCount: 0,
    spatialCellSizeDegrees: 0.05,
    spatialCellCount: 0,
    spatialIndexNodeCount: 0,
    snapMaximumMeters: 10_000,
    minimumLatitude: 0,
    maximumLatitude: 0,
    minimumLongitude: 0,
    maximumLongitude: 0,
    attribution: "OSM",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    shareAlikeNotice: "ODbL",
    ...overrides,
  };
}

function buildGraph(
  nodes: ReadonlyArray<readonly [number, number]>,
  bbox: {
    readonly minimumLatitude: number;
    readonly maximumLatitude: number;
    readonly minimumLongitude: number;
    readonly maximumLongitude: number;
  },
): RoadGraph {
  const buckets = new Map<number, number[]>();
  nodes.forEach(([latitude, longitude], index) => {
    const key = cellKey(latitude, longitude);
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, [index]);
    } else {
      bucket.push(index);
    }
  });
  const cellKeys = [...buckets.keys()].sort((left, right) => left - right);
  const cellOffsets = [0];
  const nodeIndices: number[] = [];
  for (const key of cellKeys) {
    nodeIndices.push(...buckets.get(key)!.sort((left, right) => left - right));
    cellOffsets.push(nodeIndices.length);
  }

  return {
    manifest: buildManifest({
      nodeCount: nodes.length,
      spatialCellCount: cellKeys.length,
      spatialIndexNodeCount: nodes.length,
      ...bbox,
    }),
    nodeLatE6: new Int32Array(nodes.map(([latitude]) => Math.round(latitude * 1_000_000))),
    nodeLngE6: new Int32Array(nodes.map(([, longitude]) => Math.round(longitude * 1_000_000))),
    csrOffsets: new Uint32Array(),
    edgeTargets: new Uint32Array(),
    edgeWeightsM: new Uint32Array(),
    edgeFlags: new Uint8Array(),
    edgeGeometryOffsets: new Uint32Array(),
    edgeGeometryDeltas: new Int32Array(),
    connectorGeometryDeltas: new Int32Array(),
    spatialCellKeys: new Uint32Array(cellKeys),
    spatialCellOffsets: new Uint32Array(cellOffsets),
    spatialNodeIndices: new Uint32Array(nodeIndices),
    connectors: new Map(),
  };
}

const HANOI_BBOX = {
  minimumLatitude: 21.0,
  maximumLatitude: 22.0,
  minimumLongitude: 105.0,
  maximumLongitude: 106.0,
};

describe("road-node-snapper", () => {
  it("snaps to the exact node when the point coincides with it", () => {
    const graph = buildGraph(
      [
        [21.0, 105.0],
        [21.06, 105.0],
        [22.0, 106.0],
      ],
      HANOI_BBOX,
    );
    const result = snapNearestNode(graph, normalizeE6(21.0, 105.0));
    expect(result).toMatchObject({ status: "snapped" });
    if (result.status === "snapped") {
      expect(result.snap.node).toBe(0);
      expect(result.snap.snapMeters).toBe(0);
    }
  });

  it("snaps across a neighbor cell to the closest node", () => {
    const graph = buildGraph(
      [
        [21.0, 105.0],
        [21.06, 105.0],
        [22.0, 106.0],
      ],
      HANOI_BBOX,
    );
    // (21.055, 105.0) gần node 1 (21.06) hơn node 0 (21.0).
    const result = snapNearestNode(graph, normalizeE6(21.055, 105.0));
    expect(result).toMatchObject({ status: "snapped" });
    if (result.status === "snapped") {
      expect(result.snap.node).toBe(1);
      expect(result.snap.snapMeters).toBe(
        Math.ceil(haversineMeters(21.055, 105.0, 21.06, 105.0)),
      );
    }
  });

  it("picks the lower node index on an exact haversine tie", () => {
    const graph = buildGraph(
      [
        [21.0, 104.95],
        [21.0, 105.05],
      ],
      { ...HANOI_BBOX, minimumLongitude: 104.0 },
    );
    // (21.0, 105.0) cách đều hai node đối xứng (~5.2 km); tie-break chọn index nhỏ hơn (0).
    const result = snapNearestNode(graph, normalizeE6(21.0, 105.0));
    expect(result).toMatchObject({ status: "snapped" });
    if (result.status === "snapped") {
      expect(result.snap.node).toBe(0);
    }
  });

  it("returns outside-coverage for points beyond the expanded bbox without enumerating", () => {
    const graph = buildGraph(
      [
        [21.0, 105.0],
        [22.0, 106.0],
      ],
      HANOI_BBOX,
    );
    expect(snapNearestNode(graph, normalizeE6(89.0, 179.0))).toMatchObject({
      status: "outside-coverage",
    });
    expect(snapNearestNode(graph, normalizeE6(30.0, 120.0))).toMatchObject({
      status: "outside-coverage",
    });
  });

  it("returns no-connector when the point is inside the bbox but no node within snap max", () => {
    const graph = buildGraph(
      [
        [21.0, 105.0],
        [22.0, 106.0],
      ],
      HANOI_BBOX,
    );
    // (21.5, 105.5) trong bbox nhưng cách mọi node > 10 km.
    const result = snapNearestNode(graph, normalizeE6(21.5, 105.5));
    expect(result).toMatchObject({ status: "no-connector" });
  });

  it("preserves the normalized E6 input point on the snapped result", () => {
    const graph = buildGraph([[21.0, 105.0]], HANOI_BBOX);
    const point = normalizeE6(21.0004, 105.0007);
    const result = snapNearestNode(graph, point);
    expect(result).toMatchObject({ status: "snapped" });
    if (result.status === "snapped") {
      expect(result.snap.point).toEqual(point);
    }
  });

  it("normalizes negative zero in E6 conversion", () => {
    const point = normalizeE6(-0.0000004, -0.0000004);
    expect(Object.is(point.latE6, 0)).toBe(true);
    expect(Object.is(point.lngE6, 0)).toBe(true);
  });
});
