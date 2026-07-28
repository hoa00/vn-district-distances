---
phase: 1
title: "Build Offline Spatial Index"
status: pending
effort: "1.0-1.5 days"
---

# Phase 1: Build Offline Spatial Index

## Overview

Nâng static road graph từ VNRG v1/13 section lên v2/16 section và tạo spatial index offline. Runtime chỉ nhận zero-copy `Uint32Array`, không quét 102.507 node và không dựng object graph trong request.

Mô hình index:

- `cellSizeDegrees = 0.05`.
- Cell key unsigned: `row = floor((lat + 90) / 0.05)`, `column = floor((lng + 180) / 0.05)`, `key = row * 7201 + column`.
- Section 14: sorted unique `SPATIAL_CELL_KEYS`.
- Section 15: `SPATIAL_CELL_OFFSETS`, dài `cellCount + 1`.
- Section 16: `SPATIAL_NODE_INDICES`, dài đúng `nodeCount`.
- Mỗi bucket sort node index tăng dần; tie Haversine chọn node index nhỏ hơn để build/runtime deterministic.
- Lookup duyệt các cell có thể giao vòng tròn 10 km, dùng bounding theo latitude hiện tại rồi đo Haversine chính xác cho candidates.
- Manifest lưu graph bbox; điểm ngoài bbox mở rộng 10 km bị loại trước cell enumeration. Lookup có hard cap số cell và candidates để bảo vệ CPU.

## Implementation Steps

### 1. Viết test ABI/index trước

- Mở rộng `tests/python/test_road_graph.py` để assert schema `2`, section count `16`, data offset `288`, byte alignment, sorted keys, monotonic offsets và index coverage.
- Thêm cases: empty/one cell, neighbor-cell lookup fixture, duplicate coordinate, tie-break, node ở biên cell và deterministic bytes qua hai lần build.
- Mở rộng `tests/unit/load-road-graph.test.ts` với valid v2 fixture và corruption cases: thiếu section, sai width/order/count, key trùng/không sort, offsets giảm, final offset sai, node index out of range/duplicate.
- Giữ regression fixture chứng minh loader từ chối v1 khi manifest/code yêu cầu v2; không hỗ trợ dual ABI trong runtime.

### 2. Tạo index trong pipeline

- Sửa constants/serializer tại `scripts/geo_pipeline/road_graph.py:17-65`:
  - `SCHEMA_VERSION = 2`, `SECTION_COUNT = 16`, `HEADER_BYTES = 288`.
  - thêm ID 14–16 và constants của grid profile.
- Tách helper grid dùng chung với logic đang tồn tại ở `scripts/geo_pipeline/road_graph.py:313-355`; không để commune snap và serialized runtime index có hai công thức cell khác nhau.
- Build index từ `graph.nodes` sau contraction, vì runtime chỉ route được các node đã serialize.
- Serialize ba array little-endian, kiểm mỗi node đúng một lần, không duplicate/out-of-range, cell keys tăng dần, offsets bắt đầu 0/kết thúc `nodeCount`.
- Thêm manifest fields `spatialCellSizeDegrees`, `spatialCellCount`, `spatialIndexNodeCount`, `snapMaximumMeters` và đưa profile vào `routingProfileHash`.
- Thêm manifest graph bounds (`minimumLatitude`, `maximumLatitude`, `minimumLongitude`, `maximumLongitude`) để runtime coverage-check O(1), kể cả pole/antimeridian inputs.
- Duy trì deterministic ordering và content-addressed asset SHA.

### 3. Nâng loader zero-copy

- Sửa `ROAD_GRAPH_SCHEMA_VERSION`, section constants, offsets và `EXPECTED_WIDTHS` trong `src/data/load-road-graph.ts:3-100`.
- Mở rộng `RoadGraph` tại `src/data/load-road-graph.ts:48-60` bằng ba readonly typed views.
- Giữ nguyên `connectors: ReadonlyMap<string, RoadGraphConnector>` cho CommuneId routing; “không Map” chỉ áp dụng cho spatial index mới.
- Bổ sung invariant semantic sau parse:
  - keys strict ascending;
  - offsets monotonic, đúng length và range;
  - node indices tạo permutation `[0, nodeCount)`;
  - manifest index counts khớp binary.
- Giữ checksum, dataset pinning, alignment và `structuredClone(...transfer)` hiện có tại `src/data/load-road-graph.ts:106-190` và `src/data/load-road-graph.ts:284-307`.
- Không tạo `Map<number, number[]>`; lookup dùng binary search trên keys và slice offsets.
- Bump và đồng bộ `RoadGraphManifest` tại `src/contracts.ts`, graph metadata schema tại `src/schemas/api.ts`, `/meta/road-graph` response tests và schema assertion trong `scripts/verify-release.mjs`.

### 4. Implement nearest-node lookup

- Tạo `src/services/road-node-snapper.ts` với pure functions:
  - normalize WGS84 point → E6 và normalize `-0`;
  - compute cell/radius;
  - binary-search a cell key;
  - return `{node, snapMeters, geometry}` hoặc `undefined`.
- Chỉ Haversine candidate nodes; `Math.ceil` snap meters để đồng nhất builder (`scripts/geo_pipeline/road_graph.py:339-355`).
- Max radius 10.000 m; long-snap warning threshold vẫn 1.000 m.
- Trước lookup, check bbox mở rộng 10 km; ngoài coverage trả typed outcome cho handler 422. Clamp cell rows/columns, special-case ±90°/±180°, và fallback/error deterministic nếu chạm hard cell/candidate budget.
- Ephemeral connector geometry gồm input point → snapped node, đủ để dùng route geometry hiện có.
- Không dùng country polygon; bbox là guard rẻ và đủ đúng với phạm vi coarse graph.

### 5. Regenerate và verify artifact

- Regenerate graph từ nguồn OSM đã pin, cập nhật `src/data/road-graph-manifest.json` và thay content-addressed file dưới `public/road-graph/`.
- Mở rộng `scripts/verify-release.mjs:138-185` để kiểm schema v2, 16 directory entries, grid manifest, permutation và trần kích thước.
- Ghi số liệu trước/sau: asset bytes, cell count, max/p95 nodes per queried neighborhood, decoded memory estimate.
- Repo/release artifact vẫn chứa đúng một `.bin` để thỏa `scripts/verify-release.mjs:219-227`. Rollback dựa vào Cloudflare deployment version cũ (code + manifest + versioned asset), không giữ hai asset trong tree hiện tại.
- Trước deploy, preflight v2 phải load bundled manifest/binary bằng chính runtime loader; sau deploy phải xác minh URL hash cũ còn phục vụ từ deployment rollback target.

## Success Criteria

- [ ] Python/TypeScript ABI tests đỏ trước, xanh sau.
- [ ] VNRG v2 có đúng 16 section, deterministic và checksum/content path khớp.
- [ ] Mỗi node xuất hiện đúng một lần trong spatial index.
- [ ] Runtime loader chỉ tạo typed-array views, không tạo grid object per isolate/request.
- [ ] Nearest-node lookup trả kết quả deterministic cho cell boundary/tie/no-node.
- [ ] Pole/antimeridian/outside-bbox inputs không enumerate grid và snap lookup không vượt hard cell/candidate budgets.
- [ ] `RoadGraphManifest`, metadata schema, loader, binary header và verifier cùng báo schema/counts/bounds v2.
- [ ] Asset < 25 MiB, decoded graph < 64 MiB, tổng Worker memory estimate < 128 MiB.
- [ ] `npm run data:road-graph:validate` và phần graph của `npm run release:verify` đạt.

## Risks and Controls

- **Radius theo longitude:** số cell cần quét thay đổi theo latitude; tính bounding bảo thủ và kiểm trên toàn graph bounds.
- **Dense cell:** ghi distribution vào release report; nếu p99 candidates quá lớn, giảm cell size trước khi chấp nhận artifact.
- **Node-only snap:** có thể bỏ qua điểm gần giữa cạnh dài; chưa mở rộng scope, nhưng Phase 3 đo corpus và block deploy khi sai số không chấp nhận được.
- **Atomic ABI:** loader v2 không đọc asset v1; manifest, binary và Worker phải cùng version.
