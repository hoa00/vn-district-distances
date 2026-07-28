---
phase: 3
title: "Validate Release and Deploy"
status: pending
effort: "0.5-1.0 day"
---

# Phase 3: Validate Release and Deploy

## Overview

Chạy hard release gates, định lượng chất lượng node snapping, deploy Worker + static graph v2 atomically lên Cloudflare production và xác minh live. Nếu quality/performance gate không đạt thì không deploy.

## Implementation Steps

### 1. Full verification

- Chạy theo thứ tự:
  1. Python graph tests.
  2. Typecheck/lint/unit/integration/contract tests.
  3. Production-like Workers integration với real asset.
  4. `npm run release:verify`.
- Release verifier phải kiểm graph v2 schema/directory/checksum, exact dataset pin, ODbL metadata, index coverage, asset <25 MiB, decoded <64 MiB và estimated memory <128 MiB.
- Preflight dùng cùng bundled manifest và runtime loader; metadata, loader, binary header và verifier phải cùng schema/counts/bounds.
- So sánh response fixtures của `/api/v1/road-routes` trước/sau để bảo vệ contract CommuneId.

### 2. Performance gate

- Benchmark ít nhất 100 coordinate pairs gồm đô thị dày, nông thôn, đảo, biên graph, same-cell, cross-country và no-connector.
- Đo riêng:
  - candidate count và snap CPU cho mỗi endpoint;
  - A* CPU;
  - total warm p50/p95/p99;
  - cold asset fetch/load (ghi riêng, không trộn warm percentile).
- Gate:
  - warm endpoint p95 ≤8 ms, p99 <10 ms;
  - cold first non-identity route phải hoàn tất trong Cloudflare Free CPU envelope và không sinh 1102; đây là hard gate, không chỉ số liệu tham khảo;
  - không có request linear scan/dựng grid;
  - response ≤100 KiB;
  - không vượt search cap/memory ngoài fallback có chủ đích.
- Nếu p99 snap cao: điều chỉnh cell size/index distribution ở Phase 1, không tăng CPU limit hoặc thêm dịch vụ trả phí.
- Test 404/truncated/checksum mismatch/ABI mismatch: concurrent callers dùng chung một loading promise; failure được negative-cache với TTL/backoff, không hash/retry asset trên mọi request.
- `/health/road-graph` phải phân biệt `unloaded`/`loading`/`ready`/`degraded`; probe không được tự gây retry storm.

### 3. Snap-quality gate

- Tạo corpus có tọa độ gần các đoạn đường dài nơi contracted node thưa; so node snap với nearest raw-road node/segment reference offline.
- Ghi p50/p95/max snap delta và tỷ lệ graph-route vs fallback.
- Acceptance ban đầu phù hợp yêu cầu “tương đối”:
  - ≥95% điểm test trong vùng có đường lớn tìm được connector ≤1 km;
  - 100% trường hợp >10 km fallback minh bạch;
  - không route qua node sai đảo/khối graph trong corpus thủ công.
- Nếu không đạt, dừng deploy và mở plan riêng cho edge-segment index; không lén mở rộng phase này.

### 4. Docs/runbook và release evidence

- Cập nhật `docs/data-refresh-runbook.md` để graph refresh luôn tạo/validate spatial index.
- Ghi artifact SHA, graphVersion, counts, size, test totals, performance/quality tables và rollback target trong plan-scoped report.
- Kiểm OpenAPI docs, README curl và warning semantics khớp runtime.
- Audit response headers và logging config để raw coordinate query không bị cache hoặc ghi vào application logs; ghi rõ hạ tầng access-log bên ngoài ứng dụng là operational responsibility.

### 5. Production deploy

- Xác nhận clean intended diff và `npm run release:verify` lần cuối.
- Deploy Worker cùng content-addressed VNRG v2 asset bằng workflow hiện có; lưu deployment/version ID.
- Live smoke:
  - same-point identity;
  - cặp Hà Nội có graph route;
  - cặp ocean/no-node nhưng vẫn trong bbox có fallback;
  - malformed coordinate 400;
  - outside coverage 422;
  - existing CommuneId normal/404;
  - `/health`, `/health/road-graph`, `/meta/road-graph`.
- Non-identity graph route phải chạy trước; sau đó mới assert ready health và metadata cùng `graphVersion`/SHA. Identity hoặc metadata riêng lẻ không được tính là asset-readiness evidence.

### 6. Rollback

- Rollback bằng Cloudflare deployment version v1 đã ghi nhận, đưa code + manifest + asset namespace về cùng trạng thái. Không sửa tay manifest và không giữ hai `.bin` trong release tree.
- Smoke lại health + CommuneId sau rollback.
- Trigger rollback khi: 1102/resource limit, graph 503 tăng, checksum mismatch, p99 ≥10 ms lặp lại, contract regression hoặc quality corpus sai tuyến nghiêm trọng.
- Không xóa deployment/version v1 trên Cloudflare cho tới khi v2 ổn định qua thời gian quan sát đã thống nhất; release tree hiện tại vẫn chỉ có một `.bin`.
- Trước khi gọi deploy “rollback-ready”, fetch/smoke deployment target cũ và xác nhận asset hash v1 còn truy cập được.

## Success Criteria

- [ ] Toàn bộ Python/TypeScript/Worker/OpenAPI/release tests đạt.
- [ ] CommuneId contract và behavior không regression.
- [ ] Performance, memory, response-size và snap-quality gates đạt có evidence.
- [ ] Documentation/runbook phản ánh đúng ABI v2 và endpoint.
- [ ] Production deploy trả graphVersion/SHA mong đợi.
- [ ] Toàn bộ nhóm live smoke liệt kê ở bước 5 đạt và rollback target được xác nhận.
- [ ] Không có secret, external runtime dependency hoặc paid service mới.

## Deliverables

- VNRG v2 content-addressed graph + manifest.
- New coordinate API/OpenAPI contract.
- Test/performance/quality evidence report.
- Updated API and data-refresh documentation.
- Deployment ID, live smoke results và rollback ID.
