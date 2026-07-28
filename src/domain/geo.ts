import type { Point } from "../contracts";

const EARTH_RADIUS_KM = 6_371;

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

export function haversineKm(origin: Point, destination: Point): number {
  validatePoint(origin);
  validatePoint(destination);

  const deltaLatitude = toRadians(destination.lat - origin.lat);
  const deltaLongitude = toRadians(destination.lng - origin.lng);
  const originLatitude = toRadians(origin.lat);
  const destinationLatitude = toRadians(destination.lat);

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

  return EARTH_RADIUS_KM * angularDistance;
}

export function roundDistanceKm(distanceKm: number): number {
  return Math.round((distanceKm + Number.EPSILON) * 100) / 100;
}
