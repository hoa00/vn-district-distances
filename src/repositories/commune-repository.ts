import {
  isCommuneId,
  type CommuneCentroid,
  type CommuneType,
  type RuntimeDataset,
} from "../contracts";
import { DatasetUnavailableError } from "../domain/errors";

const COMMUNE_TYPES: ReadonlySet<CommuneType> = new Set([
  "xa",
  "phuong",
  "dac-khu",
]);
const PROVINCE_ID_PATTERN = /^\d{2}$/;

export interface CommuneRepository {
  readonly version: string;
  readonly recordCount: number;
  findById(id: string): CommuneCentroid | undefined;
}

function isValidRecord(record: CommuneCentroid): boolean {
  return (
    isCommuneId(record.id) &&
    PROVINCE_ID_PATTERN.test(record.provinceId) &&
    record.name.trim().length > 0 &&
    COMMUNE_TYPES.has(record.type) &&
    typeof record.centroidOutsideGeometry === "boolean" &&
    Number.isFinite(record.latitude) &&
    record.latitude >= -90 &&
    record.latitude <= 90 &&
    Number.isFinite(record.longitude) &&
    record.longitude >= -180 &&
    record.longitude <= 180
  );
}

export class StaticCommuneRepository implements CommuneRepository {
  readonly version: string;
  readonly recordCount: number;
  readonly #records: ReadonlyMap<string, CommuneCentroid>;

  constructor(dataset: RuntimeDataset) {
    if (
      dataset.manifest.schemaVersion !== 1 ||
      dataset.manifest.version.trim().length === 0 ||
      dataset.manifest.recordCount !== dataset.records.length
    ) {
      throw new DatasetUnavailableError();
    }

    const records = new Map<string, CommuneCentroid>();
    for (const record of dataset.records) {
      if (!isValidRecord(record) || records.has(record.id)) {
        throw new DatasetUnavailableError();
      }

      records.set(record.id, Object.freeze({ ...record }));
    }

    this.version = dataset.manifest.version;
    this.recordCount = records.size;
    this.#records = records;
  }

  findById(id: string): CommuneCentroid | undefined {
    return this.#records.get(id);
  }
}
