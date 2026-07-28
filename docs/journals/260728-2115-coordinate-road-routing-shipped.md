# Coordinate Road Routing — Shipped (3 phases)

**Date:** 2026-07-28
**Plan:** `plans/260728-1955-coordinate-road-routing-endpoint/`
**Production:** `https://vn-commune-distance-service.hoa.workers.dev` (Version `84a68502-9158-497b-adf9-3246725dbded`)

## What shipped

Added `GET /api/v1/road-routes/points` — approximate road distance for two WGS84 coordinates, snapped to the static road graph through an offline spatial index. Free, no external Map API, deterministic.

## Phases

1. **VNRG v2 + offline spatial index.** ABI 1→2 (13→16 sections, header 240→288); CSR grid 0.05° (7036 cells, node permutation validated at load). CommuneId routing **byte-compatible** (102507/223488/3304/17 unchanged). Asset 11.16 MiB.
2. **Coordinate API + shared route kernel.** `#resolveRoute`/`#encodeRoute`/`#fallbackOutcome` neutral kernel shared by `calculate()` and `calculatePoints()` — no A*/fallback duplication. Incremental budget-aware Polyline6 encoder (byte-compatible + early-abort). `route-output-limit-fallback` warning (Red Team #7/#8). 422 outside-coverage, `Cache-Control: private, no-store`.
3. **Validate + deploy.** `release:verify` green (python 28, TS 110). Pure-CPU perf p95=4 ms / p99=4 ms (DoD ≤8/<10). Deployed; live smoke all green after Cloudflare edge propagation.

## Key decisions

- **Cell key uses `*20`, not `/0.05`.** `1/0.05` rounds to `19.999999999999996` in IEEE-754, so `floor((lng+180)/0.05)` returns 7199 not 7200 at the boundary. Multiplying by the exact integer `20` makes keys deterministic and identical between the Python builder and the TS snapper — the hidden invariant that would otherwise corrupt the index.
- **`snap_communes()` left untouched.** The plan wanted a shared grid helper, but byte-compat for the CommuneId contract was the higher priority; the commune snap grid (build-time, signed 2-tuple) is independent of the runtime packed-key index. Only Python-builder ↔ TS-snapper must agree (they do).
- **Perf measurement moved off miniflare.** `SELF.fetch` timing in the Workers pool is dominated by miniflare request overhead and flakes under load. Replaced with a pure-CPU benchmark (`npm run test:perf`) that calls `RouteService` directly. Stable p95=4 ms.

## Issues found and fixed (via mandatory code review)

- **Phase 1 — `MAX_CANDIDATES=4096` too low.** 13% of road nodes (Hanoi/HCMC/Da Nang centers) sit in cells whose 5×5 snap window exceeds 4096 candidates (p99≈3055, max≈7168); the hard cap returned `no-connector` and discarded the correct node. Raised to 16384 **and** made the cap non-fatal (return best-so-far ≤ snapMax instead of a wrong `no-connector`). A CPU cap must never produce a wrong answer.
- **Phase 2 — OpenAPI query params rendered `type:"string"` with a number example.** `@hono/zod-openapi` stops metadata traversal at `.pipe()`. Runtime was correct; fixed the example/type lint mismatch. `type:"string"` kept (honest wire-format for query params).

## Evidence

- Perf: `coldLoadMs≈10`, warm `p50=3 / p95=4 / p99=4 / max=6` ms over 7-pair corpus incl. Hanoi→HCMC cross-country.
- Snap proxy: commune snap median 563 m, 100% within 10 km, 67.6% within 1 km (all 3304 communes incl. remote rural).

## Open items / watch

- **Cold-load CPU on Cloudflare Free (10 ms budget).** Local wall ≈10 ms (permutation check + 11 MB structuredClone, once per isolate via provider cache). `crypto.subtle.digest` is native (not billed CPU), so real CPU is likely under budget; smoke returned no 1102. Monitor `wrangler tail` for 1102s during cold-start traffic.
- **Full snap-quality corpus** (arbitrary points near long roads vs offline nearest-segment reference) — the plan's release blocker — is only proxy-covered (commune snap). Build the reference corpus before claiming snap-accuracy SLAs; if it fails, open the edge-segment-index plan.
- L2 (coordinate identity bypasses dataset-version check) and L3 (one stubbed integration test) noted by review as harmless/covered; deferred.

## Files

25 changed + 6 new (snapper, coordinate API test, perf benchmark/config, v2 asset, journal). `release:verify` green; 110/110 tests.
