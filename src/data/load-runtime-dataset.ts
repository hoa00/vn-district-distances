import { z } from "zod";

import type { DatasetManifest } from "../contracts";
import { DatasetUnavailableError } from "../domain/errors";
import { StaticCommuneRepository } from "../repositories/commune-repository";

export const PRODUCTION_RECORD_COUNT = 3_321;

const datasetInputSchema = z.strictObject({
  role: z.enum(["commune-catalog", "province-catalog", "geometry"]),
  sourceUrl: z.url(),
  archivePath: z.string().min(1),
  effectiveAt: z.string().min(1),
  retrievedAt: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  attribution: z.string().min(1),
  licenseUrl: z.url(),
  shareAlikeNotice: z.string().min(1),
  derivedDatabaseNotice: z.string().min(1),
});

const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  version: z.string().min(1),
  asOf: z.string().min(1),
  generatedAt: z.string().min(1),
  recordCount: z.number().int().nonnegative(),
  inputs: z.array(datasetInputSchema).min(1),
  runtimeDatasetSha256: z.string().min(1),
});

const communeCentroidSchema = z.strictObject({
  id: z.string().regex(/^\d{5}$/),
  name: z.string().trim().min(1),
  type: z.enum(["xa", "phuong", "dac-khu"]),
  provinceId: z.string().regex(/^\d{2}$/),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  centroidOutsideGeometry: z.boolean(),
});

const runtimeDatasetSchema = z.strictObject({
  manifest: manifestSchema,
  records: z.array(communeCentroidSchema),
});

export type RuntimeDatasetInitialization =
  | {
      readonly ok: true;
      readonly repository: StaticCommuneRepository;
      readonly manifest: DatasetManifest;
    }
  | {
      readonly ok: false;
      readonly error: DatasetUnavailableError;
    };

export function loadRuntimeDataset(
  artifact: unknown,
  options: { readonly expectedRecordCount?: number } = {},
): RuntimeDatasetInitialization {
  const parsed = runtimeDatasetSchema.safeParse(artifact);
  if (!parsed.success) {
    return { ok: false, error: new DatasetUnavailableError() };
  }

  try {
    const expectedRecordCount =
      options.expectedRecordCount ?? PRODUCTION_RECORD_COUNT;
    const roles = new Set(parsed.data.manifest.inputs.map(({ role }) => role));
    const requiredRoles = [
      "commune-catalog",
      "province-catalog",
      "geometry",
    ] as const;
    const hasRequiredRoles = requiredRoles.every((role) => roles.has(role));
    const geometryInputs = parsed.data.manifest.inputs.filter(
      ({ role }) => role === "geometry",
    );
    const hasValidGeometryRights =
      geometryInputs.length > 0 &&
      geometryInputs.every(
        ({ attribution, licenseUrl, shareAlikeNotice }) =>
          attribution.includes("OpenStreetMap") &&
          licenseUrl.toLowerCase().includes("odbl") &&
          shareAlikeNotice.includes("ODbL"),
      );
    if (
      parsed.data.manifest.recordCount !== expectedRecordCount ||
      parsed.data.records.length !== expectedRecordCount ||
      !hasRequiredRoles ||
      !hasValidGeometryRights
    ) {
      throw new DatasetUnavailableError();
    }
    return {
      ok: true,
      repository: new StaticCommuneRepository(parsed.data),
      manifest: parsed.data.manifest,
    };
  } catch {
    return { ok: false, error: new DatasetUnavailableError() };
  }
}
