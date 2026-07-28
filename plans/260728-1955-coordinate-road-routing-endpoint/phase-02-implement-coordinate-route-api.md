---
phase: 2
title: "Implement Coordinate Route API"
status: pending
effort: "1.0-1.5 days"
---

# Phase 2: Implement Coordinate Route API

## Overview

Thêm additive API contract và nối ephemeral coordinate connectors vào cùng route kernel hiện có. Không đổi JSON, status code hay operationId của CommuneId endpoint.

## Implementation Steps

### 1. Khóa contract bằng tests

- Thêm `coordinateRoadRouteQuerySchema` trong `src/schemas/api.ts`:
  - bốn query string bắt buộc;
  - trim/non-empty rồi parse number;
  - reject `NaN`, `Infinity`, lat ngoài `[-90, 90]`, lng ngoài `[-180, 180]`;
  - normalize tới 6 chữ số thập phân.
- Thêm shared route envelope và `CoordinateRoadRouteResponse` trong `src/contracts.ts`, với `originPoint`/`destinationPoint`.
- Thêm error code `OUTSIDE_ROAD_GRAPH_COVERAGE`; coordinate endpoint document `422`, không dùng 404.
- Giữ `RoadRouteResponse` CommuneId byte-compatible; chỉ factor type nội bộ, không rename public fields.
- Thêm coordinate response Zod schema và contract assertions trong `tests/contracts/contracts.test.ts`.
- Mở rộng `tests/contract/openapi.test.ts`:
  - path `/api/v1/road-routes/points`;
  - operationId `getApproximateRoadRouteByPoints`;
  - documented `200/400/422/500/503`;
  - không có `404`;
  - existing commune path unchanged.

### 2. Refactor một route kernel dùng chung

- Trong `src/services/route-service.ts`, tách phần từ connector → search → route/fallback khỏi `calculate()` (`src/services/route-service.ts:353-442`) thành private/shared kernel nhận:
  - normalized origin/destination points;
  - `ResolvedConnector { node, snapMeters, points }` hoặc `undefined`;
  - response adapter cho CommuneId hoặc point wrapper.
- Decode static connector offsets thành `ResolvedConnector`; snapper tạo cùng type với inline points. Kernel không được cast ephemeral connector thành `RoadGraphConnector`.
- Giữ nguyên search node cap, ferry warning, geometry cap 96 KiB (`src/services/route-service.ts:20`, `src/services/route-service.ts:397-407`) và fallback factor 1,3 (`src/services/route-service.ts:556-589`).
- `calculate(originCommuneId, destinationCommuneId)` tiếp tục lookup repository/connectors như hiện tại.
- Thêm `calculatePoints(originPoint, destinationPoint)`:
  - identity nếu hai E6 points bằng nhau; không gọi provider;
  - non-identity load graph, gọi snapper hai lần;
  - connector không tồn tại trong 10 km → 200 fallback, `no-road-connector`, snap null;
  - route được nhưng snap >1 km → thêm `long-road-snap`;
  - graph corrupt/unavailable → `RoadGraphUnavailableError`.
- Geometry luôn bắt đầu/kết thúc tại input E6; distance road bao gồm hai snap legs.
- Tách fallback thành common calculation result và hai response adapters; không để shared kernel nhận `CommuneCentroid` hoặc hard-code ID fields.
- Thêm `route-output-limit-fallback`; không dùng `search-budget-fallback` khi A* đã thành công nhưng output quá lớn.
- Route assembly/Polyline6 encoding phải budget-aware và dừng trước full point/string allocation; gate full serialized JSON, không chỉ geometry string.
- Không tạo `point-route-service.ts` nếu điều đó làm duplicate A*/fallback.

### 3. Đăng ký route Hono/OpenAPI

- Thêm route definition/handler ở `src/app.ts`, cạnh existing definition `src/app.ts:60-72`.
- Mở rộng `AppOverrides.roadRouteService` tại `src/app.ts:117-121` để tests inject cả `calculate` và `calculatePoints`.
- Refactor `defaultHook` tại `src/app.ts:134-143`: không trả message CommuneId cho lỗi coordinate; dùng route-specific/generic validation message nhưng giữ body cũ cho existing CommuneId test nếu contract đang phụ thuộc.
- Handler:
  - `200` cho identity/graph/fallback;
  - `400 INVALID_REQUEST` cho schema;
  - `422 OUTSIDE_ROAD_GRAPH_COVERAGE` nếu origin hoặc destination ngoài bbox mở rộng 10 km;
  - `503 ROAD_GRAPH_UNAVAILABLE` cho graph lỗi;
  - `500 INTERNAL_ERROR` cho unexpected;
  - không phát `COMMUNE_NOT_FOUND`.
- Caching service/provider giữ như `getRoadRouteService()` tại `src/app.ts:218-237`.
- Coordinate responses đặt `Cache-Control: private, no-store`; không log raw query values trong error/observability paths.
- `wrangler.jsonc` đã chạy Worker trước cho `/api/*`; chỉ thêm regression assertion, không đổi binding.

### 4. Unit/integration tests

- `tests/unit/road-node-snapper.test.ts`: same/neighbor/boundary cells, deterministic tie, max radius, no candidate, negative zero, exact endpoint geometry.
- Bổ sung pole, antimeridian, outside bbox, hard cell cap, hard candidate cap và dense-cell fixtures.
- `tests/unit/route-service.test.ts`: identity không load graph, graph route, no connector, long snap, disconnected graph, budget exhausted, geometry cap, ferry warning, provider/schema failure.
- Tách test `search-budget-fallback` và `route-output-limit-fallback`; fixture output lớn phải abort trước full materialization.
- Tạo `tests/integration/coordinate-route-api.test.ts`: valid route, same point, missing/empty/non-finite/out-of-range, ocean/no-node bên trong bbox fallback, ngoài bbox 422, 503 và unexpected 500.
- Cập nhật `tests/integration/route-api.test.ts` để prove existing commune handler/override/404 vẫn nguyên.
- Mở rộng `tests/integration/worker-entry.test.ts` bằng real static asset coordinate corpus và assert response geometry ≤100 KiB.
- Không snapshot toàn OpenAPI nếu làm test dễ vỡ; assert chính xác path, parameters, required fields và response codes.

### 5. Tài liệu contract

- Cập nhật `README.md` và `docs/api-usage.md` với curl/response/validation/fallback examples.
- Cập nhật `docs/tech-stack.md`: offline spatial CSR và không có external routing API.
- Ghi rõ “approximate coarse-road distance”, OSM as-of, node-only snap, 10 km limit và fallback factor; không quảng cáo shortest path trên full road network.
- Ghi coverage Vietnam/422, `Cache-Control: private, no-store` và policy không ghi raw lat/lng vào access/application logs.

## Success Criteria

- [ ] Endpoint mới trả contract point-specific và OpenAPI hợp lệ.
- [ ] Identity sau E6 normalization không tải graph.
- [ ] Invalid coordinates luôn trả `400 INVALID_REQUEST`; không có coordinate `404`.
- [ ] No connector trả transparent fallback; graph unavailable vẫn trả 503.
- [ ] Hai endpoints dùng chung A*/geometry/fallback kernel, không duplicate route algorithm.
- [ ] Existing CommuneId API qua toàn bộ unit/integration/contract regression.
- [ ] Route geometry endpoints khớp input sau chuẩn hóa E6.

## Compatibility Matrix

| Scenario | HTTP | Method | Warning |
|---|---:|---|---|
| Same E6 point | 200 | `identity` | none |
| Both snap + path found | 200 | `coarse-road-graph` | optional ferry/long snap |
| Any point no node ≤10 km | 200 | `straight-line-fallback` | `no-road-connector` |
| Disconnected/search cap | 200 | `straight-line-fallback` | existing graph/search warning |
| Route output cap | 200 | `straight-line-fallback` | `route-output-limit-fallback` |
| Invalid query | 400 | n/a | n/a |
| Point outside graph coverage | 422 | n/a | n/a |
| Graph unavailable, non-identity | 503 | n/a | n/a |

## Out of Scope

- Geocoding/place names, country polygon rejection, live traffic, instructions, multiple waypoints.
- Exact snapping to edge geometry and inserting virtual graph nodes.
- Changing CommuneId response fields or current operational endpoints.
