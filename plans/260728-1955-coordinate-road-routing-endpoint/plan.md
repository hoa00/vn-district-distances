---
title: "Coordinate Road Routing Endpoint"
description: "Add a fast approximate road-distance endpoint for two WGS84 coordinates by snapping them through a compact offline spatial index."
status: done
priority: P1
branch: "main"
tags: [api, routing, cloudflare-workers, spatial-index, road-graph]
blockedBy: []
blocks: []
created: "2026-07-28T12:55:25.965Z"
createdBy: "ck:plan"
source: skill
---

# Coordinate Road Routing Endpoint

## Overview

Thêm endpoint độc lập:

`GET /api/v1/road-routes/points?originLat=...&originLng=...&destinationLat=...&destinationLng=...`

Mỗi điểm được chuẩn hóa đến E6, snap vào node gần nhất của static road graph, rồi dùng lại A*, Polyline6, giới hạn tìm kiếm và fallback hiện có. Mục tiêu là ước lượng tương đối, miễn phí, không gọi API bản đồ bên ngoài và không thay đổi contract của `GET /api/v1/road-routes`.

Cloudflare Workers Free hiện giới hạn 10 ms CPU/request, trong khi graph có 102.507 node. Vì vậy plan loại bỏ linear scan và việc dựng `Map` spatial index trong request lạnh; index lưới 0,05° được tạo offline và thêm vào binary VNRG v2 dưới dạng typed-array CSR, ước tính tăng khoảng 0,5 MB. Giới hạn nền tảng được kiểm tra từ [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/).

### Scope đã chốt

- Thêm route theo hai tọa độ WGS84; giữ nguyên route CommuneId.
- Chỉ snap vào node của coarse graph; chưa snap chính xác lên đoạn đường.
- Không geocoding, turn-by-turn, traffic, database, dịch vụ ngoài hoặc runtime dependency mới.
- Điểm nằm trong coverage bbox nhưng không có node trong 10 km trả `straight-line-fallback` với hệ số 1,3 và warning minh bạch.
- Điểm rõ ràng ngoài graph bbox mở rộng 10 km trả `422 OUTSIDE_ROAD_GRAPH_COVERAGE`; không trả một con số “road distance” toàn cầu sai nghĩa.
- Endpoint và graph v2 được deploy vào Worker/static assets production hiện tại sau khi qua release gates.

### Quyết định kiến trúc

1. Endpoint GET mới, không overload query CommuneId và không dùng POST.
2. VNRG ABI v2 thêm ba section: packed cell keys, cell offsets và node indices.
3. Loader tạo zero-copy typed views; lookup binary-search cell keys rồi chỉ chạy Haversine trên candidate nodes.
4. `RouteService` có thêm `calculatePoints()` nhưng route kernel A*/geometry/fallback chỉ có một bản dùng chung.
5. Identity sau chuẩn hóa E6 trả ngay mà không tải graph.
6. Node-only snapping được chấp nhận cho MVP; quality corpus sẽ đo sai số snap trước deploy. Segment index chỉ được xem xét ở phiên bản sau nếu gate thất bại.
7. GET được giữ để đồng nhất API hiện tại, nhưng response dùng `Cache-Control: private, no-store`; tài liệu/runbook cấm log raw query tọa độ. Nếu dữ liệu vị trí cá nhân trở thành use case chính, mở migration riêng sang POST.

### API contract dự kiến

```http
GET /api/v1/road-routes/points
  ?originLat=21.028511
  &originLng=105.804817
  &destinationLat=20.995138
  &destinationLng=105.866216
```

```json
{
  "originPoint": { "latitude": 21.028511, "longitude": 105.804817 },
  "destinationPoint": { "latitude": 20.995138, "longitude": 105.866216 },
  "distanceKm": 8.42,
  "straightLineDistanceKm": 7.42,
  "unit": "km",
  "approximate": true,
  "calculationMethod": "coarse-road-graph",
  "datasetVersion": "2026.07.28",
  "roadGraphVersion": "v2-...",
  "osmAsOf": "...",
  "route": { "encoding": "polyline6", "geometry": "...", "pointCount": 12 },
  "snaps": { "originDistanceKm": 0.08, "destinationDistanceKm": 0.12 },
  "warnings": []
}
```

### Data flow

`query validation → E6 normalization → identity short-circuit → load validated VNRG v2 → grid lookup (≤10 km) → ephemeral connectors → shared A* route kernel → Polyline6/fallback response`

### Alternatives đã loại

- Linear scan: hai snap tương đương hơn 205.000 phép đo/request.
- Runtime grid: ít thay đổi binary hơn nhưng đẩy CPU dựng index vào request lạnh, không phù hợp 10 ms CPU của Free plan.
- Overload `/api/v1/road-routes`: validation/OpenAPI mơ hồ và tăng regression risk.
- POST estimate: chưa cần body phức tạp và kém tiện cho cache/share URL.
- Edge-segment index: snap đẹp hơn nhưng tăng lớn độ phức tạp, kích thước và thời gian triển khai; hoãn sau quality gate.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Build Offline Spatial Index](./phase-01-build-offline-spatial-index.md) | Done |
| 2 | [Implement Coordinate Route API](./phase-02-implement-coordinate-route-api.md) | Done |
| 3 | [Validate Release and Deploy](./phase-03-validate-release-and-deploy.md) | Done |

## Dependencies

- Nền tảng đã hoàn thành: [`../260728-coarse-road-routing/plan.md`](../260728-coarse-road-routing/plan.md).
- Static asset/Worker production hiện có và quyền deploy đã được người dùng cho phép.
- Phase 2 phụ thuộc VNRG v2 và loader của Phase 1.
- Phase 3 phụ thuộc toàn bộ contract, runtime và test của Phase 1–2.

## Evidence từ codebase

- Route hiện tại chỉ nhận CommuneId và có contract riêng tại `src/app.ts:60-72`.
- Test override chỉ expose `RouteService.calculate` tại `src/app.ts:117-121`.
- Validation hook hiện trả thông báo chỉ dành cho CommuneId tại `src/app.ts:134-143`.
- A*, connector geometry, geometry cap và fallback đã tồn tại tại `src/services/route-service.ts:219-245`, `src/services/route-service.ts:310-442` và `src/services/route-service.ts:556-589`.
- VNRG v1 hiện cố định 13 section tại `src/data/load-road-graph.ts:3-27`; loader kiểm tra manifest/header chặt tại `src/data/load-road-graph.ts:106-190`.
- Pipeline Python đã dùng grid 0,05°/radius 3 cho commune snap tại `scripts/geo_pipeline/road_graph.py:313-355`.
- Release verifier đã kiểm SHA, content-addressed path và trần asset 25 MiB tại `scripts/verify-release.mjs:138-185`.

## Assumptions và rủi ro

- Schema vẫn kiểm WGS84 toàn cầu, nhưng service chỉ xử lý điểm trong graph bbox mở rộng 10 km; ngoài vùng trả 422.
- 0,05° với radius tính theo 10 km phải được kiểm bằng latitude band của graph, không hard-code `3` nếu công thức bảo thủ yêu cầu lớn hơn.
- Node graph đã contract có thể xa đường thực tế hơn nearest segment; quality corpus là release blocker.
- ABI v2 không backward-compatible; code + manifest + asset phải deploy atomically và rollback bằng Worker version cũ.
- Không cam kết “đường ngắn nhất tuyệt đối”; chỉ cam kết kết quả deterministic, bounded và có cảnh báo.

## Definition of Done

- Endpoint mới có OpenAPI, validation, shared routing kernel và đầy đủ fallback.
- Existing CommuneId API giữ nguyên response/error behavior và qua toàn bộ regression suite.
- Spatial index deterministic, mỗi graph node xuất hiện đúng một lần, loader từ chối asset hỏng.
- Asset vẫn dưới 25 MiB, decoded memory dưới 64 MiB và Worker dưới 128 MiB.
- Coordinate endpoint warm p95 ≤ 8 ms, p99 < 10 ms trên production-like corpus; không dựng JS grid khi request.
- Cold-load/first-route CPU cũng phải được đo và không gây Worker 1102; graph load failure có negative-cache/backoff để tránh retry storm.
- Quality corpus đạt ngưỡng đã định ở Phase 3 hoặc dừng deploy để đánh giá segment snapping.
- `npm run release:verify`, live smoke và rollback rehearsal đều đạt.

## Red Team Review

### Session — 2026-07-28

**Findings:** 15 (11 accepted, 4 rejected)  
**Severity breakdown:** 4 Critical, 9 High, 2 Medium

| # | Finding | Severity | Disposition | Applied To |
|---|---|---|---|---|
| 1 | Rollback giữ hai asset xung đột verifier “exactly one bin” | Critical | Accept | Phase 1, 3 |
| 2 | Không có hard gate cho cold-load CPU/retry storm | Critical | Accept | Phase 3 |
| 3 | Mở rộng toàn bộ validator v1 trước ABI v2 | Critical | Reject — pre-existing hardening vượt scope; vẫn thêm đầy đủ invariant cho ba section mới | — |
| 4 | ABI v2 bỏ sót manifest/public metadata callers | High | Accept | Phase 1, 2 |
| 5 | Global/polar input có thể làm nổ cell enumeration | High | Accept | Phase 1, 2 |
| 6 | Ephemeral connector không tương thích offset connector hiện tại | High | Accept | Phase 2 |
| 7 | Geometry overflow dùng sai warning `search-budget-fallback` | High | Accept | Phase 2 |
| 8 | Geometry guard chạy sau full allocation/encoding | High | Accept | Phase 2, 3 |
| 9 | Metadata/identity smoke không chứng minh asset đã load | Medium | Accept | Phase 3 |
| 10 | Plan có thể xóa commune connector `Map` | High | Reject — plan chỉ cấm spatial `Map`; bổ sung câu giữ connector map để tránh hiểu sai | Phase 1 |
| 11 | Shared kernel bị đánh giá quá mỏng vì fallback commune-shaped | High | Accept | Phase 2 |
| 12 | Global Hono validation hook va chạm coordinate errors | High | Reject — Phase 2 đã chỉ rõ refactor và regression contract | — |
| 13 | Public endpoint thiếu auth/rate limiting | High | Reject — dự án chủ đích public/free; bounded cell/candidate/A* budgets là control trong scope | — |
| 14 | GET làm tọa độ lọt vào cache/log/history | High | Accept (modified) — giữ GET, thêm no-store và log-redaction; POST là follow-up khi xử lý dữ liệu nhạy cảm | Phase 2, 3 |
| 15 | Ngoài coverage trả ước lượng road distance sai nghĩa | Medium | Accept | Plan, Phase 2 |

### Whole-Plan Consistency Sweep

- Decision delta đã được truyền xuyên suốt: coverage 422, bounded snap, resolved connector, truthful output-limit warning, cold gate, no-store và Cloudflare version rollback.
- Đã tìm và loại các claim cũ về “global fallback”, giữ hai `.bin` trong tree, warm-only gate và raw connector-offset reuse.
- `plan.md`/ba phase thống nhất endpoint, error codes, ABI v2, threshold 1/10 km và deploy gates.
- Không còn contradiction chưa giải quyết; edge-segment snapping và auth/rate-limit được ghi rõ là ngoài scope.

## Validation Log

### Verification Results — 2026-07-28

- Tier: Standard (Fact Checker + Contract Verifier)
- Claims checked: 30
- Verified: 28
- Failed: 2, đã sửa:
  - current verifier chỉ cho đúng một graph `.bin` (`scripts/verify-release.mjs:219-227`);
  - public graph manifest/Zod contract cũng hard-code schema 1 (`src/contracts.ts:132-150`, `src/schemas/api.ts:100-120`).
- Unverified: 0
- Whole-plan consistency sweep: pass; không còn API/file/symbol/dependency conflict đã biết.
