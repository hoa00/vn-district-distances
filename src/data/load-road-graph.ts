import type { RoadGraphManifest } from "../contracts";

export const ROAD_GRAPH_MAGIC = "VNRG";
export const ROAD_GRAPH_SCHEMA_VERSION = 1;
export const ROAD_GRAPH_HEADER_BYTES = 32;
export const ROAD_GRAPH_DIRECTORY_ENTRY_BYTES = 16;
export const ROAD_GRAPH_SECTION_COUNT = 13;
export const ROAD_GRAPH_DATA_OFFSET = 240;
export const ROAD_GRAPH_FERRY_FLAG = 1;
export const ROAD_GRAPH_UNROUTABLE_NODE = -1;
export const ROAD_GRAPH_UNROUTABLE_SNAP_METERS = 0xffff_ffff;

export const ROAD_GRAPH_SECTION = Object.freeze({
  NODE_LAT_E6: 1,
  NODE_LNG_E6: 2,
  CSR_OFFSETS: 3,
  EDGE_TARGETS: 4,
  EDGE_WEIGHTS_M: 5,
  EDGE_FLAGS: 6,
  EDGE_GEOMETRY_OFFSETS: 7,
  EDGE_GEOMETRY_DELTAS: 8,
  CONNECTOR_COMMUNE_IDS: 9,
  CONNECTOR_NODES: 10,
  CONNECTOR_SNAP_M: 11,
  CONNECTOR_GEOMETRY_OFFSETS: 12,
  CONNECTOR_GEOMETRY_DELTAS: 13,
} as const);

type RoadGraphSectionId =
  (typeof ROAD_GRAPH_SECTION)[keyof typeof ROAD_GRAPH_SECTION];

interface SectionDescriptor {
  readonly id: RoadGraphSectionId;
  readonly elementWidth: 1 | 4;
  readonly offset: number;
  readonly byteLength: number;
  readonly elementCount: number;
}

export interface RoadGraphConnector {
  readonly index: number;
  readonly node: number;
  readonly snapMeters: number | null;
  readonly geometryStart: number;
  readonly geometryEnd: number;
}

export interface RoadGraph {
  readonly manifest: Readonly<RoadGraphManifest>;
  readonly nodeLatE6: Readonly<Int32Array>;
  readonly nodeLngE6: Readonly<Int32Array>;
  readonly csrOffsets: Readonly<Uint32Array>;
  readonly edgeTargets: Readonly<Uint32Array>;
  readonly edgeWeightsM: Readonly<Uint32Array>;
  readonly edgeFlags: Readonly<Uint8Array>;
  readonly edgeGeometryOffsets: Readonly<Uint32Array>;
  readonly edgeGeometryDeltas: Readonly<Int32Array>;
  readonly connectorGeometryDeltas: Readonly<Int32Array>;
  readonly connectors: ReadonlyMap<string, RoadGraphConnector>;
}

export interface RoadGraphProvider {
  readonly manifest: Readonly<RoadGraphManifest>;
  get(): Promise<RoadGraph>;
}

export interface LoadRoadGraphInput {
  readonly manifest: RoadGraphManifest;
  readonly buffer: ArrayBuffer;
  readonly expectedDatasetVersion: string;
  readonly expectedDatasetSha256: string;
}

export class RoadGraphLoadError extends Error {
  constructor() {
    super("The static road graph could not be validated.");
    this.name = "RoadGraphLoadError";
  }
}

export type RoadGraphInitialization =
  | { readonly ok: true; readonly graph: RoadGraph }
  | { readonly ok: false; readonly error: RoadGraphLoadError };

const EXPECTED_WIDTHS: Readonly<Record<RoadGraphSectionId, 1 | 4>> =
  Object.freeze({
    [ROAD_GRAPH_SECTION.NODE_LAT_E6]: 4,
    [ROAD_GRAPH_SECTION.NODE_LNG_E6]: 4,
    [ROAD_GRAPH_SECTION.CSR_OFFSETS]: 4,
    [ROAD_GRAPH_SECTION.EDGE_TARGETS]: 4,
    [ROAD_GRAPH_SECTION.EDGE_WEIGHTS_M]: 4,
    [ROAD_GRAPH_SECTION.EDGE_FLAGS]: 1,
    [ROAD_GRAPH_SECTION.EDGE_GEOMETRY_OFFSETS]: 4,
    [ROAD_GRAPH_SECTION.EDGE_GEOMETRY_DELTAS]: 4,
    [ROAD_GRAPH_SECTION.CONNECTOR_COMMUNE_IDS]: 4,
    [ROAD_GRAPH_SECTION.CONNECTOR_NODES]: 4,
    [ROAD_GRAPH_SECTION.CONNECTOR_SNAP_M]: 4,
    [ROAD_GRAPH_SECTION.CONNECTOR_GEOMETRY_OFFSETS]: 4,
    [ROAD_GRAPH_SECTION.CONNECTOR_GEOMETRY_DELTAS]: 4,
  });

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function validateManifest(
  manifest: RoadGraphManifest,
  expectedDatasetVersion: string,
  expectedDatasetSha256: string,
  byteLength: number,
): void {
  if (
    manifest.schemaVersion !== ROAD_GRAPH_SCHEMA_VERSION ||
    manifest.graphVersion.trim().length === 0 ||
    manifest.communeDatasetVersion !== expectedDatasetVersion ||
    manifest.communeDatasetSha256 !== expectedDatasetSha256 ||
    !isSha256(manifest.communeDatasetSha256) ||
    !isSha256(manifest.osmSourceSha256) ||
    !isSha256(manifest.routingProfileHash) ||
    !isSha256(manifest.assetSha256) ||
    manifest.osmAsOf.trim().length === 0 ||
    manifest.assetPath.trim().length === 0 ||
    manifest.sizeBytes !== byteLength ||
    !Number.isSafeInteger(manifest.nodeCount) ||
    manifest.nodeCount <= 0 ||
    !Number.isSafeInteger(manifest.edgeCount) ||
    manifest.edgeCount <= 0 ||
    !Number.isSafeInteger(manifest.snappedCommuneCount) ||
    manifest.snappedCommuneCount < 0 ||
    !Number.isSafeInteger(manifest.unroutableCommuneCount) ||
    manifest.unroutableCommuneCount < 0 ||
    manifest.attribution.trim().length === 0 ||
    manifest.licenseUrl.trim().length === 0 ||
    manifest.shareAlikeNotice.trim().length === 0
  ) {
    throw new RoadGraphLoadError();
  }
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function parseSections(
  buffer: ArrayBuffer,
  nodeCount: number,
  edgeCount: number,
  connectorCount: number,
): ReadonlyMap<RoadGraphSectionId, SectionDescriptor> {
  const view = new DataView(buffer);
  if (
    String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== ROAD_GRAPH_MAGIC ||
    view.getUint16(4, true) !== ROAD_GRAPH_SCHEMA_VERSION ||
    view.getUint16(6, true) !== ROAD_GRAPH_SECTION_COUNT ||
    view.getUint32(8, true) !== ROAD_GRAPH_DATA_OFFSET ||
    view.getUint32(12, true) !== nodeCount ||
    view.getUint32(16, true) !== edgeCount ||
    view.getUint32(20, true) !== connectorCount ||
    view.getUint32(24, true) !== 0 ||
    view.getUint32(28, true) !== 0
  ) {
    throw new RoadGraphLoadError();
  }

  const sections = new Map<RoadGraphSectionId, SectionDescriptor>();
  const intervals: Array<readonly [number, number]> = [];
  for (let index = 0; index < ROAD_GRAPH_SECTION_COUNT; index += 1) {
    const directoryOffset =
      ROAD_GRAPH_HEADER_BYTES + index * ROAD_GRAPH_DIRECTORY_ENTRY_BYTES;
    const id = view.getUint16(directoryOffset, true) as RoadGraphSectionId;
    const elementWidth = view.getUint8(directoryOffset + 2) as 1 | 4;
    const flags = view.getUint8(directoryOffset + 3);
    const offset = view.getUint32(directoryOffset + 4, true);
    const byteLength = view.getUint32(directoryOffset + 8, true);
    const elementCount = view.getUint32(directoryOffset + 12, true);
    const expectedId = (index + 1) as RoadGraphSectionId;

    if (
      id !== expectedId ||
      elementWidth !== EXPECTED_WIDTHS[id] ||
      flags !== 0 ||
      offset < ROAD_GRAPH_DATA_OFFSET ||
      offset % Math.max(8, elementWidth) !== 0 ||
      byteLength !== elementWidth * elementCount ||
      offset + byteLength > buffer.byteLength ||
      sections.has(id)
    ) {
      throw new RoadGraphLoadError();
    }

    sections.set(
      id,
      Object.freeze({ id, elementWidth, offset, byteLength, elementCount }),
    );
    intervals.push([offset, offset + byteLength]);
  }

  intervals.sort((left, right) => left[0] - right[0]);
  for (let index = 1; index < intervals.length; index += 1) {
    if (intervals[index]![0] < intervals[index - 1]![1]) {
      throw new RoadGraphLoadError();
    }
  }

  return sections;
}

function section(
  sections: ReadonlyMap<RoadGraphSectionId, SectionDescriptor>,
  id: RoadGraphSectionId,
): SectionDescriptor {
  const descriptor = sections.get(id);
  if (descriptor === undefined) {
    throw new RoadGraphLoadError();
  }
  return descriptor;
}

function int32View(
  buffer: ArrayBuffer,
  descriptor: SectionDescriptor,
): Int32Array {
  return new Int32Array(
    buffer,
    descriptor.offset,
    descriptor.elementCount,
  );
}

function uint32View(
  buffer: ArrayBuffer,
  descriptor: SectionDescriptor,
): Uint32Array {
  return new Uint32Array(
    buffer,
    descriptor.offset,
    descriptor.elementCount,
  );
}

function uint8View(
  buffer: ArrayBuffer,
  descriptor: SectionDescriptor,
): Uint8Array {
  return new Uint8Array(
    buffer,
    descriptor.offset,
    descriptor.elementCount,
  );
}

function validateOffsets(
  offsets: Readonly<Uint32Array>,
  expectedLength: number,
  expectedLast: number,
): void {
  if (
    offsets.length !== expectedLength ||
    offsets[0] !== 0 ||
    offsets[offsets.length - 1] !== expectedLast
  ) {
    throw new RoadGraphLoadError();
  }
}

function validateGeometry(
  offsets: Readonly<Uint32Array>,
  deltas: Readonly<Int32Array>,
  allowEmpty: boolean,
): void {
  validateOffsets(offsets, offsets.length, deltas.length / 2);
  if (deltas.length % 2 !== 0) {
    throw new RoadGraphLoadError();
  }

  if (!allowEmpty && offsets.length <= 1) {
    throw new RoadGraphLoadError();
  }
}

function buildGraph(
  manifest: RoadGraphManifest,
  sourceBuffer: ArrayBuffer,
): RoadGraph {
  const buffer = structuredClone(sourceBuffer, {
    transfer: [sourceBuffer],
  });
  const connectorCount =
    manifest.snappedCommuneCount + manifest.unroutableCommuneCount;
  const sections = parseSections(
    buffer,
    manifest.nodeCount,
    manifest.edgeCount,
    connectorCount,
  );

  const nodeLatE6 = int32View(
    buffer,
    section(sections, ROAD_GRAPH_SECTION.NODE_LAT_E6),
  );
  const nodeLngE6 = int32View(
    buffer,
    section(sections, ROAD_GRAPH_SECTION.NODE_LNG_E6),
  );
  const csrOffsets = uint32View(
    buffer,
    section(sections, ROAD_GRAPH_SECTION.CSR_OFFSETS),
  );
  const edgeTargets = uint32View(
    buffer,
    section(sections, ROAD_GRAPH_SECTION.EDGE_TARGETS),
  );
  const edgeWeightsM = uint32View(
    buffer,
    section(sections, ROAD_GRAPH_SECTION.EDGE_WEIGHTS_M),
  );
  const edgeFlags = uint8View(
    buffer,
    section(sections, ROAD_GRAPH_SECTION.EDGE_FLAGS),
  );
  const edgeGeometryOffsets = uint32View(
    buffer,
    section(sections, ROAD_GRAPH_SECTION.EDGE_GEOMETRY_OFFSETS),
  );
  const edgeGeometryDeltas = int32View(
    buffer,
    section(sections, ROAD_GRAPH_SECTION.EDGE_GEOMETRY_DELTAS),
  );
  const connectorIds = uint32View(
    buffer,
    section(sections, ROAD_GRAPH_SECTION.CONNECTOR_COMMUNE_IDS),
  );
  const connectorNodes = int32View(
    buffer,
    section(sections, ROAD_GRAPH_SECTION.CONNECTOR_NODES),
  );
  const connectorSnapMeters = uint32View(
    buffer,
    section(sections, ROAD_GRAPH_SECTION.CONNECTOR_SNAP_M),
  );
  const connectorGeometryOffsets = uint32View(
    buffer,
    section(sections, ROAD_GRAPH_SECTION.CONNECTOR_GEOMETRY_OFFSETS),
  );
  const connectorGeometryDeltas = int32View(
    buffer,
    section(sections, ROAD_GRAPH_SECTION.CONNECTOR_GEOMETRY_DELTAS),
  );

  if (
    nodeLatE6.length !== manifest.nodeCount ||
    nodeLngE6.length !== manifest.nodeCount ||
    edgeTargets.length !== manifest.edgeCount ||
    edgeWeightsM.length !== manifest.edgeCount ||
    edgeFlags.length !== manifest.edgeCount ||
    connectorIds.length !== connectorCount ||
    connectorNodes.length !== connectorCount ||
    connectorSnapMeters.length !== connectorCount
  ) {
    throw new RoadGraphLoadError();
  }

  validateOffsets(csrOffsets, manifest.nodeCount + 1, manifest.edgeCount);
  validateGeometry(
    edgeGeometryOffsets,
    edgeGeometryDeltas,
    false,
  );
  if (edgeGeometryOffsets.length !== manifest.edgeCount + 1) {
    throw new RoadGraphLoadError();
  }
  validateGeometry(
    connectorGeometryOffsets,
    connectorGeometryDeltas,
    true,
  );
  if (connectorGeometryOffsets.length !== connectorCount + 1) {
    throw new RoadGraphLoadError();
  }

  const connectors = new Map<string, RoadGraphConnector>();
  let snappedCount = 0;
  for (let index = 0; index < connectorCount; index += 1) {
    const numericId = connectorIds[index]!;
    const communeId = numericId.toString().padStart(5, "0");
    const node = connectorNodes[index]!;
    const snapMeters = connectorSnapMeters[index]!;
    const geometryStart = connectorGeometryOffsets[index]!;
    const geometryEnd = connectorGeometryOffsets[index + 1]!;
    const isUnroutable =
      node === ROAD_GRAPH_UNROUTABLE_NODE &&
      snapMeters === ROAD_GRAPH_UNROUTABLE_SNAP_METERS;
    const isSnapped =
      node >= 0 &&
      node < manifest.nodeCount &&
      snapMeters !== ROAD_GRAPH_UNROUTABLE_SNAP_METERS &&
      geometryEnd - geometryStart >= 2;

    if (
      numericId > 99_999 ||
      connectors.has(communeId) ||
      (!isUnroutable && !isSnapped) ||
      (isUnroutable && geometryStart !== geometryEnd)
    ) {
      throw new RoadGraphLoadError();
    }
    if (isSnapped) {
      snappedCount += 1;
    }
    connectors.set(
      communeId,
      Object.freeze({
        index,
        node,
        snapMeters: isUnroutable ? null : snapMeters,
        geometryStart,
        geometryEnd,
      }),
    );
  }
  if (snappedCount !== manifest.snappedCommuneCount) {
    throw new RoadGraphLoadError();
  }

  return Object.freeze({
    manifest: Object.freeze({ ...manifest }),
    nodeLatE6,
    nodeLngE6,
    csrOffsets,
    edgeTargets,
    edgeWeightsM,
    edgeFlags,
    edgeGeometryOffsets,
    edgeGeometryDeltas,
    connectorGeometryDeltas,
    connectors,
  });
}

export async function loadRoadGraph(
  input: LoadRoadGraphInput,
): Promise<RoadGraphInitialization> {
  try {
    validateManifest(
      input.manifest,
      input.expectedDatasetVersion,
      input.expectedDatasetSha256,
      input.buffer.byteLength,
    );
    if ((await sha256Hex(input.buffer)) !== input.manifest.assetSha256) {
      throw new RoadGraphLoadError();
    }
    return { ok: true, graph: buildGraph(input.manifest, input.buffer) };
  } catch {
    return { ok: false, error: new RoadGraphLoadError() };
  }
}
