# Coarse Road Routing Implementation

**Date**: 2026-07-28 19:28
**Severity**: High
**Component**: Coarse road routing pipeline and runtime lookup
**Status**: Deployed and live-verified

## What Happened

We finished the coarse road routing implementation on top of a static OSM graph instead of trying to compute routes from live data at request time. That was the right call: the graph is stable, the topology is reproducible, and the runtime path stays small enough to ship without dragging in a database or external routing service.

The build now runs in two passes and lands in about 5 minutes. First pass normalizes and indexes the graph; second pass materializes the route artifacts, ABI metadata, and asset stats for the pinned bundle version `v1-3a10...`. We also locked the runtime behavior to car-only routing, which meant reviewing and fixing the `motorcar`/`ferry` handling so the graph does not accidentally treat ferry segments as a general-purpose shortcut.

The ugly part was the identity cache bug. Cached identity records were being reused across distinct lookups, which polluted routing results and made the wrong graph state look valid. That had to be fixed before the cold-load path could be trusted. We also moved the cold-load path to zero-copy reads with checksum validation so startup does not waste time duplicating assets or trusting stale blobs.

Search behavior is now bounded on purpose: fallback search exists, but response caps and search caps are enforced so a bad query cannot blow up the runtime or drag the whole graph through unnecessary work.

## The Brutal Truth

This is the kind of bug pile that feels avoidable in hindsight. The static graph choice saved us, but only after we paid for the mistakes that come with trying to be clever: identity reuse, sloppy vehicle-mode handling, and too much trust in cached assets. It was frustrating because the failure modes were not exotic. They were ordinary engineering mistakes that waste hours and make simple things look haunted.

## Technical Details

- Static OSM graph is used for deterministic routing and offline artifact generation.
- Build is split into two passes and completes in roughly 5 minutes.
- Bundle stats are pinned against ABI/asset metadata for `v1-3a10...`.
- Car-only behavior now explicitly reviews `motorcar` and `ferry` cases.
- Identity cache bug was fixed so records do not bleed across distinct lookups.
- Cold-load path uses zero-copy reads plus checksum verification.
- Fallback search, response size caps, and search caps are enforced at runtime.
- Validation passed with `26` tests and `83` tests green.

## What We Tried

- We first validated whether live or dynamic routing would be worth the complexity. It was not.
- We iterated on graph materialization until the two-pass build stayed under the 5-minute target.
- We audited vehicle-mode rules and corrected the `motorcar`/`ferry` handling after the first pass exposed bad assumptions.
- We fixed the identity cache reuse bug rather than layering more defensive code on top of corrupt state.
- We swapped in zero-copy cold-load behavior with checksums instead of accepting slower startup and weaker integrity checks.

## Root Cause Analysis

The root problem was overconfidence in cached state. We treated routing artifacts, identity records, and asset blobs as if they were safely interchangeable when they were not. That let a few small design mistakes compound: wrong cache reuse, incomplete vehicle-mode review, and no hard runtime caps on fallback paths. The static graph approach was correct, but the implementation only became trustworthy after we stopped assuming the cache was honest.

## Lessons Learned

- Static graph routing is the right shape for this system, but only if cache boundaries are strict.
- Vehicle-mode handling needs explicit review, especially when ferries are involved.
- Cold-load paths should prefer zero-copy plus integrity checks over convenience.
- Runtime fallback logic must be capped from day one, not patched in after the fact.
- If a cache can cross request boundaries, assume it will eventually lie.

## Production Outcome

- Deployed to `https://vn-commune-distance-service.hoa.workers.dev`.
- Cloudflare version: `c50bcf38-2e86-45a1-bffa-2b53096f4a2b`.
- Live smoke passed for dataset/graph health, metadata, legacy distance,
  coarse graph routing, no-connector fallback, and identity routing.
- Two requests during immediate propagation briefly reached the previous
  version; sequential retries returned the expected `200` responses.

## Next Steps

- Keep the static graph pipeline and artifact ABI pinned.
- Monitor real usage before considering finer roads, turn restrictions,
  authentication, or rate limiting.
