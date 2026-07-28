---
type: research-report
status: approved
conducted_at: 2026-07-28T12:09:15+07:00
scope: internal-mvp
---

# Research Report: Current Vietnam Commune Distance Service

> Approved as feasibility research. API/error/artifact details were later superseded by the validated [implementation plan](../plans/260728-1345-commune-distance-service/plan.md).

## Summary

Service khả thi cho MVP nội bộ. Phải đổi đối tượng từ cấp huyện đã kết thúc hoạt động sang 3.321 đơn vị cấp xã hiện hành: xã, phường, đặc khu.

Danh mục mã/tên có nguồn chính thức đủ mạnh. Geometry hiện hành là điểm rủi ro: chưa tìm thấy một bulk dataset công khai vừa đủ 3.321 polygon, khớp mã chính thức, có giấy phép tái sử dụng rõ ràng. MVP chỉ được xem là validated khi pipeline đối chiếu đủ `3.321/3.321` mã và lưu provenance/hash.

Kiến trúc khuyến nghị: một Hono Worker, dataset centroid JSON đóng băng theo version, lookup bằng bảng tra cứu trong memory, OpenAPI + Scalar. Không D1, KV, auth, rate limit, UI quản trị.

### Decision update — open-source implementation

User đã chọn hướng miễn phí/open-source. Nguồn active là official NSO/Decision 19 catalog cộng timestamped Geofabrik Vietnam OSM PBF dưới ODbL 1.0. eKMap và private R2 chỉ còn là research history, không thuộc kiến trúc triển khai. Raw input được lưu trong local SHA-256 content-addressed archive được Git ignore.

`data/relation-overrides.csv` ghi nhận reviewed Hoàng Sa disputed-boundary override. OSM API/full-relations evidence used in the review included relation IDs `17296617` and `3479413`; chúng là evidence under ODbL, không phải geometry giả do pipeline tạo ra.

Live audit ngày 2026-07-28 ban đầu đếm được `3.320` relation Việt Nam có `boundary=administrative`, `admin_level=6`. Đây là baseline chẩn đoán; artifact cuối bổ sung full OSM island relations `17296617` và `3479413`, đạt `3.321/3.321` mà không tạo polygon giả.

## Scope đã chốt

- Danh mục hành chính hiện hành, không dùng quận/huyện lịch sử.
- Đơn vị: xã, phường, đặc khu.
- ID: mã hành chính chính thức dạng `string` 5 ký tự; giữ số `0` đầu.
- Khoảng cách: Haversine, đường chim bay giữa polygon centroid.
- Dataset: snapshot thủ công, có `asOf`, version, source URL, checksum.
- Runtime: HonoJS trên Cloudflare Workers.
- API docs: Scalar; không giao diện khác.
- Out of scope: auth, rate limit, dashboard, scheduled sync, road distance.

## Research Method

- Thời điểm kiểm tra: 2026-07-28.
- Nguồn ưu tiên: văn bản Chính phủ, Cục Thống kê/NSO, tài liệu Cloudflare/Hono/Scalar.
- Nguồn geometry cộng đồng/vendor chỉ là ứng viên, không được tự xem là chuẩn pháp lý.
- Ba nhánh song song: danh mục, geometry/centroid, runtime/API.

## Findings

### 1. Danh mục hành chính

- Cấp huyện kết thúc hoạt động từ 01/07/2025; mô hình hiện hành gồm cấp tỉnh và cấp xã.
- Quyết định `19/2025/QĐ-TTg`, hiệu lực 01/07/2025, ban hành danh mục và mã số mới.
- Cổng NSO đang hiển thị 3.321 đơn vị cấp xã; phụ lục chính thức thể hiện mã như `00004`, `03241`.
- Cơ chế tiếp cận dữ liệu bản đồ chính thức được công bố theo hướng request/fee-based; trong các tài liệu công khai đã rà soát chưa thấy giấy phép bulk polygon mở cho tái sử dụng rộng rãi.
- Tổng 3.321 ổn định giữa các nguồn; breakdown theo loại có nguồn thứ cấp mâu thuẫn. Không hardcode tổng xã/phường/đặc khu; derive từ snapshot.
- Catalog chính thức không cung cấp polygon trong cùng artifact.

### 2. Geometry và polygon centroid

- Chưa thấy bulk GeoJSON/shapefile công khai thỏa đồng thời: post-01/07/2025, đủ 3.321, mã 5 ký tự, license rõ.
- eKMap ToS chỉ cho phép dùng hạn chế cho dịch vụ/app và cấm sao chép nội dung, tải hàng loạt, phân phối/bán lại phần của dịch vụ, hoặc tạo tập dữ liệu bản đồ thay thế/tương tự.
- eKMap Administrative 2025 trả bbox và WKT geometry theo commune code; cần API key, nhưng quyền truy cập kỹ thuật này không phải là giấy phép bulk extraction, archival, derivation, hay redistribution.
- GADM, ArcGIS và các repo cũ không phù hợp làm nguồn chuẩn hiện hành.
- Centroid tính trực tiếp trên `EPSG:4326` không chuẩn; polygon cần repair rồi project sang equal-area CRS, đề xuất `EPSG:6933`.
- Với multipolygon/đơn vị đảo, centroid có thể nằm ngoài polygon hoặc trên biển. Vẫn giữ centroid vì đúng yêu cầu; lưu thêm cờ chất lượng để audit.

### 3. Cloudflare/Hono

- Khoảng 3.321 record centroid đủ nhỏ để bundle thành JSON versioned cùng Worker.
- Static JSON đơn giản và nhất quán hơn KV; KV eventual consistency không mang lợi ích cho snapshot read-only.
- D1 thêm migration/query/operational surface nhưng API chỉ lookup 2 key; chưa có lý do dùng DB.
- Hono hỗ trợ OpenAPI route schema; Scalar Hono integration có thể render UI từ `/openapi.json`.

## Kiến trúc MVP đề xuất

```text
Build-time data pipeline
  official catalog + timestamped Geofabrik OSM PBF
  -> validate/repair/project/centroid
  -> reconcile exactly 3,321 codes
  -> versioned centroids.json + manifest.json

Cloudflare Worker
  GET /api/v1/distances?originCommuneId=...&destinationCommuneId=...
  GET /health
  GET /meta/version
  GET /openapi.json
  GET /scalar
```

Dataset runtime record:

```typescript
interface CommuneCentroid {
  id: string
  name: string
  type: 'xa' | 'phuong' | 'dac-khu'
  provinceId: string
  latitude: number
  longitude: number
  centroidOutsideGeometry: boolean
}
```

## API semantics

- `200`: kết quả; cùng ID trả `0` trước lookup.
- `400`: thiếu ID hoặc ID không đúng regex `^\d{5}$`.
- `404`: một hoặc cả hai mã không có trong snapshot.
- `422`: record có nhưng centroid null/NaN/ngoài range.
- `500`: lỗi bất ngờ; response chuẩn hóa, không làm crash Worker.

## Validation gates cho dữ liệu

- Đúng `3.321` ID unique và khớp catalog snapshot.
- Mọi ID đúng 5 ký tự; không mất leading zero.
- Mọi geometry parse được, valid sau repair, có CRS/source metadata.
- Mọi centroid finite; latitude `[-90, 90]`, longitude `[-180, 180]`.
- Báo cáo mismatch, duplicate, missing; pipeline fail nếu count không đủ.
- Lưu `asOf`, retrieved time, source URLs, source license, SHA-256 input/output.

## Recommendation

Proceed theo hướng open data, có data gate:

1. Chấp nhận static JSON + bảng tra cứu trong memory; bỏ database khỏi MVP.
2. Sửa PRD theo scope cấp xã hiện hành, bổ sung snapshot/provenance/data gates.
3. Pin timestamped Geofabrik PBF, kiểm SHA-256 và ghi OSM attribution/ODbL metadata.
4. Viết pyosmium/Shapely/pyproj pipeline build-time; không gọi geometry API ở runtime.
5. Chỉ tuyên bố full coverage sau automated reconciliation `3.321/3.321`; `3.320` phải fail.

## References

- [Quyết định 19/2025/QĐ-TTg](https://vanban.chinhphu.vn/?classid=1&docid=214409&orggroupid=3&pageid=27160)
- [Danh mục và mã số cấp xã — NSO PDF](https://www.nso.gov.vn/wp-content/uploads/2025/06/Danh-sach-va-ma-so-cac-don-vi-hanh-chinh-cap-xa.pdf)
- [NSO đối chiếu đơn vị hành chính](https://danhmuchanhchinh.nso.gov.vn/Doi_Chieu_Moi.aspx)
- [Geofabrik Vietnam extracts](https://download.geofabrik.de/asia/vietnam.html)
- [OpenStreetMap attribution guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)
- [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare KV consistency FAQ](https://developers.cloudflare.com/kv/reference/faq/)
- [Hono OpenAPI example](https://hono.dev/examples/hono-openapi)
- [Hono Scalar example](https://hono.dev/examples/scalar)
- [Scalar Hono integration](https://scalar.com/products/api-references/integrations/hono)

## Unresolved Questions

- Procurement của một geometry source được cấp phép riêng cho toàn bộ 3.321 đơn vị vẫn chưa hoàn tất.
- Catalog/geometry có thay đổi sau snapshot 01/07/2025 cần đưa vào `asOf` gần hơn không?
