# Vietnam Commune Distance Service

Internal MVP for centroid-to-centroid distance lookup across the 3,321 current Vietnamese commune-level units.

## What It Uses

- Official NSO / Decision 19 commune catalog.
- Timestamped Geofabrik Vietnam OSM PBF under ODbL 1.0.
- Full OSM relation snapshots `17296617` and `3479413` for island geometry omitted by the clipped Vietnam extract.
- OSM relations filtered to `boundary=administrative` and `admin_level=6`, plus the reviewed Hoàng Sa disputed-boundary override in `data/relation-overrides.csv`.
- A committed runtime JSON artifact built from a Git-ignored local SHA-256 content-addressed archive.
- A static road graph asset served from Cloudflare Workers Assets.

## What It Does Not Use

- No paid geometry API.
- No Cloudflare R2 or other cloud archive.
- No auth, rate limiting, database, or scheduled sync.
- No runtime geometry processing.

## Docs

- [API usage](./docs/api-usage.md)
- [Data refresh runbook](./docs/data-refresh-runbook.md)
- [Tech stack](./docs/tech-stack.md)
- [Product requirements](./docs/research-PRD.md)

## Local Validation

Requirements: Node.js 22+, npm, Python 3.13+, and uv.

```bash
npm ci
UV_CACHE_DIR=/tmp/vn-distance-uv-cache uv sync --frozen
UV_CACHE_DIR=/tmp/vn-distance-uv-cache uv run pytest tests/python
UV_CACHE_DIR=/tmp/vn-distance-uv-cache npm run release:verify
```

The release command validates the 3,321-record dataset, runs strict TypeScript and all Worker tests, performs a Wrangler dry-run, checks bundle size/provenance, and writes ignored evidence to `data/generated/release-readiness.json`.

To rebuild the road graph asset and validate it against the bundled dataset:

```bash
npm run data:road-graph:build
npm run data:road-graph:validate
```

For local API development:

```bash
npx wrangler dev
```

## Validation Snapshot

- Observed live OSM baseline: `3,320` relations, diagnostic only.
- Committed artifact: `3,321/3,321`, version `2026.07.28`.
- Final release verifier: ready, only the `ASSETS` binding, no paid runtime service.
- Road graph health and metadata are served at `/health/road-graph` and `/meta/road-graph`.

Deployment is supported with Wrangler:

```bash
npx wrangler deploy
```
