import { describe, expect, it } from "vitest";

import type { RoadGraphManifest } from "../../src/contracts";
import {
  loadRoadGraph,
  ROAD_GRAPH_DATA_OFFSET,
  ROAD_GRAPH_DIRECTORY_ENTRY_BYTES,
  ROAD_GRAPH_HEADER_BYTES,
  ROAD_GRAPH_MAGIC,
  ROAD_GRAPH_SECTION_COUNT,
} from "../../src/data/load-road-graph";

const DATASET_SHA = "a".repeat(64);
const OSM_SHA = "b".repeat(64);
const PROFILE_SHA = "c".repeat(64);

interface FixtureSection {
  readonly id: number;
  readonly width: 1 | 4;
  readonly values: readonly number[];
  readonly signed?: boolean;
}

const FIXTURE_SECTIONS: readonly FixtureSection[] = [
  { id: 1, width: 4, signed: true, values: [21_000_000, 21_010_000] },
  { id: 2, width: 4, signed: true, values: [105_000_000, 105_010_000] },
  { id: 3, width: 4, values: [0, 1, 1] },
  { id: 4, width: 4, values: [1] },
  { id: 5, width: 4, values: [1_500] },
  { id: 6, width: 1, values: [0] },
  { id: 7, width: 4, values: [0, 2] },
  {
    id: 8,
    width: 4,
    signed: true,
    values: [21_000_000, 105_000_000, 10_000, 10_000],
  },
  { id: 9, width: 4, values: [4, 292] },
  { id: 10, width: 4, signed: true, values: [0, 1] },
  { id: 11, width: 4, values: [100, 200] },
  { id: 12, width: 4, values: [0, 2, 4] },
  {
    id: 13,
    width: 4,
    signed: true,
    values: [
      20_999_000,
      104_999_000,
      1_000,
      1_000,
      21_011_000,
      105_011_000,
      -1_000,
      -1_000,
    ],
  },
];

function align8(value: number): number {
  return Math.ceil(value / 8) * 8;
}

function buildFixtureBuffer(
  mutate?: (view: DataView, sections: ReadonlyMap<number, number>) => void,
  fixtures: readonly FixtureSection[] = FIXTURE_SECTIONS,
): ArrayBuffer {
  let cursor = ROAD_GRAPH_DATA_OFFSET;
  const offsets = new Map<number, number>();
  for (const fixture of fixtures) {
    cursor = align8(cursor);
    offsets.set(fixture.id, cursor);
    cursor += fixture.width * fixture.values.length;
  }
  const buffer = new ArrayBuffer(cursor);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < ROAD_GRAPH_MAGIC.length; index += 1) {
    bytes[index] = ROAD_GRAPH_MAGIC.charCodeAt(index);
  }
  const view = new DataView(buffer);
  view.setUint16(4, 1, true);
  view.setUint16(6, ROAD_GRAPH_SECTION_COUNT, true);
  view.setUint32(8, ROAD_GRAPH_DATA_OFFSET, true);
  view.setUint32(12, 2, true);
  view.setUint32(16, 1, true);
  view.setUint32(20, 2, true);

  for (const fixture of fixtures) {
    const directory =
      ROAD_GRAPH_HEADER_BYTES +
      (fixture.id - 1) * ROAD_GRAPH_DIRECTORY_ENTRY_BYTES;
    const offset = offsets.get(fixture.id)!;
    view.setUint16(directory, fixture.id, true);
    view.setUint8(directory + 2, fixture.width);
    view.setUint8(directory + 3, 0);
    view.setUint32(directory + 4, offset, true);
    view.setUint32(
      directory + 8,
      fixture.width * fixture.values.length,
      true,
    );
    view.setUint32(directory + 12, fixture.values.length, true);

    fixture.values.forEach((value, index) => {
      const itemOffset = offset + index * fixture.width;
      if (fixture.width === 1) {
        view.setUint8(itemOffset, value);
      } else if (fixture.signed) {
        view.setInt32(itemOffset, value, true);
      } else {
        view.setUint32(itemOffset, value, true);
      }
    });
  }
  mutate?.(view, offsets);
  return buffer;
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function manifestFor(buffer: ArrayBuffer): Promise<RoadGraphManifest> {
  return {
    schemaVersion: 1,
    graphVersion: "test-road-graph",
    communeDatasetVersion: "test-dataset",
    communeDatasetSha256: DATASET_SHA,
    osmAsOf: "2026-07-27T20:21:20Z",
    osmSourceSha256: OSM_SHA,
    routingProfileHash: PROFILE_SHA,
    assetPath: "/road-graph/test.bin",
    assetSha256: await sha256(buffer),
    sizeBytes: buffer.byteLength,
    nodeCount: 2,
    edgeCount: 1,
    snappedCommuneCount: 2,
    unroutableCommuneCount: 0,
    attribution: "OpenStreetMap contributors",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    shareAlikeNotice: "ODbL applies.",
  };
}

describe("loadRoadGraph", () => {
  it("loads validated zero-copy graph views and indexed connectors", async () => {
    const buffer = buildFixtureBuffer();
    const result = await loadRoadGraph({
      manifest: await manifestFor(buffer),
      buffer,
      expectedDatasetVersion: "test-dataset",
      expectedDatasetSha256: DATASET_SHA,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect([...result.graph.nodeLatE6]).toEqual([21_000_000, 21_010_000]);
    expect([...result.graph.csrOffsets]).toEqual([0, 1, 1]);
    expect(result.graph.connectors.get("00004")).toMatchObject({
      node: 0,
      snapMeters: 100,
      geometryStart: 0,
      geometryEnd: 2,
    });
    expect(result.graph.connectors.get("00292")).toMatchObject({
      node: 1,
      snapMeters: 200,
    });
  });

  it("takes zero-copy ownership of the validated buffer", async () => {
    const buffer = buildFixtureBuffer();
    const result = await loadRoadGraph({
      manifest: await manifestFor(buffer),
      buffer,
      expectedDatasetVersion: "test-dataset",
      expectedDatasetSha256: DATASET_SHA,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(buffer.byteLength).toBe(0);
    expect(result.graph.nodeLatE6[0]).toBe(21_000_000);
  });

  it("rejects checksum and dataset version mismatches", async () => {
    const buffer = buildFixtureBuffer();
    const manifest = await manifestFor(buffer);

    await expect(
      loadRoadGraph({
        manifest: { ...manifest, assetSha256: "f".repeat(64) },
        buffer,
        expectedDatasetVersion: "test-dataset",
        expectedDatasetSha256: DATASET_SHA,
      }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      loadRoadGraph({
        manifest,
        buffer,
        expectedDatasetVersion: "another-dataset",
        expectedDatasetSha256: DATASET_SHA,
      }),
    ).resolves.toMatchObject({ ok: false });
  });

  it("rejects invalid terminal CSR and geometry offsets", async () => {
    const corruptBuffers = [
      buildFixtureBuffer((view, offsets) => {
        view.setUint32(offsets.get(3)! + 8, 0, true);
      }),
      buildFixtureBuffer((view, offsets) => {
        view.setUint32(offsets.get(7)! + 4, 3, true);
      }),
    ];

    for (const buffer of corruptBuffers) {
      const result = await loadRoadGraph({
        manifest: await manifestFor(buffer),
        buffer,
        expectedDatasetVersion: "test-dataset",
        expectedDatasetSha256: DATASET_SHA,
      });
      expect(result.ok).toBe(false);
    }
  });

  it("accepts explicit unroutable connector sentinels only with no geometry", async () => {
    const fixtures = FIXTURE_SECTIONS.map((fixture) => {
      if (fixture.id === 12) {
        return { ...fixture, values: [0, 2, 2] };
      }
      if (fixture.id === 13) {
        return { ...fixture, values: fixture.values.slice(0, 4) };
      }
      return fixture;
    });
    const buffer = buildFixtureBuffer(
      (view, offsets) => {
        view.setInt32(offsets.get(10)! + 4, -1, true);
        view.setUint32(offsets.get(11)! + 4, 0xffff_ffff, true);
      },
      fixtures,
    );
    const manifest = {
      ...(await manifestFor(buffer)),
      snappedCommuneCount: 1,
      unroutableCommuneCount: 1,
    };

    const result = await loadRoadGraph({
      manifest,
      buffer,
      expectedDatasetVersion: "test-dataset",
      expectedDatasetSha256: DATASET_SHA,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.graph.connectors.get("00292")?.snapMeters).toBeNull();
    }
  });
});
