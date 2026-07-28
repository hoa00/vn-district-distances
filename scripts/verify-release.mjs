import { gzipSync } from "node:zlib";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const fromRoot = (path) => new URL(path, root);
const rootPath = fileURLToPath(root);
const EXPECTED_RECORD_COUNT = 3_321;
const MAX_UNPACKED_BYTES = 10 * 1024 * 1024;
const MAX_GZIP_BYTES = 2.5 * 1024 * 1024;

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesUnder(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

const dataset = JSON.parse(
  await readFile(fromRoot("src/data/runtime-dataset.json"), "utf8"),
);
const { manifest, records } = dataset;

invariant(manifest.schemaVersion === 1, "unsupported dataset schema");
invariant(
  manifest.recordCount === EXPECTED_RECORD_COUNT,
  "manifest record count is not 3,321",
);
invariant(
  records.length === EXPECTED_RECORD_COUNT,
  "runtime record count is not 3,321",
);

const ids = new Set();
for (const record of records) {
  invariant(/^\d{5}$/.test(record.id), `invalid commune ID: ${record.id}`);
  invariant(!ids.has(record.id), `duplicate commune ID: ${record.id}`);
  ids.add(record.id);
  invariant(
    Number.isFinite(record.latitude) &&
      record.latitude >= -90 &&
      record.latitude <= 90,
    `invalid latitude: ${record.id}`,
  );
  invariant(
    Number.isFinite(record.longitude) &&
      record.longitude >= -180 &&
      record.longitude <= 180,
    `invalid longitude: ${record.id}`,
  );
}

const inputRoles = new Set(manifest.inputs.map((input) => input.role));
for (const requiredRole of [
  "commune-catalog",
  "province-catalog",
  "geometry",
]) {
  invariant(inputRoles.has(requiredRole), `missing source role: ${requiredRole}`);
}
const geometryInputs = manifest.inputs.filter(
  (input) => input.role === "geometry",
);
invariant(geometryInputs.length >= 1, "missing geometry provenance");
for (const input of geometryInputs) {
  invariant(
    input.attribution.includes("OpenStreetMap"),
    "geometry attribution must name OpenStreetMap",
  );
  invariant(
    input.licenseUrl.toLowerCase().includes("odbl"),
    "geometry input must link ODbL",
  );
  invariant(
    input.shareAlikeNotice.includes("ODbL"),
    "geometry input must state ODbL share-alike",
  );
}

const wranglerConfig = await readFile(fromRoot("wrangler.jsonc"), "utf8");
invariant(
  /"upload_source_maps"\s*:\s*false/.test(wranglerConfig),
  "Worker source-map uploads must be explicitly disabled",
);
for (const forbiddenBinding of [
  "d1_databases",
  "kv_namespaces",
  "r2_buckets",
  "services",
]) {
  invariant(
    !wranglerConfig.includes(`"${forbiddenBinding}"`),
    `unexpected Worker binding: ${forbiddenBinding}`,
  );
}

const distPath = fileURLToPath(fromRoot("dist"));
const distFiles = await filesUnder(distPath);
invariant(distFiles.length > 0, "dry-run bundle is missing");
invariant(
  distFiles.every(
    (path) => ![".pbf", ".osm", ".pdf", ".env"].includes(extname(path)),
  ),
  "raw data or secrets found in bundle",
);
const shippedFiles = distFiles.filter((path) => extname(path) === ".js");
invariant(shippedFiles.length > 0, "Worker JavaScript bundle is missing");

let unpackedBytes = 0;
let gzipBytes = 0;
for (const path of shippedFiles) {
  const info = await stat(path);
  unpackedBytes += info.size;
  gzipBytes += gzipSync(await readFile(path)).byteLength;
}
invariant(unpackedBytes <= MAX_UNPACKED_BYTES, "bundle exceeds 10 MiB");
invariant(gzipBytes <= MAX_GZIP_BYTES, "bundle exceeds 2.5 MiB gzip");

const evidence = {
  ready: true,
  dataset: {
    version: manifest.version,
    asOf: manifest.asOf,
    generatedAt: manifest.generatedAt,
    recordCount: manifest.recordCount,
    runtimeDatasetSha256: manifest.runtimeDatasetSha256,
  },
  bundle: {
    files: shippedFiles.map((path) => relative(rootPath, path)),
    unpackedBytes,
    gzipBytes,
    bindings: [],
  },
  checks: [
    "dataset-validated",
    "3321-unique-commune-ids",
    "coordinates-valid",
    "osm-odbl-provenance",
    "no-worker-bindings",
    "bundle-size-policy",
    "no-raw-geometry-in-shipped-worker",
  ],
};

await mkdir(fromRoot("data/generated"), { recursive: true });
await writeFile(
  fromRoot("data/generated/release-readiness.json"),
  `${JSON.stringify(evidence, null, 2)}\n`,
);
console.log(JSON.stringify(evidence));
