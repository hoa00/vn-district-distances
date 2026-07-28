# Coordinate Road Routing Plan

**Date**: 2026-07-28 20:11
**Severity**: High
**Component**: Coordinate road routing endpoint and offline spatial index
**Status**: Resolved

## What Happened

We locked the plan for a new additive endpoint, `GET /api/v1/road-routes/points`, that estimates road distance between two WGS84 coordinates without changing the existing CommuneId route. The hard constraint was Cloudflare Workers Free: 10 ms CPU/request is not enough to do a linear node scan or build a spatial `Map` in request time across 102,507 graph nodes. The plan therefore commits to an offline VNRG v2 spatial CSR, loaded zero-copy at runtime.

## The Brutal Truth

The old “just snap it live” instinct is dead here. It would have been slower, noisier, and fake-accurate under load. This is exactly the kind of feature that looks simple until you force it through a real CPU budget. The annoying part is that the right design is also the more complicated one: offline index generation, explicit coverage gates, and an atomic rollback story all had to be accepted up front instead of being discovered after the first broken deploy.

## Technical Details

- Additive GET endpoint only; CommuneId contract stays byte-compatible.
- Offline VNRG v2 adds packed cell keys, offsets, and node indices in CSR form.
- Grid index uses `0.05°` cells; runtime lookup is binary search plus Haversine over candidates, not a request-time grid build.
- Inputs outside expanded graph coverage return `422 OUTSIDE_ROAD_GRAPH_COVERAGE`; valid-but-unconnected cases can fall back transparently.
- Candidate budgets, bbox checks, and route assembly gates are hard limits, not advisory warnings.
- The route kernel is shared: one A*/geometry/fallback core, with adapters for CommuneId and coordinate inputs.
- Accuracy gate stays node-only for MVP; segment snapping is explicitly deferred.

## What We Tried

We rejected several options: overload the existing route endpoint, do runtime grid construction, or hide the problem behind a POST body and a bigger code path. Those choices all either increased regression risk or moved CPU cost into the cold path where Cloudflare punishes us hardest. The red-team review also forced changes we kept: no-store headers for GET coordinates, truthful 422 coverage handling, shared connector/kernel reuse, cold-load gating, and rollback via atomic deployment versioning.

## Root Cause Analysis

The root issue is simple: request-time spatial search does not fit the platform budget. If we had tried to keep the whole thing dynamic, we would have shipped a feature that failed under real traffic and then lied about why. The offline CSR is the honest trade-off.

## Lessons Learned

- Budget the platform first, then the algorithm.
- If the graph is static, the index should be static too.
- Shared kernels beat duplicated route logic every time.
- Coverage failures need explicit status codes, not vague fallbacks.
- Rollback has to be part of the design, not a postscript.

## Next Steps

- Owner: implementation, build Phase 1 offline CSR and loader support.
- Owner: API, add the additive points endpoint and shared kernel wiring.
- Owner: release, enforce cold-load, performance, and rollback gates before deployment.
- Timeline: keep the node-only MVP until the quality corpus proves segment snapping is worth the extra complexity.
