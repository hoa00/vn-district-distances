import type { Point } from "../contracts";

const EARTH_RADIUS_KM = 6_371;
const EARTH_RADIUS_METERS = 6_371_000;

export class InvalidCoordinateError extends Error {
  constructor() {
    super("Point coordinates must be finite and within WGS84 bounds.");
    this.name = "InvalidCoordinateError";
  }
}

function validatePoint(point: Point): void {
  if (
    !Number.isFinite(point.lat) ||
    !Number.isFinite(point.lng) ||
    point.lat < -90 ||
    point.lat > 90 ||
    point.lng < -180 ||
    point.lng > 180
  ) {
    throw new InvalidCoordinateError();
  }
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

// Hạt Haversine thuần (không validate), dùng chung cho service và road-node snapper.
// Trả về mét; tránh cấp phát object Point khi đo nhiều candidate nodes trong snap lookup.
function haversineMetersRaw(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const deltaLatitude = toRadians(latitudeB - latitudeA);
  const deltaLongitude = toRadians(longitudeB - longitudeA);
  const originLatitude = toRadians(latitudeA);
  const destinationLatitude = toRadians(latitudeB);

  const sinLatitude = Math.sin(deltaLatitude / 2);
  const sinLongitude = Math.sin(deltaLongitude / 2);
  const rawA =
    sinLatitude * sinLatitude +
    Math.cos(originLatitude) *
      Math.cos(destinationLatitude) *
      sinLongitude *
      sinLongitude;
  const a = Math.min(1, Math.max(0, rawA));
  const angularDistance = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * angularDistance;
}

// Khoảng cách Haversine theo mét cho tọa độ WGS84 thô; không ném lỗi với điểm ngoài bound
// (đầu vào đã được schema validate, candidate node luôn hợp lệ).
export function haversineMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  return haversineMetersRaw(latitudeA, longitudeA, latitudeB, longitudeB);
}

export function haversineKm(origin: Point, destination: Point): number {
  validatePoint(origin);
  validatePoint(destination);

  return (
    haversineMetersRaw(origin.lat, origin.lng, destination.lat, destination.lng) /
    1000
  );
}

export function roundDistanceKm(distanceKm: number): number {
  return Math.round((distanceKm + Number.EPSILON) * 100) / 100;
}
