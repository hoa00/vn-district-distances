# Research / Validation / Planning Chốt Scope MVP

**Date**: 2026-07-28 12:09
**Severity**: High
**Component**: Commune distance service MVP
**Status**: Implementation resumed with OSM/ODbL; release blocked on `3,321/3,321`

## What Happened

Phiên research/validation/planning hôm nay đã khóa scope cho service khoảng cách giữa các đơn vị cấp xã hiện hành của Việt Nam. Quyết định cuối cùng là giữ MVP nội bộ trên Hono + Cloudflare Workers, không mở rộng sang auth, rate limit, runtime DB, runtime R2 binding, dashboard hay đồng bộ định kỳ.

Danh mục chuẩn đã chốt là 3.321 đơn vị cấp xã hiện hành, không dùng mô hình `District` cũ vì cấp huyện đã kết thúc từ 01/07/2025. Khoảng cách sẽ tính giữa centroid hình học của polygon, không dùng trụ sở hành chính hay bbox thay thế. Dữ liệu runtime sẽ là static combined dataset; raw archive giờ nằm trong local SHA-256 content-addressed archive được Git ignore.
Revalidation hôm nay xác nhận eKMap/public-R2 path chỉ còn là lịch sử; kiến trúc hiện tại dùng official NSO/Decision 19 catalog cộng pinned Geofabrik Vietnam OSM PBF dưới ODbL 1.0. Hoàng Sa được xử lý qua reviewed override, không fabricating geometry.

## The Brutal Truth

Chúng ta không thể giả vờ phần geometry đã ổn. Cái đang chặn Phase 2 và release là quyền sử dụng geometry: chưa có bằng chứng đủ mạnh để lấy, lưu, và phát hành derived centroid cho toàn bộ 3.321 đơn vị. Đó là điểm đau thật, không phải chuyện phụ. Nếu bỏ qua, chúng ta sẽ tự đẩy mình vào một service “chạy được” nhưng không đứng được về mặt dữ liệu và license.

## Technical Details

- Scope được giữ ở mức MVP nội bộ: Hono + Cloudflare Workers, TypeScript strict, OpenAPI + Scalar.
- Dataset phải reconcile đúng `3.321/3.321` mã 5 chữ số, giữ leading zero, và fail closed nếu thiếu/trùng/malformed.
- Centroid pipeline chốt theo `EPSG:4326 -> EPSG:6933 -> EPSG:4326`, có repair topology khi cần.
- Raw archive nằm trong local SHA-256 content-addressed archive; Worker không có cloud storage binding, không truy cập archive lúc runtime.
- Không dùng D1, KV, auth, rate limit, hay runtime DB vì chỉ là lookup trên snapshot tĩnh.
- API và Scalar phải pin CDN + CSP, không dùng asset `latest`.
- Validation/decision log đã chốt theo red-team và 5 câu:
  - 1A: existence-first same-ID
  - 2A: dataset-level `503` cho invalid bundled centroid
  - 3A: fail closed cho đến khi relation thật reconcile đủ
  - 4B: local SHA-256 archive
  - 5A: pinned CDN + CSP cho Scalar

## What We Tried

- Đối chiếu PRD, research report, centroid build plan, và plan 5 phase để loại bỏ các quyết định cũ đã lỗi thời.
- So sánh runtime static JSON với KV/D1 và giữ static dataset vì đơn giản hơn, rẻ hơn, ít bề mặt lỗi hơn.
- Chốt `TDD` làm kỷ luật triển khai để không trượt từ contract sang implementation mơ hồ.

## Root Cause Analysis

Vấn đề gốc không phải kỹ thuật Hono hay Cloudflare mà là data governance. Hướng eKMap/private-R2 đã được thay bằng OSM/ODbL; blocker reconciliation sau đó được giải quyết bằng Geofabrik snapshot cộng hai full OSM island relations, với provenance riêng cho Hoàng Sa override. Artifact cuối đã reconcile đủ `3.321/3.321`.

## Lessons Learned

- Đừng bắt đầu implementation trước khi quyền dữ liệu được viết ra thành evidence, không phải niềm tin.
- Static snapshot là đúng cho MVP này; runtime storage động chỉ làm phình bề mặt lỗi mà không giải quyết gì.
- Centroid hình học là yêu cầu cứng, nên mọi shortcut kiểu admin-seat/bbox chỉ tạo ra nợ kỹ thuật và nợ dữ liệu.
- Giữ scope internal là quyết định đúng; thêm auth/rate-limit lúc này chỉ che đi vấn đề thật.

## Next Steps

- Owner: data/research. Pin Geofabrik snapshot, giữ `data/relation-overrides.csv` làm evidence cho Hoàng Sa, và xác nhận `3,321/3,321`.
- Owner: platform/runtime. Giữ nguyên hợp đồng Hono + Workers, static runtime dataset, pinned Scalar, local SHA archive, và TDD.
- Timeline: làm xong blocker dữ liệu trước khi tuyên bố release-ready; nếu chưa có quyền geometry thì dừng ở trạng thái blocked, không tự nhảy sang code.

## Open-source resumption — 2026-07-28

User đã supersede quyết định eKMap/private R2 bằng hướng miễn phí/open-source và yêu cầu tiếp tục triển khai. Active source là official NSO/Decision 19 catalog cộng timestamped Geofabrik Vietnam OSM PBF dưới ODbL 1.0; raw input dùng local SHA-256 content-addressed archive được Git ignore.

Live audit ban đầu đếm `3.320` relation `boundary=administrative`, `admin_level=6`. Bản phát hành đã bổ sung hai full relation snapshot bị thiếu khỏi Geofabrik clip và đạt `3.321/3.321`; runtime vẫn fail closed nếu count/provenance trôi. OSM attribution, ODbL URL và share-alike/derivative-database notice là release gates. Không dùng eKMap, R2, paid API hoặc polygon giả.
