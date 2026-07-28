import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";

import type { ErrorCode, ErrorResponse } from "./contracts";
import type { RuntimeDatasetInitialization } from "./data/load-runtime-dataset";
import { CommuneNotFoundError } from "./domain/errors";
import {
  distanceQuerySchema,
  distanceResponseSchema,
  errorResponseSchema,
  healthResponseSchema,
  versionResponseSchema,
} from "./schemas/api";
import { DistanceService } from "./services/distance-service";

const jsonContent = <Schema>(schema: Schema, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

const distanceRoute = createRoute({
  method: "get",
  path: "/api/v1/distances",
  operationId: "getCommuneDistance",
  request: { query: distanceQuerySchema },
  responses: {
    200: jsonContent(distanceResponseSchema, "Centroid-to-centroid distance"),
    400: jsonContent(errorResponseSchema, "Invalid request"),
    404: jsonContent(errorResponseSchema, "Commune not found"),
    500: jsonContent(errorResponseSchema, "Unexpected error"),
    503: jsonContent(errorResponseSchema, "Dataset unavailable"),
  },
});

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  operationId: "getHealth",
  responses: {
    200: jsonContent(healthResponseSchema, "Dataset ready"),
    503: jsonContent(healthResponseSchema, "Dataset degraded"),
  },
});

const versionRoute = createRoute({
  method: "get",
  path: "/meta/version",
  operationId: "getDatasetVersion",
  responses: {
    200: jsonContent(versionResponseSchema, "Safe dataset metadata"),
    503: jsonContent(errorResponseSchema, "Dataset unavailable"),
  },
});

function errorBody(code: ErrorCode, message: string): ErrorResponse {
  return { error: { code, message } };
}

export interface AppOverrides {
  readonly distanceService?: Pick<DistanceService, "calculate">;
}

export function createApp(
  initialization: RuntimeDatasetInitialization,
  overrides?: AppOverrides,
) {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          errorBody(
            "INVALID_REQUEST",
            "Both commune identifiers must contain exactly five digits.",
          ),
          400,
        );
      }
      return undefined;
    },
  });

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
  });

  app.openapi(distanceRoute, (c) => {
    if (!initialization.ok) {
      return c.json(
        errorBody(
          "DATASET_UNAVAILABLE",
          "The commune dataset is temporarily unavailable.",
        ),
        503,
      );
    }

    try {
      const query = c.req.valid("query");
      const distanceService =
        overrides?.distanceService ??
        new DistanceService(initialization.repository);
      const result = distanceService.calculate(
        query.originCommuneId,
        query.destinationCommuneId,
      );
      return c.json(result, 200);
    } catch (error) {
      if (error instanceof CommuneNotFoundError) {
        return c.json(
          errorBody(
            "COMMUNE_NOT_FOUND",
            "One or more commune identifiers were not found.",
          ),
          404,
        );
      }
      throw error;
    }
  });

  app.openapi(healthRoute, (c) => {
    if (!initialization.ok) {
      return c.json(
        { status: "degraded" as const, dataset: { loaded: false as const } },
        503,
      );
    }

    return c.json(
      {
        status: "ready" as const,
        dataset: {
          loaded: true as const,
          version: initialization.repository.version,
          recordCount: initialization.repository.recordCount,
        },
      },
      200,
    );
  });

  app.openapi(versionRoute, (c) => {
    if (!initialization.ok) {
      return c.json(
        errorBody(
          "DATASET_UNAVAILABLE",
          "The commune dataset is temporarily unavailable.",
        ),
        503,
      );
    }

    const manifest = initialization.manifest;
    return c.json(
      {
        schemaVersion: manifest.schemaVersion,
        version: manifest.version,
        asOf: manifest.asOf,
        recordCount: manifest.recordCount,
        runtimeDatasetSha256: manifest.runtimeDatasetSha256,
        inputs: manifest.inputs.map(
          ({
            role,
            sourceUrl,
            effectiveAt,
            sha256,
            attribution,
            licenseUrl,
            shareAlikeNotice,
            derivedDatabaseNotice,
          }) => ({
            role,
            sourceUrl,
            effectiveAt,
            sha256,
            attribution,
            licenseUrl,
            shareAlikeNotice,
            derivedDatabaseNotice,
          }),
        ),
      },
      200,
    );
  });

  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "Vietnam Commune Distance Service",
      version: "0.1.0",
      description:
        "Centroid-to-centroid distances from the official commune catalog and OpenStreetMap boundaries.",
    },
  });

  app.use("/scalar", async (c, next) => {
    await next();
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline' https://cdn.jsdelivr.net; img-src data: https:; connect-src 'self'; font-src https://cdn.jsdelivr.net; base-uri 'none'; frame-ancestors 'none'",
    );
  });
  app.get(
    "/scalar",
    Scalar({
      url: "/openapi.json",
      pageTitle: "Vietnam Commune Distance API",
      cdn: "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.63.0",
    }),
  );

  app.notFound((c) =>
    c.json(errorBody("INVALID_REQUEST", "Route not found."), 404),
  );

  app.onError((_error, c) =>
    c.json(
      errorBody("INTERNAL_ERROR", "An unexpected error occurred."),
      500,
    ),
  );

  return app;
}
