import { z } from "@hono/zod-openapi";

export const errorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "COMMUNE_NOT_FOUND",
  "DATASET_UNAVAILABLE",
  "ROAD_GRAPH_UNAVAILABLE",
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
    schemaVersion: z.literal(1),
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
