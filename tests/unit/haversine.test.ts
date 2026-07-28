import { describe, expect, it } from "vitest";

import {
  InvalidCoordinateError,
  haversineKm,
  roundDistanceKm,
} from "../../src/domain/geo";

describe("haversineKm", () => {
  it("returns zero for identical points", () => {
    expect(haversineKm({ lat: 21.0285, lng: 105.8542 }, { lat: 21.0285, lng: 105.8542 })).toBe(0);
  });

  it("handles a one-degree equatorial arc", () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(
      111.1949,
      4,
    );
  });

  it("takes the short path across the antimeridian", () => {
    expect(
      haversineKm({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 }),
    ).toBeCloseTo(22.239, 3);
  });

  it.each([
    [{ lat: Number.NaN, lng: 0 }],
    [{ lat: Number.POSITIVE_INFINITY, lng: 0 }],
    [{ lat: 90.0001, lng: 0 }],
    [{ lat: -90.0001, lng: 0 }],
    [{ lat: 0, lng: 180.0001 }],
    [{ lat: 0, lng: -180.0001 }],
  ])("rejects an invalid point: %j", (point) => {
    expect(() => haversineKm(point, { lat: 0, lng: 0 })).toThrow(
      InvalidCoordinateError,
    );
  });
});

describe("roundDistanceKm", () => {
  it("rounds only the public result to two decimals", () => {
    expect(roundDistanceKm(12.345)).toBe(12.35);
    expect(roundDistanceKm(12.344)).toBe(12.34);
  });
});
