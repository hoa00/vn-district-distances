---
phase: 5
title: "End-to-End Release Validation"
status: completed
priority: P1
dependencies: [2, 3, 4]
effort: "1 day"
---

# Phase 5: End-to-End Release Validation

## Overview

Run the full matrix against the approved real snapshot, inspect the Worker bundle, document reproducible operation, and produce a readiness verdict. No production deployment without separate approval.

## Context Links

- [PRD acceptance](../../docs/research-PRD.md#13-acceptance-criteria)
- [Phase 2 data gate](./phase-02-licensed-data-snapshot-pipeline.md)
- [Phase 4 API gate](./phase-04-hono-api-openapi-and-scalar.md)

## Key Insights

- Fixture tests do not prove 3,321-unit coverage.
- Dry-run output must obey a fixed bundle policy and exclude raw geometry/secrets.
- README distinguishes snapshot refresh from request runtime.
- Deployment changes external state and remains outside this plan.

## Requirements

- Functional: one sequence validates Python, TypeScript, Worker runtime, OpenAPI, Scalar, bundle.
- Non-functional: clean-checkout reproducibility, no test/runtime network, evidence-backed verdict.

## Architecture

```text
clean install -> provenance/hash -> full tests -> typecheck
-> Wrangler dry-run -> bundle inspection -> smoke -> readiness report
```

## Related Code Files

- Modify: `/Users/hoadev/Projects/pet/vn-district-distances/package.json`
- Create: `/Users/hoadev/Projects/pet/vn-district-distances/README.md`
- Create: `/Users/hoadev/Projects/pet/vn-district-distances/docs/data-refresh-runbook.md`
- Create: `/Users/hoadev/Projects/pet/vn-district-distances/docs/api-usage.md`
- Create: `/Users/hoadev/Projects/pet/vn-district-distances/tests/e2e/worker.test.ts`
- Create: `/Users/hoadev/Projects/pet/vn-district-distances/scripts/verify-release.mjs`
- Generated/ignored: `/Users/hoadev/Projects/pet/vn-district-distances/dist/`
- Generated/ignored: `/Users/hoadev/Projects/pet/vn-district-distances/data/generated/release-readiness.json`

## Tests Before

1. Failing E2E test with two real codes and manifest version assertion.
2. Failing smoke tests for health, metadata, OpenAPI, Scalar.
3. Failing verifier checks for files, hashes, 3,321 count, ODbL attribution/license metadata, unexpected modules/bindings, raw geometry/secrets, and fixed size ceilings.
4. Write the clean-checkout runbook checklist for the committed static artifact before documentation polish.

## Implementation Steps

1. Add `npm run check` for typecheck + all Vitest projects.
2. Implement release verifier with explicit subprocess arguments and fail-on-nonzero behavior.
3. Run frozen uv + pytest; regenerate real snapshot only when refresh is intended.
4. Run npm clean install, Workers types, TypeScript, unit/integration/contract/E2E tests.
5. Run `npx wrangler deploy --dry-run --outdir dist`; fail above 2.5 MiB compressed or 10 MiB unpacked, forbid source maps, unexpected modules/assets, and any binding.
6. Scan source/config/dist/evidence for secret patterns with redacted match output; never load or print actual `.env` values.
7. Run Workers-pool `SELF.fetch` through the configured production default entry with the real runtime artifact.
8. Preview/smoke the exact dry-run output using a Wrangler-supported emitted-artifact path; if the tool cannot do this, mark readiness blocked rather than substituting source-only smoke.
9. Write README quick start, commands, endpoints, version semantics, non-goals.
10. Write refresh runbook: approval → controlled archive update → checksums → committed artifact review.
11. Write API examples for `200/400/404/500/503`, known/unknown same-ID behavior, and degraded health.
12. Emit readiness evidence with results, hashes/count/version, bundle size, timestamp, `ready`.
13. Mark public deployment forbidden by this plan. A later deploy needs explicit hostname/route, `workers.dev` decision, and internal-access control owned outside application code.
14. Do not run `wrangler deploy`; ask separately.

## Refactor

- Consolidate verification commands without hiding failure output.
- Remove production imports of placeholder fixtures.
- Remove unused dependencies/generated files from Git.

## Tests After

- Re-run verifier unchanged; artifact hashes remain stable.
- Corrupt a temporary combined runtime dataset and prove fail-closed behavior.
- Test dry-run failure propagation, missing pinned open-data inputs, incomplete `3,320/3,321` reconciliation, and ODbL attribution failures.
- Verify documentation commands from a clean environment.

## Todo

- [x] E2E/verifier tests red then green.
- [x] Real snapshot passes 3,321/3,321.
- [x] Full npm/uv matrix passes.
- [x] Bundle inspected and within documented limit.
- [x] Production entry and exact emitted artifact smoke-tested.
- [x] README/API/refresh docs verified.
- [x] Readiness evidence produced; no deploy.

## Regression Gate

```bash
uv sync --frozen
uv run pytest
npm ci
npx wrangler types
npm run check
npx wrangler deploy --dry-run --outdir dist
node scripts/verify-release.mjs
```

## Success Criteria

- [x] Clean-install matrix passes with approved snapshot.
- [x] Verifier proves count, hashes, contracts, and bundle boundary.
- [x] No raw geometry, credential, DB/KV binding, auth, or rate-limit code ships; metadata and docs expose OpenStreetMap attribution and the ODbL link.
- [x] New developer can test and refresh data from docs.
- [x] Deployment stays separately approved.

## Risk Assessment

- Fixed ceilings are conservative MVP policy; actual Workers account limits may be stricter and remain authoritative.
- Source code/count changes require a new snapshot review.
- Native Python environment may reduce portability; document supported platforms.

## Security Considerations

- Scan bundle/evidence for credentials and local paths.
- Do not publish contractual source evidence with private details.
- Application auth remains out of scope; public deployment is explicitly not release-ready without a separate edge-access decision.

## Next Steps

User reviews readiness, then explicitly chooses deploy and later commit/push.
