---
title: Coarse Road Routing Progress
date: 2026-07-28T19:29:12+07:00
status: completed
plan: 260728-coarse-road-routing
---

# Coarse Road Routing Progress

## Summary

| Phase | Status | Evidence |
|---|---|---|
| 1. Build graph | Completed | 10,697,248-byte content-addressed artifact; 3,321 exact connector IDs |
| 2. Runtime and API | Completed | A*, Polyline6, identity, transparent fallback, health and metadata |
| 3. Release and deploy | Completed | Cloudflare version `c50bcf38-2e86-45a1-bffa-2b53096f4a2b`; live smoke green |

## Quality Gates

- Python: 26 passed.
- Vitest: 83 passed across 13 files.
- Typecheck and Wrangler dry-run: passed.
- Worker bundle: 229,938 bytes gzip.
- Estimated decoded graph memory: 15,696,168 bytes.
- Warm route corpus: p95 ≤6 ms and p99 <9 ms.
- Route response geometry: hard-capped before the 100 KiB response budget.
- Independent code re-review: no remaining blocker.

## Production

- URL: `https://vn-commune-distance-service.hoa.workers.dev`
- Cloudflare version: `c50bcf38-2e86-45a1-bffa-2b53096f4a2b`
- Live `200`: dataset health, graph health, graph metadata, legacy distance,
  coarse graph route, no-connector fallback, and identity route.
- Cold graph health and graph route completed successfully on production.
- Two immediate post-deploy requests briefly reached the previous version;
  sequential retries returned the expected `200` responses after propagation.

## Remaining Work

- None for this plan.
