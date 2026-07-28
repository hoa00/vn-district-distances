---
phase: 1
title: "Project Contracts and Test Harness"
status: completed
priority: P1
dependencies: []
effort: "0.5-1 day"
---

# Phase 1: Project Contracts and Test Harness

## Overview

Create the reproducible TypeScript/Python workspace, test runners, immutable contracts, and red tests that constrain later phases. No business implementation yet.

## Context Links

- [PRD](../../docs/research-PRD.md)
- [Tech stack](../../docs/tech-stack.md)
- [Phase 2](./phase-02-licensed-data-snapshot-pipeline.md)

## Key Insights

- Repo has docs only; no legacy pattern to preserve.
- npm is lowest-ceremony for one Worker. Python is build-time only and pinned by `uv.lock`.
- `wrangler.jsonc` is source of truth; use ES modules and compatibility date `2026-07-28`.
- API truth tables must be decided before contracts become immutable.

## Requirements

- Functional: scripts for test, typecheck, Workers types, data validation, dry-run build.
- Non-functional: strict TypeScript, no `any`, pinned locks, deterministic commands.
- Scope: no runtime bindings, auth, rate limiting, database, CI service, paid API, or cloud archive credentials.

## Architecture

```text
npm/package-lock -> Worker runtime + TypeScript tests
uv/uv.lock        -> offline geometry pipeline + pytest
```

Shared JSON contracts cross the toolchain boundary. Runtime never imports Python.

## Related Code Files

- Create: `/Users/hoadev/Projects/pet/vn-district-distances/package.json`
- Create: `/Users/hoadev/Projects/pet/vn-district-distances/package-lock.json`
- Create: `/Users/hoadev/Projects/pet/vn-district-distances/tsconfig.json`
- Create: `/Users/hoadev/Projects/pet/vn-district-distances/wrangler.jsonc`
- Create: `/Users/hoadev/Projects/pet/vn-district-distances/vitest.config.ts`
- Create: `/Users/hoadev/Projects/pet/vn-district-distances/worker-configuration.d.ts`
- Create: `/Users/hoadev/Projects/pet/vn-district-distances/pyproject.toml`
- Create: `/Users/hoadev/Projects/pet/vn-district-distances/uv.lock`
- Create: `/Users/hoadev/Projects/pet/vn-district-distances/.gitignore`
- Create: `/Users/hoadev/Projects/pet/vn-district-distances/src/contracts.ts`

## Tests Before

1. Add minimal test-runner configuration only.
2. Lock truth table: malformed → 400; known-same → 200/0; unknown-same/one-missing/both-missing → 404.
3. Lock invalid-dataset invariant: build gate first; runtime initialization failure → 503 `DATASET_UNAVAILABLE`; no 422.
4. Write failing contract tests for five-digit IDs, leading zeroes, domain/response types, and these truth tables.

## Implementation Steps

1. Initialize npm without application routes.
2. Install `hono`, `@hono/zod-openapi`, `zod`, `@scalar/hono-api-reference`.
3. Install `typescript`, `wrangler`, `vitest@^4.1.0`, `@cloudflare/vitest-pool-workers`.
4. Enable strict compiler family, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `resolveJsonModule`, Workers types, no emit.
5. Configure `wrangler.jsonc` with module entry `src/index.ts`, compatibility date, no bindings.
6. Configure Vitest Workers pool; split pure-unit and Worker projects only if one pool cannot serve both cleanly.
7. Initialize uv with exact compatible Python, pyosmium, Shapely, pyproj, pypdf, and pytest versions.
8. Add canonical contracts and error codes: `INVALID_REQUEST`, `COMMUNE_NOT_FOUND`, `DATASET_UNAVAILABLE`, `INTERNAL_ERROR`.
9. Ignore `.wrangler/`, `dist/`, Python caches/venv, `.env*`, `.dev.vars*`, and `data/raw/**`; preserve `data/raw/README.md`.
10. Generate Workers declarations via `npx wrangler types`; never hand-maintain them.

## Refactor

- Replace test-local draft interfaces with imports from `src/contracts.ts`.
- Centralize commands in package scripts; avoid shell-specific logic.
- Keep geometry-only schemas outside the Worker contract.

## Tests After

- Test JSON shapes and ID preservation.
- Test manifest count is numeric but validated against 3,321 in Phase 2.
- Test error details allow `Record<string, unknown>` without `any`.
- Run both runners from clean installs.

## Todo

- [x] npm and uv workspaces lock reproducibly.
- [x] Same-ID and invalid-dataset truth tables encoded exactly as validated.
- [x] Strict compiler and Workers test pool configured.
- [x] Contract tests written red, then made green.
- [x] Generated and temporary artifacts ignored.
- [x] No runtime binding or out-of-scope dependency.

## Regression Gate

```bash
npm ci
npx wrangler types
npm run typecheck
npm test
uv sync --frozen
uv run pytest
```

## Success Criteria

- [x] Fresh npm/uv installs succeed from lockfiles.
- [x] TypeScript strict check and both test runners pass.
- [x] No `any`, DB/auth/rate-limit package, or remote binding.
- [x] Contracts cover all PRD response and manifest fields.

## Risk Assessment

- Native geo wheels may differ by platform. Pin supported Python range and verify wheels before accepting lock.
- Workers test pool/Vitest compatibility can drift. Pin a pool version compatible with Vitest 4.1+.

## Security Considerations

- Do not add credentials or geometry API keys to config or fixtures.
- Keep local secret files ignored.

## Next Steps

Phase 2 consumes these contracts and toolchains. ODbL clears acquisition and transformation, but downstream work remains fail-closed if the official catalog cannot reconcile to `3,321/3,321` real OSM relations.
