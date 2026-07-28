---
title: Coarse Road Routing Progress
date: 2026-07-28T19:29:12+07:00
status: in-progress
plan: 260728-coarse-road-routing
---

# Coarse Road Routing Progress

## Summary

| Phase | Status | Evidence |
|---|---|---|
| 1. Build graph | Completed | 10,697,248-byte content-addressed artifact; 3,321 exact connector IDs |
| 2. Runtime and API | Completed | A*, Polyline6, identity, transparent fallback, health and metadata |
| 3. Release and deploy | In progress | Release gate green; production deploy awaits explicit approval |

## Quality Gates

- Python: 26 passed.
- Vitest: 83 passed across 13 files.
- Typecheck and Wrangler dry-run: passed.
- Worker bundle: 229,938 bytes gzip.
- Estimated decoded graph memory: 15,696,168 bytes.
- Warm route corpus: p95 ≤6 ms and p99 <9 ms.
- Route response geometry: hard-capped before the 100 KiB response budget.
- Independent code re-review: no remaining blocker.

## Remaining Work

1. Obtain explicit production-deploy approval accepted by the action gate.
2. Deploy with Wrangler.
3. Smoke health, metadata, legacy distance, graph route, and fallback route.
4. Record production URL/evidence and mark phase 3 complete.

## Blocker

- Production state change rejected by the approval gate. No workaround attempted.
