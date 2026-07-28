import type { DistanceResponse } from "../contracts";
import { CommuneNotFoundError } from "../domain/errors";
import { haversineKm, roundDistanceKm } from "../domain/geo";
import type { CommuneRepository } from "../repositories/commune-repository";

export class DistanceService {
  readonly #repository: CommuneRepository;

  constructor(repository: CommuneRepository) {
    this.#repository = repository;
  }

  calculate(
    originCommuneId: string,
    destinationCommuneId: string,
  ): DistanceResponse {
    const origin = this.#repository.findById(originCommuneId);
    if (origin === undefined) {
      throw new CommuneNotFoundError([originCommuneId]);
    }

    if (originCommuneId === destinationCommuneId) {
      return {
        originCommuneId,
        destinationCommuneId,
        distanceKm: 0,
        unit: "km",
        datasetVersion: this.#repository.version,
      };
    }

    const destination = this.#repository.findById(destinationCommuneId);
    if (destination === undefined) {
      throw new CommuneNotFoundError([destinationCommuneId]);
    }

    const distanceKm = haversineKm(
      { lat: origin.latitude, lng: origin.longitude },
      { lat: destination.latitude, lng: destination.longitude },
    );

    return {
      originCommuneId,
      destinationCommuneId,
      distanceKm: roundDistanceKm(distanceKm),
      unit: "km",
      datasetVersion: this.#repository.version,
    };
  }
}
