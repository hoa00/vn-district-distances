import type {
  CommuneCentroid,
  DatasetManifest,
  RuntimeDataset,
} from "../../src/contracts";

export const TEST_COMMUNES = [
  {
    id: "00004",
    name: "Phường Ba Đình",
    type: "phuong",
    provinceId: "01",
    latitude: 21.034,
    longitude: 105.814,
    centroidOutsideGeometry: false,
  },
  {
    id: "00292",
    name: "Phường Hoàn Kiếm",
    type: "phuong",
    provinceId: "01",
    latitude: 21.028,
    longitude: 105.852,
    centroidOutsideGeometry: false,
  },
] satisfies CommuneCentroid[];

export function createTestDataset(
  records: readonly CommuneCentroid[] = TEST_COMMUNES,
): RuntimeDataset {
  const manifest = {
    schemaVersion: 1,
    version: "test-2026-07-28",
    asOf: "2026-07-27",
    generatedAt: "2026-07-28T00:00:00Z",
    recordCount: records.length,
    inputs: [
      {
        role: "commune-catalog",
        sourceUrl: "https://example.test/catalog.csv",
        archivePath: `data/raw/sha256/${"a".repeat(64)}/catalog.csv`,
        effectiveAt: "2026-07-27",
        retrievedAt: "2026-07-28T00:00:00Z",
        sha256: "a".repeat(64),
        attribution: "Vietnam NSO",
        licenseUrl: "https://example.test/public-data",
        shareAlikeNotice: "Official factual reference data.",
        derivedDatabaseNotice: "Catalog reference metadata.",
      },
      {
        role: "province-catalog",
        sourceUrl: "https://example.test/provinces.csv",
        archivePath: `data/raw/sha256/${"b".repeat(64)}/provinces.csv`,
        effectiveAt: "2026-07-27",
        retrievedAt: "2026-07-28T00:00:00Z",
        sha256: "b".repeat(64),
        attribution: "Vietnam NSO",
        licenseUrl: "https://example.test/public-data",
        shareAlikeNotice: "Official factual reference data.",
        derivedDatabaseNotice: "Province reference metadata.",
      },
      {
        role: "geometry",
        sourceUrl: "https://download.geofabrik.de/asia/vietnam-test.osm.pbf",
        archivePath: `data/raw/sha256/${"c".repeat(64)}/vietnam-test.osm.pbf`,
        effectiveAt: "2026-07-27",
        retrievedAt: "2026-07-28T00:00:00Z",
        sha256: "c".repeat(64),
        attribution: "© OpenStreetMap contributors",
        licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
        shareAlikeNotice: "ODbL share-alike applies.",
        derivedDatabaseNotice: "Derived database is offered under ODbL.",
      },
    ],
    runtimeDatasetSha256: "d".repeat(64),
  } satisfies DatasetManifest;

  return { manifest, records };
}
