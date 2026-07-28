---
title: Coarse Road Routing Production Smoke
date: 2026-07-28
status: passed
workerVersion: c50bcf38-2e86-45a1-bffa-2b53096f4a2b
---

# Coarse Road Routing Production Smoke

## Deployment

- URL: `https://vn-commune-distance-service.hoa.workers.dev`
- Worker: `vn-commune-distance-service`
- Commit deployed: `e22d520`
- Cloudflare version: `c50bcf38-2e86-45a1-bffa-2b53096f4a2b`
- Binding allowlist: `ASSETS`
- Static graph: `v1-3a10e35f335fe7cf`

## Live Checks

| Check | Status | Evidence |
|---|---:|---|
| `/health` | 200 | Dataset `2026.07.28`, 3,321 records |
| `/health/road-graph` | 200 | 102,507 nodes, 223,488 edges |
| `/meta/road-graph` | 200 | Matching graph version, SHA-256, and ODbL metadata |
| Legacy distance `00004 → 00008` | 200 | 2.25 km |
| Graph route `00004 → 00008` | 200 | `coarse-road-graph`, 3.27 km, Polyline6 with 15 points |
| Fallback `01304 → 00004` | 200 | `straight-line-fallback`, 269.88 km, `no-road-connector` |
| Identity `00004 → 00004` | 200 | 0 km, one-point Polyline6 |

## Propagation Note

Two parallel requests immediately after deployment briefly reached the previous
Worker version and returned its normalized `404`. Sequential retries after
propagation returned the expected `200`; no code or data change was required.
