import { z } from "@hono/zod-openapi";

export const errorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "COMMUNE_NOT_FOUND",
  "DATASET_UNAVAILABLE",
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
