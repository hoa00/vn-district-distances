import type {
  CommuneCentroid,
  CoordinateRoadRouteResponse,
  Point,
  RoadGraphManifest,
  RoadRouteResponse,
  RoadRouteWarning,
} from "../contracts";
import {
  ROAD_GRAPH_FERRY_FLAG,
  type RoadGraph,
  type RoadGraphConnector,
  type RoadGraphProvider,
} from "../data/load-road-graph";
import {
  CommuneNotFoundError,
  OutsideRoadGraphCoverageError,
  RoadGraphUnavailableError,
} from "../domain/errors";
import { haversineKm, haversineMeters, roundDistanceKm } from "../domain/geo";
import {
  type E6Point,
  normalizeE6,
  type SnappedNode,
  snapNearestNode,
} from "./road-node-snapper";

const MAX_ROUTE_GEOMETRY_CHARACTERS = 96 * 1024;

export interface RouteCommuneRepository {
  readonly version: string;
  findById(id: string): CommuneCentroid | undefined;
}

export type { RoadGraphProvider } from "../data/load-road-graph";

export interface RouteServiceOptions {
  readonly searchNodeCap?: number;
  readonly fallbackFactor?: number;
  readonly longSnapMeters?: number;
}

export type RouteServiceResponse = RoadRouteResponse;

type SearchResult =
  | {
      readonly status: "found";
      readonly edgePath: readonly number[];
      readonly distanceMeters: number;
    }
  | { readonly status: "no-route" | "budget-exhausted" };

type RoutableRoadGraphConnector = RoadGraphConnector & {
  readonly snapMeters: number;
};

interface HeapEntry {
  readonly node: number;
  readonly score: number;
}

class MinHeap {
  readonly #entries: HeapEntry[] = [];

  get size(): number {
    return this.#entries.length;
  }

  push(entry: HeapEntry): void {
    const entries = this.#entries;
    entries.push(entry);
    let index = entries.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (entries[parent]!.score <= entry.score) {
        break;
      }
      entries[index] = entries[parent]!;
      index = parent;
    }
    entries[index] = entry;
  }

  pop(): HeapEntry | undefined {
    const entries = this.#entries;
    const first = entries[0];
    const last = entries.pop();
    if (first === undefined || last === undefined || entries.length === 0) {
      return first;
    }

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= entries.length) {
        break;
      }
      const right = left + 1;
      const child =
        right < entries.length &&
        entries[right]!.score < entries[left]!.score
          ? right
          : left;
      if (entries[child]!.score >= last.score) {
        break;
      }
      entries[index] = entries[child]!;
      index = child;
    }
    entries[index] = last;
    return first;
  }
}

function nodeDistanceMeters(
  graph: RoadGraph,
  originNode: number,
  destinationNode: number,
): number {
  return (
    haversineKm(
      {
        lat: graph.nodeLatE6[originNode]! / 1_000_000,
        lng: graph.nodeLngE6[originNode]! / 1_000_000,
      },
      {
        lat: graph.nodeLatE6[destinationNode]! / 1_000_000,
        lng: graph.nodeLngE6[destinationNode]! / 1_000_000,
      },
    ) * 1_000
  );
}

function decodeDeltaGeometry(
  deltas: Readonly<Int32Array>,
  start: number,
  end: number,
): E6Point[] {
  if (start === end) {
    return [];
  }
  const points: E6Point[] = [];
  let latitude = deltas[start * 2]!;
  let longitude = deltas[start * 2 + 1]!;
  points.push({ latE6: latitude, lngE6: longitude });
  for (let point = start + 1; point < end; point += 1) {
    latitude += deltas[point * 2]!;
    longitude += deltas[point * 2 + 1]!;
    points.push({ latE6: latitude, lngE6: longitude });
  }
  return points;
}

function samePoint(left: E6Point, right: E6Point): boolean {
  return left.latE6 === right.latE6 && left.lngE6 === right.lngE6;
}

function encodeSignedValue(value: number): string {
  let encoded = value < 0 ? ~(value << 1) : value << 1;
  let result = "";
  while (encoded >= 0x20) {
    result += String.fromCharCode((0x20 | (encoded & 0x1f)) + 63);
    encoded >>>= 5;
  }
  return result + String.fromCharCode(encoded + 63);
}

export function encodePolyline6(points: readonly E6Point[]): string {
  let previousLatitude = 0;
  let previousLongitude = 0;
  let result = "";
  for (const point of points) {
    result += encodeSignedValue(point.latE6 - previousLatitude);
    result += encodeSignedValue(point.lngE6 - previousLongitude);
    previousLatitude = point.latE6;
    previousLongitude = point.lngE6;
  }
  return result;
}

function centroidPoint(commune: CommuneCentroid): E6Point {
  return {
    latE6: Math.round(commune.latitude * 1_000_000),
    lngE6: Math.round(commune.longitude * 1_000_000),
  };
}

function decodedConnector(
  graph: RoadGraph,
  connector: RoadGraphConnector,
): E6Point[] {
  return decodeDeltaGeometry(
    graph.connectorGeometryDeltas,
    connector.geometryStart,
    connector.geometryEnd,
  );
}

function decodedEdge(graph: RoadGraph, edge: number): E6Point[] {
  return decodeDeltaGeometry(
    graph.edgeGeometryDeltas,
    graph.edgeGeometryOffsets[edge]!,
    graph.edgeGeometryOffsets[edge + 1]!,
  );
}

function isRoutableConnector(
  connector: RoadGraphConnector | undefined,
): connector is RoutableRoadGraphConnector {
  return connector !== undefined && connector.snapMeters !== null;
}

function snapDistanceKm(snapMeters: number | null | undefined): number | null {
  return snapMeters == null ? null : roundDistanceKm(snapMeters / 1_000);
}

function routeWarnings(
  graph: RoadGraph,
  originSnapMeters: number,
  destinationSnapMeters: number,
  edgePath: readonly number[],
  longSnapMeters: number,
): RoadRouteWarning[] {
  const warnings: RoadRouteWarning[] = ["coarse-road-network"];
  if (
    originSnapMeters > longSnapMeters ||
    destinationSnapMeters > longSnapMeters
  ) {
    warnings.push("long-road-snap");
  }
  if (
    edgePath.some(
      (edge) => (graph.edgeFlags[edge]! & ROAD_GRAPH_FERRY_FLAG) !== 0,
    )
  ) {
    warnings.push("uses-ferry");
  }
  return warnings;
}

// Connector đã decode về dạng trung tính cho shared kernel: node + snap + geometry points.
// Commune connector decode offset geometry; ephemeral connector (coordinate snap) dùng inline points.
interface ResolvedConnector {
  readonly node: number;
  readonly snapMeters: number;
  readonly geometry: readonly E6Point[];
}

// Endpoint cho shared kernel: điểm đầu vào E6 + connector đã resolve (undefined nếu no-connector).
interface ResolvedRouteEndpoint {
  readonly point: E6Point;
  readonly connector: ResolvedConnector | undefined;
}

// Kết quả định tuyến trung tính, chưa bao bọc thành response shape (commune hay point).
interface RouteOutcome {
  readonly calculationMethod: "coarse-road-graph" | "straight-line-fallback";
  readonly distanceMeters: number;
  readonly straightLineMeters: number;
  readonly encodedGeometry: string;
  readonly pointCount: number;
  readonly originSnapMeters: number | null;
  readonly destinationSnapMeters: number | null;
  readonly warnings: readonly RoadRouteWarning[];
}

function resolvedConnectorFromGraph(
  graph: RoadGraph,
  connector: RoutableRoadGraphConnector,
): ResolvedConnector {
  return {
    node: connector.node,
    snapMeters: connector.snapMeters,
    geometry: decodedConnector(graph, connector),
  };
}

// Ephemeral connector từ coordinate snap: geometry = [input point, snapped node point].
function ephemeralConnector(graph: RoadGraph, snap: SnappedNode): ResolvedConnector {
  return {
    node: snap.node,
    snapMeters: snap.snapMeters,
    geometry: [
      snap.point,
      {
        latE6: graph.nodeLatE6[snap.node]!,
        lngE6: graph.nodeLngE6[snap.node]!,
      },
    ],
  };
}

function toResolvedEndpoint(
  graph: RoadGraph,
  point: E6Point,
  connector: RoadGraphConnector | undefined,
): ResolvedRouteEndpoint {
  return isRoutableConnector(connector)
    ? { point, connector: resolvedConnectorFromGraph(graph, connector) }
    : { point, connector: undefined };
}

function e6ToPoint(point: E6Point): { latitude: number; longitude: number } {
  return { latitude: point.latE6 / 1_000_000, longitude: point.lngE6 / 1_000_000 };
}

// Bao bọc RouteOutcome thành CommuneId response (byte-compatible với behavior cũ).
function communeResponse(
  originCommuneId: string,
  destinationCommuneId: string,
  outcome: RouteOutcome,
  manifest: Readonly<RoadGraphManifest>,
  datasetVersion: string,
): RoadRouteResponse {
  return {
    originCommuneId,
    destinationCommuneId,
    distanceKm: roundDistanceKm(outcome.distanceMeters / 1_000),
    straightLineDistanceKm: roundDistanceKm(outcome.straightLineMeters / 1_000),
    unit: "km",
    approximate: true,
    calculationMethod: outcome.calculationMethod,
    datasetVersion,
    roadGraphVersion: manifest.graphVersion,
    osmAsOf: manifest.osmAsOf,
    route: {
      encoding: "polyline6",
      geometry: outcome.encodedGeometry,
      pointCount: outcome.pointCount,
    },
    snaps: {
      originDistanceKm: snapDistanceKm(outcome.originSnapMeters),
      destinationDistanceKm: snapDistanceKm(outcome.destinationSnapMeters),
    },
    warnings: outcome.warnings,
  };
}

// Bao bọc RouteOutcome thành coordinate response (originPoint/destinationPoint).
function coordinateResponse(
  originPoint: E6Point,
  destinationPoint: E6Point,
  outcome: RouteOutcome,
  manifest: Readonly<RoadGraphManifest>,
  datasetVersion: string,
): CoordinateRoadRouteResponse {
  return {
    originPoint: e6ToPoint(originPoint),
    destinationPoint: e6ToPoint(destinationPoint),
    distanceKm: roundDistanceKm(outcome.distanceMeters / 1_000),
    straightLineDistanceKm: roundDistanceKm(outcome.straightLineMeters / 1_000),
    unit: "km",
    approximate: true,
    calculationMethod: outcome.calculationMethod,
    datasetVersion,
    roadGraphVersion: manifest.graphVersion,
    osmAsOf: manifest.osmAsOf,
    route: {
      encoding: "polyline6",
      geometry: outcome.encodedGeometry,
      pointCount: outcome.pointCount,
    },
    snaps: {
      originDistanceKm: snapDistanceKm(outcome.originSnapMeters),
      destinationDistanceKm: snapDistanceKm(outcome.destinationSnapMeters),
    },
    warnings: outcome.warnings,
  };
}

export class RouteService {
  readonly #repository: RouteCommuneRepository;
  readonly #provider: RoadGraphProvider;
  readonly #searchNodeCap: number;
  readonly #fallbackFactor: number;
  readonly #longSnapMeters: number;
  #graph: RoadGraph | undefined;
  #generation = 0;
  #seen = new Uint32Array(0);
  #closed = new Uint32Array(0);
  #gScore = new Float64Array(0);
  #cameNode = new Int32Array(0);
  #cameEdge = new Int32Array(0);

  constructor(
    repository: RouteCommuneRepository,
    provider: RoadGraphProvider,
    options: RouteServiceOptions = {},
  ) {
    const searchNodeCap = options.searchNodeCap ?? 10_000;
    const fallbackFactor = options.fallbackFactor ?? 1.3;
    const longSnapMeters = options.longSnapMeters ?? 1_000;
    if (
      !Number.isSafeInteger(searchNodeCap) ||
      searchNodeCap <= 0 ||
      !Number.isFinite(fallbackFactor) ||
      fallbackFactor < 1 ||
      !Number.isFinite(longSnapMeters) ||
      longSnapMeters < 0
    ) {
      throw new RangeError("Invalid route service options.");
    }
    this.#repository = repository;
    this.#provider = provider;
    this.#searchNodeCap = searchNodeCap;
    this.#fallbackFactor = fallbackFactor;
    this.#longSnapMeters = longSnapMeters;
  }

  async calculate(
    originCommuneId: string,
    destinationCommuneId: string,
  ): Promise<RouteServiceResponse> {
    const origin = this.#repository.findById(originCommuneId);
    if (origin === undefined) {
      throw new CommuneNotFoundError([originCommuneId]);
    }
    if (originCommuneId === destinationCommuneId) {
      const geometryPoints = [centroidPoint(origin)] as const;
      return {
        originCommuneId,
        destinationCommuneId,
        distanceKm: 0,
        straightLineDistanceKm: 0,
        unit: "km",
        approximate: true,
        calculationMethod: "identity",
        datasetVersion: this.#repository.version,
        roadGraphVersion: this.#provider.manifest.graphVersion,
        osmAsOf: this.#provider.manifest.osmAsOf,
        route: {
          encoding: "polyline6",
          geometry: encodePolyline6(geometryPoints),
          pointCount: geometryPoints.length,
        },
        snaps: { originDistanceKm: 0, destinationDistanceKm: 0 },
        warnings: [],
      };
    }

    const destination = this.#repository.findById(destinationCommuneId);
    if (destination === undefined) {
      throw new CommuneNotFoundError([destinationCommuneId]);
    }
    const rawStraightLineMeters =
      haversineKm(
        { lat: origin.latitude, lng: origin.longitude },
        { lat: destination.latitude, lng: destination.longitude },
      ) * 1_000;
    const graph = await this.#loadGraph();
    const originEndpoint = toResolvedEndpoint(
      graph,
      centroidPoint(origin),
      graph.connectors.get(originCommuneId),
    );
    const destinationEndpoint = toResolvedEndpoint(
      graph,
      centroidPoint(destination),
      graph.connectors.get(destinationCommuneId),
    );
    const outcome = this.#resolveRoute(
      graph,
      originEndpoint,
      destinationEndpoint,
      rawStraightLineMeters,
    );
    return communeResponse(
      originCommuneId,
      destinationCommuneId,
      outcome,
      graph.manifest,
      this.#repository.version,
    );
  }

  // Coordinate route: chuẩn hóa E6, identity short-circuit (không tải graph), snap hai điểm,
  // rồi dùng cùng shared kernel. Ngoài coverage → OutsideRoadGraphCoverageError (→ 422).
  async calculatePoints(
    originLatitude: number,
    originLongitude: number,
    destinationLatitude: number,
    destinationLongitude: number,
  ): Promise<CoordinateRoadRouteResponse> {
    const originPoint = normalizeE6(originLatitude, originLongitude);
    const destinationPoint = normalizeE6(
      destinationLatitude,
      destinationLongitude,
    );
    if (samePoint(originPoint, destinationPoint)) {
      const geometry = encodePolyline6([originPoint]);
      return {
        originPoint: e6ToPoint(originPoint),
        destinationPoint: e6ToPoint(destinationPoint),
        distanceKm: 0,
        straightLineDistanceKm: 0,
        unit: "km",
        approximate: true,
        calculationMethod: "identity",
        datasetVersion: this.#repository.version,
        roadGraphVersion: this.#provider.manifest.graphVersion,
        osmAsOf: this.#provider.manifest.osmAsOf,
        route: { encoding: "polyline6", geometry, pointCount: 1 },
        snaps: { originDistanceKm: 0, destinationDistanceKm: 0 },
        warnings: [],
      };
    }

    const rawStraightLineMeters = haversineMeters(
      originPoint.latE6 / 1_000_000,
      originPoint.lngE6 / 1_000_000,
      destinationPoint.latE6 / 1_000_000,
      destinationPoint.lngE6 / 1_000_000,
    );
    const graph = await this.#loadGraph();
    const originSnap = snapNearestNode(graph, originPoint);
    const destinationSnap = snapNearestNode(graph, destinationPoint);
    if (
      originSnap.status === "outside-coverage" ||
      destinationSnap.status === "outside-coverage"
    ) {
      throw new OutsideRoadGraphCoverageError();
    }
    const originEndpoint: ResolvedRouteEndpoint =
      originSnap.status === "snapped"
        ? { point: originPoint, connector: ephemeralConnector(graph, originSnap.snap) }
        : { point: originPoint, connector: undefined };
    const destinationEndpoint: ResolvedRouteEndpoint =
      destinationSnap.status === "snapped"
        ? {
            point: destinationPoint,
            connector: ephemeralConnector(graph, destinationSnap.snap),
          }
        : { point: destinationPoint, connector: undefined };
    const outcome = this.#resolveRoute(
      graph,
      originEndpoint,
      destinationEndpoint,
      rawStraightLineMeters,
    );
    return coordinateResponse(
      originPoint,
      destinationPoint,
      outcome,
      graph.manifest,
      this.#repository.version,
    );
  }

  // Shared route kernel: connector → A* search → geometry/fallback. Trả RouteOutcome trung tính,
  // dùng chung cho cả CommuneId và coordinate endpoint (không duplicate A*/fallback).
  #resolveRoute(
    graph: RoadGraph,
    origin: ResolvedRouteEndpoint,
    destination: ResolvedRouteEndpoint,
    rawStraightLineMeters: number,
  ): RouteOutcome {
    if (origin.connector === undefined || destination.connector === undefined) {
      return this.#fallbackOutcome(
        origin.point,
        destination.point,
        rawStraightLineMeters,
        origin.connector,
        destination.connector,
        "no-road-connector",
      );
    }

    const search = this.#search(
      graph,
      origin.connector.node,
      destination.connector.node,
    );
    if (search.status !== "found") {
      return this.#fallbackOutcome(
        origin.point,
        destination.point,
        rawStraightLineMeters,
        origin.connector,
        destination.connector,
        search.status === "budget-exhausted"
          ? "search-budget-fallback"
          : "disconnected-road-graph",
      );
    }

    const encoded = this.#encodeRoute(
      graph,
      origin.connector,
      destination.connector,
      search.edgePath,
    );
    if (encoded === undefined) {
      // A* thành công nhưng output quá lớn: fallback minh bạch với warning riêng (không phải search-budget).
      return this.#fallbackOutcome(
        origin.point,
        destination.point,
        rawStraightLineMeters,
        origin.connector,
        destination.connector,
        "route-output-limit-fallback",
      );
    }

    const distanceMeters =
      origin.connector.snapMeters +
      search.distanceMeters +
      destination.connector.snapMeters;
    return {
      calculationMethod: "coarse-road-graph",
      distanceMeters,
      straightLineMeters: rawStraightLineMeters,
      encodedGeometry: encoded.geometry,
      pointCount: encoded.pointCount,
      originSnapMeters: origin.connector.snapMeters,
      destinationSnapMeters: destination.connector.snapMeters,
      warnings: routeWarnings(
        graph,
        origin.connector.snapMeters,
        destination.connector.snapMeters,
        search.edgePath,
        this.#longSnapMeters,
      ),
    };
  }

  // Polyline6 encoding budget-aware: encode tăng dần khi decode geometry, dedup điểm trùng liên tiếp
  // (giống routeGeometry cũ → byte-compatible) và abort ngay khi vượt cap, trước khi full allocate.
  #encodeRoute(
    graph: RoadGraph,
    origin: ResolvedConnector,
    destination: ResolvedConnector,
    edgePath: readonly number[],
  ): { readonly geometry: string; readonly pointCount: number } | undefined {
    let previousLatitude = 0;
    let previousLongitude = 0;
    let lastEmitted: E6Point | undefined;
    let pointCount = 0;
    let result = "";

    const emit = (points: readonly E6Point[]): boolean => {
      for (const point of points) {
        if (lastEmitted !== undefined && samePoint(lastEmitted, point)) {
          continue;
        }
        result += encodeSignedValue(point.latE6 - previousLatitude);
        result += encodeSignedValue(point.lngE6 - previousLongitude);
        previousLatitude = point.latE6;
        previousLongitude = point.lngE6;
        lastEmitted = point;
        pointCount += 1;
        if (result.length > MAX_ROUTE_GEOMETRY_CHARACTERS) {
          return false;
        }
      }
      return true;
    };

    if (!emit(origin.geometry)) {
      return undefined;
    }
    for (const edge of edgePath) {
      if (!emit(decodedEdge(graph, edge))) {
        return undefined;
      }
    }
    if (!emit([...destination.geometry].reverse())) {
      return undefined;
    }
    return { geometry: result, pointCount };
  }

  // Straight-line fallback trung tính: geometry = [originPoint, destinationPoint], distance = thẳng × factor.
  #fallbackOutcome(
    originPoint: E6Point,
    destinationPoint: E6Point,
    rawStraightLineMeters: number,
    originConnector: ResolvedConnector | undefined,
    destinationConnector: ResolvedConnector | undefined,
    warning: RoadRouteWarning,
  ): RouteOutcome {
    const geometryPoints = [originPoint, destinationPoint] as const;
    return {
      calculationMethod: "straight-line-fallback",
      distanceMeters: rawStraightLineMeters * this.#fallbackFactor,
      straightLineMeters: rawStraightLineMeters,
      encodedGeometry: encodePolyline6(geometryPoints),
      pointCount: geometryPoints.length,
      originSnapMeters: originConnector?.snapMeters ?? null,
      destinationSnapMeters: destinationConnector?.snapMeters ?? null,
      warnings: [warning],
    };
  }

  async #loadGraph(): Promise<RoadGraph> {
    try {
      const graph = this.#graph ?? (await this.#provider.get());
      if (graph.manifest.communeDatasetVersion !== this.#repository.version) {
        throw new RoadGraphUnavailableError();
      }
      this.#graph = graph;
      return graph;
    } catch {
      throw new RoadGraphUnavailableError();
    }
  }

  #prepareSearch(graph: RoadGraph): number {
    if (this.#seen.length !== graph.nodeLatE6.length) {
      this.#seen = new Uint32Array(graph.nodeLatE6.length);
      this.#closed = new Uint32Array(graph.nodeLatE6.length);
      this.#gScore = new Float64Array(graph.nodeLatE6.length);
      this.#cameNode = new Int32Array(graph.nodeLatE6.length);
      this.#cameEdge = new Int32Array(graph.nodeLatE6.length);
      this.#generation = 0;
    }
    this.#generation += 1;
    if (this.#generation === 0xffff_ffff) {
      this.#seen.fill(0);
      this.#closed.fill(0);
      this.#generation = 1;
    }
    return this.#generation;
  }

  #search(
    graph: RoadGraph,
    originNode: number,
    destinationNode: number,
  ): SearchResult {
    if (originNode === destinationNode) {
      return { status: "found", edgePath: [], distanceMeters: 0 };
    }

    const generation = this.#prepareSearch(graph);
    const heap = new MinHeap();
    this.#seen[originNode] = generation;
    this.#gScore[originNode] = 0;
    this.#cameNode[originNode] = -1;
    this.#cameEdge[originNode] = -1;
    heap.push({
      node: originNode,
      score: nodeDistanceMeters(graph, originNode, destinationNode),
    });
    let settled = 0;

    while (heap.size > 0) {
      const current = heap.pop()!;
      if (this.#closed[current.node] === generation) {
        continue;
      }
      this.#closed[current.node] = generation;
      settled += 1;
      if (settled > this.#searchNodeCap) {
        return { status: "budget-exhausted" };
      }
      if (current.node === destinationNode) {
        const edgePath: number[] = [];
        let node = destinationNode;
        while (node !== originNode) {
          const edge = this.#cameEdge[node]!;
          const previous = this.#cameNode[node]!;
          if (edge < 0 || previous < 0) {
            return { status: "no-route" };
          }
          edgePath.push(edge);
          node = previous;
        }
        edgePath.reverse();
        return {
          status: "found",
          edgePath,
          distanceMeters: this.#gScore[destinationNode]!,
        };
      }

      const start = graph.csrOffsets[current.node]!;
      const end = graph.csrOffsets[current.node + 1]!;
      for (let edge = start; edge < end; edge += 1) {
        const target = graph.edgeTargets[edge]!;
        if (this.#closed[target] === generation) {
          continue;
        }
        const tentative =
          this.#gScore[current.node]! + graph.edgeWeightsM[edge]!;
        if (
          this.#seen[target] !== generation ||
          tentative < this.#gScore[target]!
        ) {
          this.#seen[target] = generation;
          this.#gScore[target] = tentative;
          this.#cameNode[target] = current.node;
          this.#cameEdge[target] = edge;
          heap.push({
            node: target,
            score:
              tentative +
              nodeDistanceMeters(graph, target, destinationNode),
          });
        }
      }
    }
    return { status: "no-route" };
  }
}
