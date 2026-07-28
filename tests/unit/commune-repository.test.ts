import { describe, expect, it } from "vitest";

import type { CommuneCentroid } from "../../src/contracts";
import { DatasetUnavailableError } from "../../src/domain/errors";
import { StaticCommuneRepository } from "../../src/repositories/commune-repository";
import { createTestDataset, TEST_COMMUNES } from "../fixtures/communes";

describe("StaticCommuneRepository", () => {
  it("looks up leading-zero IDs in constant time", () => {
    const repository = new StaticCommuneRepository(createTestDataset());

    expect(repository.findById("00004")).toMatchObject({
      id: "00004",
      name: "Phường Ba Đình",
    });
    expect(repository.findById("4")).toBeUndefined();
    expect(repository.version).toBe("test-2026-07-28");
    expect(repository.recordCount).toBe(2);
  });

  it("defensively copies and freezes input records", () => {
    const mutableRecord = { ...TEST_COMMUNES[0]! };
    const repository = new StaticCommuneRepository(
      createTestDataset([mutableRecord]),
    );

    mutableRecord.name = "Changed outside";
    const stored = repository.findById("00004");

    expect(stored?.name).toBe("Phường Ba Đình");
    expect(Object.isFrozen(stored)).toBe(true);
  });

  it("rejects duplicate IDs", () => {
    expect(
      () =>
        new StaticCommuneRepository(
          createTestDataset([TEST_COMMUNES[0]!, TEST_COMMUNES[0]!]),
        ),
    ).toThrow(DatasetUnavailableError);
  });

  it.each([
    [{ ...TEST_COMMUNES[0]!, id: "4" }],
    [{ ...TEST_COMMUNES[0]!, name: "" }],
    [{ ...TEST_COMMUNES[0]!, latitude: Number.NaN }],
    [{ ...TEST_COMMUNES[0]!, longitude: 181 }],
    [{ ...TEST_COMMUNES[0]!, type: "district" }],
  ])("rejects an invalid bundled record: %j", (record) => {
    expect(
      () =>
        new StaticCommuneRepository(
          createTestDataset([record as CommuneCentroid]),
        ),
    ).toThrow(DatasetUnavailableError);
  });

  it("rejects manifest and record count disagreement", () => {
    const dataset = createTestDataset();
    const mismatched = {
      ...dataset,
      manifest: { ...dataset.manifest, recordCount: 3 },
    };

    expect(() => new StaticCommuneRepository(mismatched)).toThrow(
      DatasetUnavailableError,
    );
  });
});
