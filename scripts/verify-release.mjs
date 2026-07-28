import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
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
const MAX_STATIC_ASSET_BYTES = 25 * 1024 * 1024;
const MAX_DECODED_GRAPH_BYTES = 64 * 1024 * 1024;
const SEARCH_NODE_CAP = 10_000;
const FORBIDDEN_SHIPPED_EXTENSIONS = new Set([".pbf", ".osm", ".pdf", ".env"]);

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function hasForbiddenShippedExtension(path) {
  return FORBIDDEN_SHIPPED_EXTENSIONS.has(extname(path));
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
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
invariant(
  /"binding"\s*:\s*"ASSETS"/.test(wranglerConfig),
  "the only runtime binding must be the static ASSETS fetcher",
);
invariant(
  /"directory"\s*:\s*"\.\/public"/.test(wranglerConfig),
  "static assets must be published from ./public",
);

const roadGraphManifest = JSON.parse(
  await readFile(fromRoot("src/data/road-graph-manifest.json"), "utf8"),
);
invariant(
  roadGraphManifest.schemaVersion === 2,
  "unsupported road graph schema",
);
invariant(
  roadGraphManifest.communeDatasetVersion === manifest.version &&
    roadGraphManifest.communeDatasetSha256 === manifest.runtimeDatasetSha256,
  "road graph and commune dataset versions do not match",
);
invariant(
  roadGraphManifest.spatialCellSizeDegrees === 0.05 &&
    roadGraphManifest.snapMaximumMeters === 10_000 &&
    roadGraphManifest.spatialIndexNodeCount === roadGraphManifest.nodeCount &&
    Number.isInteger(roadGraphManifest.spatialCellCount) &&
    roadGraphManifest.spatialCellCount > 0,
  "road graph spatial index manifest fields are invalid",
);
invariant(
  roadGraphManifest.minimumLatitude <= roadGraphManifest.maximumLatitude &&
    roadGraphManifest.minimumLongitude <= roadGraphManifest.maximumLongitude &&
    roadGraphManifest.minimumLatitude >= -90 &&
    roadGraphManifest.maximumLatitude <= 90 &&
    roadGraphManifest.minimumLongitude >= -180 &&
    roadGraphManifest.maximumLongitude <= 180,
  "road graph bounds are invalid",
);
invariant(
  roadGraphManifest.attribution.includes("OpenStreetMap"),
  "road graph attribution must name OpenStreetMap",
);
invariant(
  roadGraphManifest.licenseUrl.toLowerCase().includes("odbl") &&
    roadGraphManifest.shareAlikeNotice.includes("ODbL"),
  "road graph must retain ODbL licensing notices",
);
invariant(
  /^\/road-graph\/[a-f0-9]{64}\.bin$/.test(
    roadGraphManifest.assetPath,
  ),
  "road graph must use a content-addressed asset path",
);

const roadGraphAsset = await readFile(
  fromRoot(`public${roadGraphManifest.assetPath}`),
);
const roadGraphSha256 = sha256Hex(roadGraphAsset);
invariant(
  roadGraphAsset.byteLength === roadGraphManifest.sizeBytes,
  "road graph asset size does not match its manifest",
);
invariant(
  roadGraphSha256 === roadGraphManifest.assetSha256,
  "road graph asset checksum does not match its manifest",
);
invariant(
  roadGraphAsset.byteLength < MAX_STATIC_ASSET_BYTES,
  "road graph exceeds the 25 MiB static asset limit",
);
invariant(
  roadGraphAsset.subarray(0, 4).toString("ascii") === "VNRG",
  "road graph binary magic is invalid",
);
invariant(
  roadGraphAsset.readUInt16LE(4) === 2,
  "road graph binary schema is not v2",
);
invariant(
  roadGraphAsset.readUInt16LE(6) === 16,
  "road graph binary must declare 16 sections",
);
invariant(
  roadGraphAsset.readUInt32LE(8) === 288,
  "road graph binary data offset must be 288",
);
// Spatial node-index section (id 16) phải là permutation [0, nodeCount).
const spatialNodeDirectoryOffset = 32 + (16 - 1) * 16;
const spatialNodeSectionOffset = roadGraphAsset.readUInt32LE(
  spatialNodeDirectoryOffset + 4,
);
const spatialNodeElementCount = roadGraphAsset.readUInt32LE(
  spatialNodeDirectoryOffset + 12,
);
invariant(
  spatialNodeElementCount === roadGraphManifest.nodeCount,
  "spatial node index count does not match node count",
);
const spatialSeen = new Uint8Array(roadGraphManifest.nodeCount);
for (let index = 0; index < spatialNodeElementCount; index += 1) {
  const node = roadGraphAsset.readUInt32LE(spatialNodeSectionOffset + index * 4);
  invariant(
    node < roadGraphManifest.nodeCount && spatialSeen[node] === 0,
    "spatial node index is not a permutation",
  );
  spatialSeen[node] = 1;
}
const connectorDirectoryOffset = 32 + (9 - 1) * 16;
const connectorSectionOffset = roadGraphAsset.readUInt32LE(
  connectorDirectoryOffset + 4,
);
const connectorCount = roadGraphAsset.readUInt32LE(
  connectorDirectoryOffset + 12,
);
const graphCommuneIds = new Set();
for (let index = 0; index < connectorCount; index += 1) {
  graphCommuneIds.add(
    roadGraphAsset
      .readUInt32LE(connectorSectionOffset + index * 4)
      .toString()
      .padStart(5, "0"),
  );
}
invariant(
  graphCommuneIds.size === records.length &&
    records.every((record) => graphCommuneIds.has(record.id)),
  "road graph connector IDs do not exactly match the runtime dataset",
);

const estimatedDecodedGraphBytes =
  roadGraphAsset.byteLength +
  roadGraphManifest.nodeCount * 24 +
  connectorCount * 256 +
  SEARCH_NODE_CAP * 64 +
  1024 * 1024;
invariant(
  estimatedDecodedGraphBytes <= MAX_DECODED_GRAPH_BYTES,
  "road graph exceeds the decoded-memory budget",
);

const publicFiles = await filesUnder(fileURLToPath(fromRoot("public")));
invariant(
  publicFiles.every((path) => !hasForbiddenShippedExtension(path)),
  "raw data or secrets found in public assets",
);
invariant(
  publicFiles.filter((path) => extname(path) === ".bin").length === 1,
  "public assets must contain exactly one road graph binary",
);

const distPath = fileURLToPath(fromRoot("dist"));
const distFiles = await filesUnder(distPath);
invariant(distFiles.length > 0, "dry-run bundle is missing");
invariant(
  distFiles.every((path) => !hasForbiddenShippedExtension(path)),
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
    bindings: ["ASSETS"],
  },
  roadGraph: {
    version: roadGraphManifest.graphVersion,
    osmAsOf: roadGraphManifest.osmAsOf,
    assetPath: roadGraphManifest.assetPath,
    assetSha256: roadGraphManifest.assetSha256,
    sizeBytes: roadGraphManifest.sizeBytes,
    nodeCount: roadGraphManifest.nodeCount,
    edgeCount: roadGraphManifest.edgeCount,
    snappedCommuneCount: roadGraphManifest.snappedCommuneCount,
    unroutableCommuneCount: roadGraphManifest.unroutableCommuneCount,
    spatialCellCount: roadGraphManifest.spatialCellCount,
    spatialCellSizeDegrees: roadGraphManifest.spatialCellSizeDegrees,
    snapMaximumMeters: roadGraphManifest.snapMaximumMeters,
    bounds: {
      minimumLatitude: roadGraphManifest.minimumLatitude,
      maximumLatitude: roadGraphManifest.maximumLatitude,
      minimumLongitude: roadGraphManifest.minimumLongitude,
      maximumLongitude: roadGraphManifest.maximumLongitude,
    },
    estimatedDecodedBytes: estimatedDecodedGraphBytes,
  },
  checks: [
    "dataset-validated",
    "3321-unique-commune-ids",
    "coordinates-valid",
    "osm-odbl-provenance",
    "static-assets-binding-allowlisted",
    "road-graph-dataset-version-match",
    "road-graph-content-addressed",
    "road-graph-connector-id-set",
    "road-graph-v2-abi",
    "road-graph-spatial-index-permutation",
    "road-graph-size-policy",
    "road-graph-odbl-provenance",
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
