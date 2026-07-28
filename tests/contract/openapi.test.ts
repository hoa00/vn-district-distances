import { describe, expect, it } from "vitest";

import { createApp } from "../../src/app";
import { loadRuntimeDataset } from "../../src/data/load-runtime-dataset";
import { createTestDataset } from "../fixtures/communes";

describe("OpenAPI contract", () => {
  it("describes every distance response and operational route", async () => {
    const response = await createApp(
      loadRuntimeDataset(createTestDataset(), { expectedRecordCount: 2 }),
    ).request("/openapi.json");
    const document = (await response.json()) as {
      openapi: string;
      paths: Record<
        string,
        { get?: { operationId?: string; responses?: Record<string, unknown> } }
      >;
    };

    expect(response.status).toBe(200);
    expect(document.openapi).toBe("3.1.0");
    expect(document.paths["/api/v1/distances"]?.get?.operationId).toBe(
      "getCommuneDistance",
    );
    expect(
      Object.keys(
        document.paths["/api/v1/distances"]?.get?.responses ?? {},
      ).sort(),
    ).toEqual(["200", "400", "404", "500", "503"]);
    expect(document.paths["/health"]?.get?.operationId).toBe("getHealth");
    expect(document.paths["/api/v1/road-routes"]?.get?.operationId).toBe(
      "getApproximateRoadRoute",
    );
    expect(
      Object.keys(
        document.paths["/api/v1/road-routes"]?.get?.responses ?? {},
      ).sort(),
    ).toEqual(["200", "400", "404", "500", "503"]);
    expect(document.paths["/health/road-graph"]?.get?.operationId).toBe(
      "getRoadGraphHealth",
    );
    expect(document.paths["/meta/version"]?.get?.operationId).toBe(
      "getDatasetVersion",
    );
    expect(document.paths["/meta/road-graph"]?.get?.operationId).toBe(
      "getRoadGraphMetadata",
    );
  });
});
