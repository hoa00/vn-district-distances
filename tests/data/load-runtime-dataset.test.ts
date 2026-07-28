import { describe, expect, it } from "vitest";

import { DatasetUnavailableError } from "../../src/domain/errors";
import { loadRuntimeDataset } from "../../src/data/load-runtime-dataset";
import { createTestDataset } from "../fixtures/communes";

describe("loadRuntimeDataset", () => {
  it("initializes a repository exactly once from a valid artifact", () => {
    const initialization = loadRuntimeDataset(createTestDataset(), {
      expectedRecordCount: 2,
    });

    expect(initialization.ok).toBe(true);
    if (initialization.ok) {
      expect(initialization.repository.findById("00004")?.id).toBe("00004");
      expect(initialization.manifest.version).toBe("test-2026-07-28");
    }
  });

  it("rejects a structurally valid artifact below the production count", () => {
    const initialization = loadRuntimeDataset(createTestDataset());

    expect(initialization).toEqual({
      ok: false,
      error: expect.any(DatasetUnavailableError),
    });
  });

  it("rejects an artifact missing required provenance roles", () => {
    const dataset = createTestDataset();
    const initialization = loadRuntimeDataset(
      {
        ...dataset,
        manifest: {
          ...dataset.manifest,
          inputs: dataset.manifest.inputs.filter(
            ({ role }) => role === "geometry",
          ),
        },
      },
      { expectedRecordCount: 2 },
    );

    expect(initialization.ok).toBe(false);
  });

  it("rejects geometry provenance without ODbL metadata", () => {
    const dataset = createTestDataset();
    const initialization = loadRuntimeDataset(
      {
        ...dataset,
        manifest: {
          ...dataset.manifest,
          inputs: dataset.manifest.inputs.map((input) =>
            input.role === "geometry"
              ? { ...input, shareAlikeNotice: "missing" }
              : input,
          ),
        },
      },
      { expectedRecordCount: 2 },
    );

    expect(initialization.ok).toBe(false);
  });

  it.each([
    null,
    {},
    { manifest: {}, records: [] },
    {
      ...createTestDataset(),
      records: [{ ...createTestDataset().records[0], latitude: "21.034" }],
    },
  ])("converts an invalid artifact into degraded initialization", (artifact) => {
    const initialization = loadRuntimeDataset(artifact);

    expect(initialization).toEqual({
      ok: false,
      error: expect.any(DatasetUnavailableError),
    });
  });
});
