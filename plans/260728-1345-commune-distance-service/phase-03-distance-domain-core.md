---
phase: 3
title: "Distance Domain Core"
status: completed
priority: P1
dependencies: [2]
effort: "1 day"
---

# Phase 3: Distance Domain Core

## Overview

Implement the pure Haversine utility, immutable snapshot repository, and distance orchestration service with tests before production code.

## Context Links

- [PRD core logic](../../docs/research-PRD.md#6-logic-khoảng-cách)
- [Phase 2 artifacts](./phase-02-licensed-data-snapshot-pipeline.md)
- [Phase 4 API](./phase-04-hono-api-openapi-and-scalar.md)

## Key Insights

- Runtime receives precomputed centroids; no geometry or network work.
- The dataset loader validates the bundled artifact before constructing the repository.
- Same-ID and invalid-centroid semantics are Phase 1 contract gates, not implementation-time choices.
- One combined runtime artifact prevents manifest/record generation mismatch.

## Requirements

- Functional: O(1) lookup, point validation, Haversine `R=6371`, round once to two decimals.
- Non-functional: pure deterministic math, no `any`, mutation, request I/O, or framework coupling.

## Architecture

```text
StaticCommuneRepository(Map) -> DistanceService
                                 -> validatePoint
                                 -> haversineKm
                                 -> round2
```

Repository accepts readonly records for tests. Production imports one combined JSON artifact.

## Related Code Files

- Create: `/Users/hoadev/Projects/pet/vn-district-distances/src/domain/geo.ts`
- Create: `/Users/hoadev/Projects/pet/vn-district-distances/src/domain/errors.ts`
- Create: `/Users/hoadev/Projects/pet/vn-district-distances/src/repositories/commune-repository.ts`
- Create: `/Users/hoadev/Projects/pet/vn-district-distances/src/services/distance-service.ts`
- Create: `/Users/hoadev/Projects/pet/vn-district-distances/src/data/load-runtime-dataset.ts`
- Create: `/Users/hoadev/Projects/pet/vn-district-distances/tests/fixtures/communes.ts`
- Create: `/Users/hoadev/Projects/pet/vn-district-distances/tests/unit/haversine.test.ts`
- Create: `/Users/hoadev/Projects/pet/vn-district-distances/tests/unit/commune-repository.test.ts`
- Create: `/Users/hoadev/Projects/pet/vn-district-distances/tests/unit/distance-service.test.ts`

## Tests Before

1. Haversine: identical, reference pair, antimeridian, near-pole, invalid values, rounding.
2. Repository: leading-zero lookup, absent ID, duplicate input, invalid artifact → typed `DatasetUnavailable`.
3. Service: valid pair/version, missing origin/destination/both.
4. Same-ID tests: known identical → zero after one lookup; unknown identical → not found.

## Implementation Steps

1. Define finite/range-safe `Point` validation.
2. Implement degrees-to-radians and unrounded Haversine with radius 6,371 km.
3. Clamp intermediate `a` to `[0,1]` against floating-point domain errors.
4. Round only public output; lock the exact two-decimal rule in tests.
5. Implement `StaticCommuneRepository` with private readonly `Map`; reject duplicates and mutable exposure.
6. Parse and validate every centroid in the combined artifact. Any invalid record makes the whole initialization result `DatasetUnavailable`; do not construct a partial repository.
7. Let production bootstrap create either a ready repository or typed `DatasetUnavailable`; Phase 4 decides degraded responses.
8. Implement `DistanceService.calculate` from the approved truth table, with typed response/version.
9. Keep domain errors Hono-independent.

## Refactor

- One coordinate validator; no repository/service duplication.
- No rounding in repository or route.
- No interface/factory hierarchy beyond the test-injection seam.

## Tests After

- Table-driven precision/boundary tests.
- Input mutation cannot mutate repository state.
- Dataset initialization occurs once and cannot escape as an unhandled exception.
- Domain modules have no Hono, fetch, D1, KV, or Wrangler imports.

## Todo

- [x] Math tests red then green.
- [x] Repository tests red then green.
- [x] Service/error tests red then green.
- [x] Static dataset validates once.
- [x] Known/unknown same-ID and dataset-level `503` contracts match validation.

## Regression Gate

```bash
npm run typecheck
npm test -- tests/unit
npm test -- tests/data/snapshot.test.ts
```

## Success Criteria

- [x] Reference and edge tests pass with documented tolerance.
- [x] O(1), immutable lookup with typed domain errors.
- [x] No framework/storage/network dependency in domain code.
- [x] The production runtime dataset artifact loads under strict TypeScript.

## Risk Assessment

- Compare unrounded reference values with tolerance; test rounding separately.
- Invalid production data fails predeploy and yields typed degraded initialization if it reaches runtime.

## Security Considerations

- Error details never expose coordinates or full records.
- No dynamic imports or prototype-sensitive plain-object lookup.

## Next Steps

Phase 4 wraps these framework-neutral contracts with Hono/Zod and OpenAPI.
