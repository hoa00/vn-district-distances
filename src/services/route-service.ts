import type {
  CommuneCentroid,
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
  RoadGraphUnavailableError,
} from "../domain/errors";
import { haversineKm, roundDistanceKm } from "../domain/geo";

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

interface E6Point {
  readonly latE6: number;
  readonly lngE6: number;
}

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

function appendPoints(target: E6Point[], source: readonly E6Point[]): void {
  for (const point of source) {
    if (target.length === 0 || !samePoint(target[target.length - 1]!, point)) {
      target.push(point);
    }
  }
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

function straightLinePoints(
  origin: CommuneCentroid,
  destination: CommuneCentroid,
): readonly E6Point[] {
  return [centroidPoint(origin), centroidPoint(destination)];
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

function routeGeometry(
  graph: RoadGraph,
  originConnector: RoutableRoadGraphConnector,
  destinationConnector: RoutableRoadGraphConnector,
  edgePath: readonly number[],
): E6Point[] {
  const points: E6Point[] = [];
  appendPoints(points, decodedConnector(graph, originConnector));
  for (const edge of edgePath) {
    appendPoints(points, decodedEdge(graph, edge));
  }
  appendPoints(
    points,
    decodedConnector(graph, destinationConnector).reverse(),
  );
  return points;
}

function routeWarnings(
  graph: RoadGraph,
  originConnector: RoutableRoadGraphConnector,
  destinationConnector: RoutableRoadGraphConnector,
  edgePath: readonly number[],
  longSnapMeters: number,
): RoadRouteWarning[] {
  const warnings: RoadRouteWarning[] = ["coarse-road-network"];
  if (
    originConnector.snapMeters > longSnapMeters ||
    destinationConnector.snapMeters > longSnapMeters
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
    const manifest = this.#provider.manifest;
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
        roadGraphVersion: manifest.graphVersion,
        osmAsOf: manifest.osmAsOf,
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
    const rawStraightLineDistanceKm = haversineKm(
      { lat: origin.latitude, lng: origin.longitude },
      { lat: destination.latitude, lng: destination.longitude },
    );
    const straightLineDistanceKm = roundDistanceKm(
      rawStraightLineDistanceKm,
    );
    const graph = await this.#loadGraph();
    const originConnector = graph.connectors.get(originCommuneId);
    const destinationConnector = graph.connectors.get(destinationCommuneId);

    if (
      !isRoutableConnector(originConnector) ||
      !isRoutableConnector(destinationConnector)
    ) {
      return this.#fallback(
        origin,
        destination,
        rawStraightLineDistanceKm,
        graph.manifest,
        originConnector,
        destinationConnector,
        "no-road-connector",
      );
    }

    const search = this.#search(
      graph,
      originConnector.node,
      destinationConnector.node,
    );
    if (search.status !== "found") {
      return this.#fallback(
        origin,
        destination,
        rawStraightLineDistanceKm,
        graph.manifest,
        originConnector,
        destinationConnector,
        search.status === "budget-exhausted"
          ? "search-budget-fallback"
          : "disconnected-road-graph",
      );
    }

    const geometryPoints = routeGeometry(
      graph,
      originConnector,
      destinationConnector,
      search.edgePath,
    );
    const encodedGeometry = encodePolyline6(geometryPoints);
    if (encodedGeometry.length > MAX_ROUTE_GEOMETRY_CHARACTERS) {
      return this.#fallback(
        origin,
        destination,
        rawStraightLineDistanceKm,
        graph.manifest,
        originConnector,
        destinationConnector,
        "search-budget-fallback",
      );
    }
    const distanceKm = roundDistanceKm(
      (originConnector.snapMeters +
        search.distanceMeters +
        destinationConnector.snapMeters) /
        1_000,
    );
    return {
      originCommuneId,
      destinationCommuneId,
      distanceKm,
      straightLineDistanceKm,
      unit: "km",
      approximate: true,
      calculationMethod: "coarse-road-graph",
      datasetVersion: this.#repository.version,
      roadGraphVersion: graph.manifest.graphVersion,
      osmAsOf: graph.manifest.osmAsOf,
      route: {
        encoding: "polyline6",
        geometry: encodedGeometry,
        pointCount: geometryPoints.length,
      },
      snaps: {
        originDistanceKm: snapDistanceKm(originConnector.snapMeters),
        destinationDistanceKm: snapDistanceKm(destinationConnector.snapMeters),
      },
      warnings: routeWarnings(
        graph,
        originConnector,
        destinationConnector,
        search.edgePath,
        this.#longSnapMeters,
      ),
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

  #fallback(
    origin: CommuneCentroid,
    destination: CommuneCentroid,
    rawStraightLineDistanceKm: number,
    manifest: Readonly<RoadGraphManifest>,
    originConnector: RoadGraphConnector | undefined,
    destinationConnector: RoadGraphConnector | undefined,
    warning: RoadRouteWarning,
  ): RouteServiceResponse {
    const geometryPoints = straightLinePoints(origin, destination);
    return {
      originCommuneId: origin.id,
      destinationCommuneId: destination.id,
      distanceKm: roundDistanceKm(
        rawStraightLineDistanceKm * this.#fallbackFactor,
      ),
      straightLineDistanceKm: roundDistanceKm(rawStraightLineDistanceKm),
      unit: "km",
      approximate: true,
      calculationMethod: "straight-line-fallback",
      datasetVersion: this.#repository.version,
      roadGraphVersion: manifest.graphVersion,
      osmAsOf: manifest.osmAsOf,
      route: {
        encoding: "polyline6",
        geometry: encodePolyline6(geometryPoints),
        pointCount: geometryPoints.length,
      },
      snaps: {
        originDistanceKm: snapDistanceKm(originConnector?.snapMeters),
        destinationDistanceKm: snapDistanceKm(destinationConnector?.snapMeters),
      },
      warnings: [warning],
    };
  }
}
