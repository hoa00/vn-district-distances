import type { RoadGraphManifest } from "../contracts";
import { RoadGraphUnavailableError } from "../domain/errors";
import {
  loadRoadGraph,
  type RoadGraph,
  type RoadGraphProvider,
} from "./load-road-graph";

export interface AssetFetcher {
  fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
}

export class StaticAssetRoadGraphProvider implements RoadGraphProvider {
  readonly manifest: RoadGraphManifest;

  readonly #assets: AssetFetcher | undefined;
  readonly #expectedDatasetVersion: string;
  readonly #expectedDatasetSha256: string;
  #loading: Promise<RoadGraph> | undefined;

  constructor(
    manifest: RoadGraphManifest,
    assets: AssetFetcher | undefined,
    expectedDataset: {
      readonly version: string;
      readonly sha256: string;
    },
  ) {
    this.manifest = manifest;
    this.#assets = assets;
    this.#expectedDatasetVersion = expectedDataset.version;
    this.#expectedDatasetSha256 = expectedDataset.sha256;
  }

  async get(): Promise<RoadGraph> {
    if (this.#loading !== undefined) {
      return this.#loading;
    }

    const loading = this.#load();
    this.#loading = loading;
    try {
      return await loading;
    } catch {
      if (this.#loading === loading) {
        this.#loading = undefined;
      }
      throw new RoadGraphUnavailableError();
    }
  }

  async #load(): Promise<RoadGraph> {
    if (this.#assets === undefined) {
      throw new RoadGraphUnavailableError();
    }
    const response = await this.#assets.fetch(
      new URL(this.manifest.assetPath, "https://assets.local"),
    );
    if (!response.ok) {
      throw new RoadGraphUnavailableError();
    }

    const declaredLength = response.headers.get("content-length");
    if (
      declaredLength !== null &&
      Number.parseInt(declaredLength, 10) !== this.manifest.sizeBytes
    ) {
      throw new RoadGraphUnavailableError();
    }

    const buffer = await response.arrayBuffer();
    const initialization = await loadRoadGraph({
      manifest: this.manifest,
      buffer,
      expectedDatasetVersion: this.#expectedDatasetVersion,
      expectedDatasetSha256: this.#expectedDatasetSha256,
    });
    if (!initialization.ok) {
      throw new RoadGraphUnavailableError();
    }
    return initialization.graph;
  }
}
