---
phase: 3
title: Validate release and deploy
status: completed
priority: P1
dependencies:
  - 2
effort: 0.5-1 day
---

# Phase 3: Validate release and deploy

## Overview

Extend release evidence for Static Assets, verify correctness/performance,
document the approximation contract, deploy the Worker, and prove the live API.

## Requirements

- Replace the old “no bindings” invariant with an exact `ASSETS` allowlist.
- Verify graph asset hash, ABI, provenance, ODbL notice, dataset compatibility,
  sizes, and absence of raw inputs.
- Benchmark warm route execution and worst-case response generation.
- Keep deployment internal; public auth/rate limiting remains a separate gate.
- Deploy only after all Python, TypeScript, integration, contract, and dry-run
  checks pass.

## Related Code Files

- Modify `scripts/verify-release.mjs`, package scripts, README, API usage,
  tech-stack, and refresh runbook.
- Add/update benchmark and real-artifact integration fixtures.

## Implementation Steps

1. Extend the release verifier for the graph manifest/binary and exact asset
   binding configuration.
2. Add a deterministic route corpus covering urban, rural, mountain, long
   north-south, ferry/island, disconnected, and fallback cases.
3. Gate Worker JS ≤3 MiB gzip, graph <25 MiB, decoded graph <64 MiB, route
   response ≤100 KiB, warm p95 ≤6 ms, and p99 <9 ms on the local proxy corpus.
4. Update documentation with endpoint examples, Polyline6 semantics, warnings,
   approximation limitations, OSM provenance, and graph refresh command.
5. Run the complete release verifier and Wrangler production dry run.
6. Deploy the saved Worker version and smoke `/health`, `/health/road-graph`,
   `/meta/road-graph`, old distance lookup, graph route, and fallback route.

## Success Criteria

- [x] All Python and TypeScript tests, typecheck, and build pass.
- [x] Release verifier covers both code and asset outputs.
- [x] No unsupported bindings or raw/private files are deployed.
- [x] Live route response returns valid Polyline6 and matching versions.
- [x] Live fallback response is transparent and old distance behavior is intact.
- [x] Production URL and smoke evidence are recorded for handoff.

## Risk Assessment

Deployment is an external state change requested by the user. Stop if account
authentication or platform limits prevent a verified deploy; never claim live
success from a dry run.
