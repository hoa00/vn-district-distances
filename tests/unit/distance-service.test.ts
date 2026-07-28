import { describe, expect, it, vi } from "vitest";

import { CommuneNotFoundError } from "../../src/domain/errors";
import {
  type CommuneRepository,
  StaticCommuneRepository,
} from "../../src/repositories/commune-repository";
import { DistanceService } from "../../src/services/distance-service";
import { createTestDataset, TEST_COMMUNES } from "../fixtures/communes";

function createRepository(): StaticCommuneRepository {
  return new StaticCommuneRepository(createTestDataset());
}

describe("DistanceService", () => {
  it("returns a rounded, versioned distance", () => {
    const service = new DistanceService(createRepository());

    const result = service.calculate("00004", "00292");

    expect(result).toMatchObject({
      originCommuneId: "00004",
      destinationCommuneId: "00292",
      unit: "km",
      datasetVersion: "test-2026-07-28",
    });
    expect(result.distanceKm).toBeGreaterThan(3.9);
    expect(result.distanceKm).toBeLessThan(4.1);
  });

  it("reports a missing origin without looking up the destination", () => {
    const repository = createRepository();
    const findById = vi.spyOn(repository, "findById");
    const service = new DistanceService(repository);

    expect(() => service.calculate("99999", "88888")).toThrow(
      CommuneNotFoundError,
    );
    expect(findById).toHaveBeenCalledTimes(1);
    expect(findById).toHaveBeenCalledWith("99999");
  });

  it("reports a missing destination after finding the origin", () => {
    const service = new DistanceService(createRepository());

    try {
      service.calculate("00004", "99999");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CommuneNotFoundError);
      expect((error as CommuneNotFoundError).communeIds).toEqual(["99999"]);
    }
  });

  it("returns zero for a known same ID after one lookup", () => {
    const findById = vi.fn<CommuneRepository["findById"]>((id) =>
      id === "00004" ? TEST_COMMUNES[0] : undefined,
    );
    const repository: CommuneRepository = {
      version: "test",
      recordCount: 1,
      findById,
    };

    expect(new DistanceService(repository).calculate("00004", "00004")).toEqual(
      {
        originCommuneId: "00004",
        destinationCommuneId: "00004",
        distanceKm: 0,
        unit: "km",
        datasetVersion: "test",
      },
    );
    expect(findById).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown same ID after one lookup", () => {
    const findById = vi.fn<CommuneRepository["findById"]>(() => undefined);
    const repository: CommuneRepository = {
      version: "test",
      recordCount: 0,
      findById,
    };

    expect(() =>
      new DistanceService(repository).calculate("99999", "99999"),
    ).toThrow(CommuneNotFoundError);
    expect(findById).toHaveBeenCalledTimes(1);
  });
});
