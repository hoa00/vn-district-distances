export const COMMUNE_ID_PATTERN = /^\d{5}$/;

export function isCommuneId(value: string): boolean {
  return COMMUNE_ID_PATTERN.test(value);
}

export const ERROR_CODES = [
  "INVALID_REQUEST",
  "COMMUNE_NOT_FOUND",
  "DATASET_UNAVAILABLE",
  "ROAD_GRAPH_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const DISTANCE_LOOKUP_TRUTH_TABLE = [
  { scenario: "malformed", status: 400, errorCode: "INVALID_REQUEST" },
  { scenario: "known-same", status: 200, distanceKm: 0 },
  { scenario: "unknown-same", status: 404, errorCode: "COMMUNE_NOT_FOUND" },
  { scenario: "origin-missing", status: 404, errorCode: "COMMUNE_NOT_FOUND" },
  {
    scenario: "destination-missing",
    status: 404,
    errorCode: "COMMUNE_NOT_FOUND",
  },
  { scenario: "both-missing", status: 404, errorCode: "COMMUNE_NOT_FOUND" },
  {
    scenario: "dataset-unavailable",
    status: 503,
    errorCode: "DATASET_UNAVAILABLE",
  },
] as const;

export type CommuneType = "xa" | "phuong" | "dac-khu";

export interface Point {
  readonly lat: number;
  readonly lng: number;
}

export interface CommuneCentroid {
  readonly id: string;
  readonly name: string;
  readonly type: CommuneType;
  readonly provinceId: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly centroidOutsideGeometry: boolean;
}

export type DatasetInputRole =
  | "commune-catalog"
  | "province-catalog"
  | "geometry";

export interface DatasetInput {
  readonly role: DatasetInputRole;
  readonly sourceUrl: string;
  readonly archivePath: string;
  readonly effectiveAt: string;
  readonly retrievedAt: string;
  readonly sha256: string;
  readonly attribution: string;
  readonly licenseUrl: string;
  readonly shareAlikeNotice: string;
  readonly derivedDatabaseNotice: string;
}

export interface DatasetManifest {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly asOf: string;
  readonly generatedAt: string;
  readonly recordCount: number;
  readonly inputs: readonly DatasetInput[];
  readonly runtimeDatasetSha256: string;
}

export interface RuntimeDataset {
  readonly manifest: DatasetManifest;
  readonly records: readonly CommuneCentroid[];
}

export interface DistanceResponse {
  readonly originCommuneId: string;
  readonly destinationCommuneId: string;
  readonly distanceKm: number;
  readonly unit: "km";
  readonly datasetVersion: string;
}

export const ROAD_ROUTE_WARNINGS = [
  "coarse-road-network",
  "long-road-snap",
  "uses-ferry",
  "no-road-connector",
  "disconnected-road-graph",
  "search-budget-fallback",
] as const;

export type RoadRouteWarning = (typeof ROAD_ROUTE_WARNINGS)[number];

export type RoadRouteCalculationMethod =
  | "identity"
  | "coarse-road-graph"
  | "straight-line-fallback";

export interface RoadRouteResponse {
  readonly originCommuneId: string;
  readonly destinationCommuneId: string;
  readonly distanceKm: number;
  readonly straightLineDistanceKm: number;
  readonly unit: "km";
  readonly approximate: true;
  readonly calculationMethod: RoadRouteCalculationMethod;
  readonly datasetVersion: string;
  readonly roadGraphVersion: string;
  readonly osmAsOf: string;
  readonly route: {
    readonly encoding: "polyline6";
    readonly geometry: string;
    readonly pointCount: number;
  };
  readonly snaps: {
    readonly originDistanceKm: number | null;
    readonly destinationDistanceKm: number | null;
  };
  readonly warnings: readonly RoadRouteWarning[];
}

export interface RoadGraphManifest {
  readonly schemaVersion: 1;
  readonly graphVersion: string;
  readonly communeDatasetVersion: string;
  readonly communeDatasetSha256: string;
  readonly osmAsOf: string;
  readonly osmSourceSha256: string;
  readonly routingProfileHash: string;
  readonly assetPath: string;
  readonly assetSha256: string;
  readonly sizeBytes: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly snappedCommuneCount: number;
  readonly unroutableCommuneCount: number;
  readonly attribution: string;
  readonly licenseUrl: string;
  readonly shareAlikeNotice: string;
}

export type RoadGraphHealthResponse =
  | {
      readonly status: "ready";
      readonly roadGraph: {
        readonly loaded: true;
        readonly version: string;
        readonly nodeCount: number;
        readonly edgeCount: number;
      };
    }
  | {
      readonly status: "degraded";
      readonly roadGraph: {
        readonly loaded: false;
      };
    };

export type RoadGraphMetadataResponse = RoadGraphManifest;

export interface ErrorResponse {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly details?: Readonly<Record<string, unknown>>;
  };
}

export interface HealthResponse {
  readonly status: "ready" | "degraded";
  readonly dataset:
    | {
        readonly loaded: true;
        readonly version: string;
        readonly recordCount: number;
      }
    | {
        readonly loaded: false;
      };
}

export interface VersionResponse {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly asOf: string;
  readonly recordCount: number;
  readonly runtimeDatasetSha256: string;
  readonly inputs: readonly Pick<
    DatasetInput,
    | "role"
    | "sourceUrl"
    | "effectiveAt"
    | "sha256"
    | "attribution"
    | "licenseUrl"
    | "shareAlikeNotice"
    | "derivedDatabaseNotice"
  >[];
}
