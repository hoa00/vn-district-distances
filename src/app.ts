import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";

import type {
  ErrorCode,
  ErrorResponse,
  RoadGraphManifest,
  RoadRouteResponse,
} from "./contracts";
import type { RuntimeDatasetInitialization } from "./data/load-runtime-dataset";
import roadGraphManifestArtifact from "./data/road-graph-manifest.json";
import type { RoadGraphProvider } from "./data/load-road-graph";
import {
  type AssetFetcher,
  StaticAssetRoadGraphProvider,
} from "./data/static-road-graph-provider";
import {
  CommuneNotFoundError,
  OutsideRoadGraphCoverageError,
  RoadGraphUnavailableError,
} from "./domain/errors";
import {
  coordinateRoadRouteQuerySchema,
  coordinateRoadRouteResponseSchema,
  distanceQuerySchema,
  distanceResponseSchema,
  errorResponseSchema,
  healthResponseSchema,
  roadGraphHealthResponseSchema,
  roadGraphMetadataResponseSchema,
  roadRouteQuerySchema,
  roadRouteResponseSchema,
  versionResponseSchema,
} from "./schemas/api";
import { DistanceService } from "./services/distance-service";
import { RouteService } from "./services/route-service";

interface AppEnvironment {
  Bindings: {
    readonly ASSETS?: AssetFetcher;
  };
}

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

const roadRoute = createRoute({
  method: "get",
  path: "/api/v1/road-routes",
  operationId: "getApproximateRoadRoute",
  request: { query: roadRouteQuerySchema },
  responses: {
    200: jsonContent(roadRouteResponseSchema, "Approximate static road route"),
    400: jsonContent(errorResponseSchema, "Invalid request"),
    404: jsonContent(errorResponseSchema, "Commune not found"),
    500: jsonContent(errorResponseSchema, "Unexpected error"),
    503: jsonContent(errorResponseSchema, "Road graph unavailable"),
  },
});

const coordinateRoute = createRoute({
  method: "get",
  path: "/api/v1/road-routes/points",
  operationId: "getApproximateRoadRouteByPoints",
  request: { query: coordinateRoadRouteQuerySchema },
  responses: {
    200: jsonContent(
      coordinateRoadRouteResponseSchema,
      "Approximate static road route by WGS84 coordinates",
    ),
    400: jsonContent(errorResponseSchema, "Invalid request"),
    422: jsonContent(
      errorResponseSchema,
      "Point outside road graph coverage",
    ),
    500: jsonContent(errorResponseSchema, "Unexpected error"),
    503: jsonContent(errorResponseSchema, "Road graph unavailable"),
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

const roadGraphHealthRoute = createRoute({
  method: "get",
  path: "/health/road-graph",
  operationId: "getRoadGraphHealth",
  responses: {
    200: jsonContent(roadGraphHealthResponseSchema, "Road graph ready"),
    503: jsonContent(roadGraphHealthResponseSchema, "Road graph degraded"),
  },
});

const roadGraphMetadataRoute = createRoute({
  method: "get",
  path: "/meta/road-graph",
  operationId: "getRoadGraphMetadata",
  responses: {
    200: jsonContent(roadGraphMetadataResponseSchema, "Road graph metadata"),
  },
});

function errorBody(code: ErrorCode, message: string): ErrorResponse {
  return { error: { code, message } };
}

export interface AppOverrides {
  readonly distanceService?: Pick<DistanceService, "calculate">;
  readonly roadRouteService?: Pick<RouteService, "calculate" | "calculatePoints">;
  readonly roadGraphProvider?: RoadGraphProvider;
  readonly roadGraphManifest?: RoadGraphManifest;
}

export function createApp(
  initialization: RuntimeDatasetInitialization,
  overrides?: AppOverrides,
) {
  const activeRoadGraphManifest =
    overrides?.roadGraphManifest ??
    (roadGraphManifestArtifact as RoadGraphManifest);
  let defaultRoadGraphProvider: RoadGraphProvider | undefined;
  let defaultRoadRouteService: RouteService | undefined;

  const app = new OpenAPIHono<AppEnvironment>({
    defaultHook: (result, c) => {
      if (!result.success) {
        // Coordinate route dùng thông báo riêng; các route commune/distance giữ thông báo cũ.
        const message = c.req.path.includes("/road-routes/points")
          ? "Both origin and destination coordinates must be valid WGS84 points."
          : "Both commune identifiers must contain exactly five digits.";
        return c.json(errorBody("INVALID_REQUEST", message), 400);
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

  function getRoadGraphProvider(assets: AssetFetcher | undefined) {
    if (overrides?.roadGraphProvider !== undefined) {
      return overrides.roadGraphProvider;
    }
    if (!initialization.ok) {
      throw new RoadGraphUnavailableError();
    }
    if (assets === undefined) {
      return new StaticAssetRoadGraphProvider(
        activeRoadGraphManifest,
        undefined,
        {
          version: initialization.manifest.version,
          sha256: initialization.manifest.runtimeDatasetSha256,
        },
      );
    }
    defaultRoadGraphProvider ??= new StaticAssetRoadGraphProvider(
      activeRoadGraphManifest,
      assets,
      {
        version: initialization.manifest.version,
        sha256: initialization.manifest.runtimeDatasetSha256,
      },
    );
    return defaultRoadGraphProvider;
  }

  function getRoadRouteService(assets: AssetFetcher | undefined) {
    if (overrides?.roadRouteService !== undefined) {
      return overrides.roadRouteService;
    }
    if (!initialization.ok) {
      throw new RoadGraphUnavailableError();
    }
    if (assets === undefined) {
      return new RouteService(
        initialization.repository,
        getRoadGraphProvider(undefined),
      );
    }

    defaultRoadRouteService ??= new RouteService(
      initialization.repository,
      getRoadGraphProvider(assets),
    );
    return defaultRoadRouteService;
  }

  app.openapi(roadRoute, async (c) => {
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
      return c.json(
        await getRoadRouteService(c.env?.ASSETS).calculate(
          query.originCommuneId,
          query.destinationCommuneId,
        ),
        200,
      );
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
      if (error instanceof RoadGraphUnavailableError) {
        return c.json(
          errorBody(
            "ROAD_GRAPH_UNAVAILABLE",
            "The static road graph is temporarily unavailable.",
          ),
          503,
        );
      }
      throw error;
    }
  });

  app.openapi(coordinateRoute, async (c) => {
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
      const result = await getRoadRouteService(c.env?.ASSETS).calculatePoints(
        query.originLat,
        query.originLng,
        query.destinationLat,
        query.destinationLng,
      );
      // Tọa độ là dữ liệu vị trí cá nhân: không cache phía client và không log raw query.
      c.header("Cache-Control", "private, no-store");
      return c.json(result, 200);
    } catch (error) {
      if (error instanceof OutsideRoadGraphCoverageError) {
        return c.json(
          errorBody(
            "OUTSIDE_ROAD_GRAPH_COVERAGE",
            "One or both points are outside the road graph coverage area.",
          ),
          422,
        );
      }
      if (error instanceof RoadGraphUnavailableError) {
        return c.json(
          errorBody(
            "ROAD_GRAPH_UNAVAILABLE",
            "The static road graph is temporarily unavailable.",
          ),
          503,
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

  app.openapi(roadGraphHealthRoute, async (c) => {
    try {
      const graph = await getRoadGraphProvider(c.env?.ASSETS).get();
      return c.json(
        {
          status: "ready" as const,
          roadGraph: {
            loaded: true as const,
            version: graph.manifest.graphVersion,
            nodeCount: graph.manifest.nodeCount,
            edgeCount: graph.manifest.edgeCount,
          },
        },
        200,
      );
    } catch {
      return c.json(
        {
          status: "degraded" as const,
          roadGraph: { loaded: false as const },
        },
        503,
      );
    }
  });

  app.openapi(roadGraphMetadataRoute, (c) =>
    c.json(activeRoadGraphManifest, 200),
  );

  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "Vietnam Commune Distance Service",
      version: "0.1.0",
      description:
        "Centroid distances and approximate static road routes from the official commune catalog and OpenStreetMap data.",
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
