import { describe, expect, it } from "vitest";

import { createApp } from "../../src/app";
import { loadRuntimeDataset } from "../../src/data/load-runtime-dataset";
import { createTestDataset } from "../fixtures/communes";

describe("Scalar API reference", () => {
  it("uses the canonical OpenAPI URL and an immutable CDN version", async () => {
    const response = await createApp(
      loadRuntimeDataset(createTestDataset(), { expectedRecordCount: 2 }),
    ).request("/scalar");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("/openapi.json");
    expect(html).toContain(
      "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.63.0",
    );
    expect(html).not.toContain("@latest");
    expect(response.headers.get("content-security-policy")).toContain(
      "https://cdn.jsdelivr.net",
    );
  });
});
