import { z } from "@hono/zod-openapi";

export const errorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "COMMUNE_NOT_FOUND",
  "DATASET_UNAVAILABLE",
  "ROAD_GRAPH_UNAVAILABLE",
  "OUTSIDE_ROAD_GRAPH_COVERAGE",
  "INTERNAL_ERROR",
]);

export const errorResponseSchema = z
  .object({
    error: z.object({
      code: errorCodeSchema,
      message: z.string(),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
  })
  .openapi("ErrorResponse");

export const distanceQuerySchema = z.object({
  originCommuneId: z
    .string()
    .regex(/^\d{5}$/)
    .openapi({ example: "00004" }),
  destinationCommuneId: z
    .string()
    .regex(/^\d{5}$/)
    .openapi({ example: "00292" }),
});

export const distanceResponseSchema = z
  .object({
    originCommuneId: z.string().regex(/^\d{5}$/),
    destinationCommuneId: z.string().regex(/^\d{5}$/),
    distanceKm: z.number().nonnegative(),
    unit: z.literal("km"),
    datasetVersion: z.string(),
  })
  .openapi("DistanceResponse");

export const roadRouteQuerySchema = distanceQuerySchema;

export const roadRouteWarningSchema = z.enum([
  "coarse-road-network",
  "long-road-snap",
  "uses-ferry",
  "no-road-connector",
  "disconnected-road-graph",
  "search-budget-fallback",
  "route-output-limit-fallback",
]);

export const roadRouteResponseSchema = z
  .object({
    originCommuneId: z.string().regex(/^\d{5}$/),
    destinationCommuneId: z.string().regex(/^\d{5}$/),
    distanceKm: z.number().nonnegative(),
    straightLineDistanceKm: z.number().nonnegative(),
    unit: z.literal("km"),
    approximate: z.literal(true),
    calculationMethod: z.enum([
      "identity",
      "coarse-road-graph",
      "straight-line-fallback",
    ]),
    datasetVersion: z.string(),
    roadGraphVersion: z.string(),
    osmAsOf: z.string(),
    route: z.object({
      encoding: z.literal("polyline6"),
      geometry: z.string(),
      pointCount: z.number().int().positive(),
    }),
    snaps: z.object({
      originDistanceKm: z.number().nonnegative().nullable(),
      destinationDistanceKm: z.number().nonnegative().nullable(),
    }),
    warnings: z.array(roadRouteWarningSchema).readonly(),
  })
  .openapi("RoadRouteResponse");

// Query coordinate: chuỗi → trim → reject rỗng → coerce number → reject NaN/Infinity.
const finiteCoordinate = z
  .string()
  .trim()
  .min(1, "Coordinate must not be empty.")
  .pipe(z.coerce.number())
  .refine(
    (value) => Number.isFinite(value),
    "Coordinate must be a finite number.",
  );

const latitudeParam = finiteCoordinate.refine(
  (value) => value >= -90 && value <= 90,
  "Latitude must be within [-90, 90].",
);
const longitudeParam = finiteCoordinate.refine(
  (value) => value >= -180 && value <= 180,
  "Longitude must be within [-180, 180].",
);

export const coordinateRoadRouteQuerySchema = z.object({
  originLat: latitudeParam.openapi({ example: "21.028511" }),
  originLng: longitudeParam.openapi({ example: "105.804817" }),
  destinationLat: latitudeParam.openapi({ example: "20.995138" }),
  destinationLng: longitudeParam.openapi({ example: "105.866216" }),
});

const routePointSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .openapi("RoutePoint");

export const coordinateRoadRouteResponseSchema = z
  .object({
    originPoint: routePointSchema,
    destinationPoint: routePointSchema,
    distanceKm: z.number().nonnegative(),
    straightLineDistanceKm: z.number().nonnegative(),
    unit: z.literal("km"),
    approximate: z.literal(true),
    calculationMethod: z.enum([
      "identity",
      "coarse-road-graph",
      "straight-line-fallback",
    ]),
    datasetVersion: z.string(),
    roadGraphVersion: z.string(),
    osmAsOf: z.string(),
    route: z.object({
      encoding: z.literal("polyline6"),
      geometry: z.string(),
      pointCount: z.number().int().positive(),
    }),
    snaps: z.object({
      originDistanceKm: z.number().nonnegative().nullable(),
      destinationDistanceKm: z.number().nonnegative().nullable(),
    }),
    warnings: z.array(roadRouteWarningSchema).readonly(),
  })
  .openapi("CoordinateRoadRouteResponse");

export const roadGraphHealthResponseSchema = z
  .discriminatedUnion("status", [
    z.object({
      status: z.literal("ready"),
      roadGraph: z.object({
        loaded: z.literal(true),
        version: z.string(),
        nodeCount: z.number().int().nonnegative(),
        edgeCount: z.number().int().nonnegative(),
      }),
    }),
    z.object({
      status: z.literal("degraded"),
      roadGraph: z.object({ loaded: z.literal(false) }),
    }),
  ])
  .openapi("RoadGraphHealthResponse");

export const roadGraphMetadataResponseSchema = z
  .object({
    schemaVersion: z.literal(2),
    graphVersion: z.string(),
    communeDatasetVersion: z.string(),
    communeDatasetSha256: z.string(),
    osmAsOf: z.string(),
    osmSourceSha256: z.string(),
    routingProfileHash: z.string(),
    assetPath: z.string(),
    assetSha256: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    nodeCount: z.number().int().nonnegative(),
    edgeCount: z.number().int().nonnegative(),
    snappedCommuneCount: z.number().int().nonnegative(),
    unroutableCommuneCount: z.number().int().nonnegative(),
    spatialCellSizeDegrees: z.number().positive(),
    spatialCellCount: z.number().int().positive(),
    spatialIndexNodeCount: z.number().int().nonnegative(),
    snapMaximumMeters: z.number().int().positive(),
    minimumLatitude: z.number().min(-90).max(90),
    maximumLatitude: z.number().min(-90).max(90),
    minimumLongitude: z.number().min(-180).max(180),
    maximumLongitude: z.number().min(-180).max(180),
    attribution: z.string(),
    licenseUrl: z.url(),
    shareAlikeNotice: z.string(),
  })
  .openapi("RoadGraphMetadataResponse");

export const healthResponseSchema = z
  .discriminatedUnion("status", [
    z.object({
      status: z.literal("ready"),
      dataset: z.object({
        loaded: z.literal(true),
        version: z.string(),
        recordCount: z.number().int().nonnegative(),
      }),
    }),
    z.object({
      status: z.literal("degraded"),
      dataset: z.object({ loaded: z.literal(false) }),
    }),
  ])
  .openapi("HealthResponse");

const metadataInputSchema = z.object({
  role: z.enum(["commune-catalog", "province-catalog", "geometry"]),
  sourceUrl: z.url(),
  effectiveAt: z.string(),
  sha256: z.string(),
  attribution: z.string(),
  licenseUrl: z.url(),
  shareAlikeNotice: z.string(),
  derivedDatabaseNotice: z.string(),
});

export const versionResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z.string(),
    asOf: z.string(),
    recordCount: z.number().int().nonnegative(),
    runtimeDatasetSha256: z.string(),
    inputs: z.array(metadataInputSchema),
  })
  .openapi("VersionResponse");
