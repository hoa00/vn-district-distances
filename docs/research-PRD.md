# PRD: Dịch vụ khoảng cách đơn vị hành chính cấp xã Việt Nam

## 1. Tổng quan

Xây dựng service nội bộ tính khoảng cách đường chim bay giữa hai đơn vị hành chính cấp xã hiện hành của Việt Nam.

Việt Nam đã kết thúc cấp huyện từ 01/07/2025. Vì vậy service sử dụng danh mục 3.321 đơn vị cấp xã gồm xã, phường và đặc khu từ Quyết định 19/2025/QĐ-TTg/NSO; geometry lấy từ snapshot OSM relations được pin theo thời điểm.

Mục tiêu là MVP chứng minh POC:

- Tra cứu bằng mã hành chính cấp xã chính thức.
- Trả khoảng cách giữa tâm hình học của hai địa giới.
- Phục vụ bằng HTTP API trên Cloudflare Workers.
- Có OpenAPI và trang tài liệu Scalar.

Không xây auth, rate limit, dashboard, trang quản trị, đồng bộ định kỳ hoặc tính khoảng cách đường bộ.

## 2. Tiêu chí thành công

- Snapshot chứa đúng 3.321 mã unique và đối chiếu đủ `3.321/3.321` với danh mục nguồn; baseline quan sát 3.320 chỉ là số liệu chẩn đoán, không được dùng làm tiêu chí release.
- Mọi đơn vị có centroid hợp lệ cùng provenance dữ liệu.
- API trả kết quả đúng và ổn định cho mọi cặp mã hợp lệ trong snapshot.
- OpenAPI mô tả đúng contract và Scalar hiển thị tài liệu có thể thử API.
- Worker build, test và chạy local thành công.

Không được tuyên bố full coverage nếu còn mã thiếu, trùng, geometry lỗi hoặc chưa rõ quyền sử dụng nguồn geometry.

## 3. Nguồn và version dữ liệu

### 3.1. Danh mục chuẩn

- Nguồn pháp lý: Quyết định `19/2025/QĐ-TTg`, hiệu lực 01/07/2025.
- Nguồn đối chiếu: Cục Thống kê/NSO.
- Đơn vị: `xã`, `phường`, `đặc khu`.
- Mã cấp xã: chuỗi đúng 5 chữ số, regex `^\d{5}$`.
- Không lưu mã dưới dạng number vì sẽ mất số `0` đầu.

### 3.2. Geometry

- Dùng polygon địa giới tương ứng với snapshot danh mục hiện hành.
- Nguồn geometry phải là Geofabrik Vietnam `osm.pbf` đã pin theo timestamp, không dùng `latest`.
- Lọc các relation có `boundary=administrative` và `admin_level=6` từ snapshot OSM. Chỉ cho phép ngoại lệ disputed-boundary khi có mapping review theo official catalog ID và OSM relation ID; MVP hiện có đúng một ngoại lệ Hoàng Sa (`20333` → `17296617`).
- Nguồn geometry phải ghi rõ URL, ngày truy xuất, phiên bản, attribution và quyền sử dụng.
- Ghi rõ ODbL 1.0, nghĩa vụ share-alike và nghĩa vụ đối với derived database trong manifest và metadata phát hành.
- Không dùng eKMap trong kiến trúc hiện tại; các phát hiện trước đây chỉ còn giá trị lịch sử trong research.

### 3.3. Snapshot

MVP dùng snapshot build-time, cập nhật bằng script thủ công. Raw source chỉ được archive trong một thư mục local được Git ignore bằng content-addressed object key SHA-256; không dùng cloud storage, không dùng R2, và chỉ phục vụ rebuild pipeline.

Manifest tối thiểu:

```typescript
interface DatasetManifest {
  version: string
  asOf: string
  generatedAt: string
  recordCount: 3321
  inputs: Array<{
    role: 'commune-catalog' | 'province-catalog' | 'geometry'
    sourceUrl: string
    archivePath: string
    effectiveAt: string
    retrievedAt: string
    sha256: string
    attribution: string
    licenseUrl: string
    shareAlikeNotice: string
    derivedDatabaseNotice: string
  }>
  runtimeDatasetSha256: string
}
```

## 4. Data pipeline

Pipeline chạy ngoài Worker:

1. Nạp catalog mã, tên, loại và tỉnh từ nguồn chính thức.
2. Nạp timestamped Geofabrik Vietnam `osm.pbf`.
3. Lọc các relation có `boundary=administrative` và `admin_level=6`, rồi áp dụng đúng các override đã review trong `data/relation-overrides.csv`.
4. Parse polygon/multipolygon; repair topology khi cần.
5. Project geometry sang equal-area CRS, đề xuất `EPSG:6933`.
6. Tính geometric centroid rồi chuyển kết quả về WGS84 (`EPSG:4326`).
7. Đánh dấu centroid nằm ngoài geometry để audit; không tự đổi sang trụ sở hành chính.
8. Đối chiếu toàn bộ mã với catalog.
9. Sinh một `runtime-dataset.json` chứa manifest + records và báo cáo validation riêng.

Pipeline phải fail nếu:

- Record count khác 3.321.
- ID thiếu, trùng hoặc không đúng 5 chữ số.
- Catalog và geometry không khớp mã.
- Thiếu attribution, ODbL URL, share-alike notice hoặc derived-database notice trong metadata phát hành.
- Không đạt `3.321/3.321` relation thực.
- Geometry không thể parse/repair.
- Centroid không finite hoặc ngoài phạm vi tọa độ.
- Thiếu metadata nguồn hoặc checksum.

## 5. Runtime data model

```typescript
type CommuneType = 'xa' | 'phuong' | 'dac-khu'

interface CommuneCentroid {
  id: string
  name: string
  type: CommuneType
  provinceId: string
  latitude: number
  longitude: number
  centroidOutsideGeometry: boolean
}
```

`id` và `provinceId` đều là string để giữ leading zero.

Dataset centroid được bundle trong một JSON versioned cùng Worker và nạp vào bảng tra cứu trong memory. MVP không dùng D1, KV hay runtime R2 binding.

## 6. Logic khoảng cách

Tách utility toán học khỏi route và data repository.

Input:

```typescript
interface Point {
  lat: number
  lng: number
}
```

Output: khoảng cách kilomet kiểu `number`, làm tròn 2 chữ số.

Sử dụng Haversine với bán kính Trái Đất `R = 6371 km`.

Utility phải reject:

- Giá trị thiếu, không phải số hoặc không finite.
- Latitude ngoài `[-90, 90]`.
- Longitude ngoài `[-180, 180]`.

## 7. HTTP API

### 7.1. Tính khoảng cách

```http
GET /api/v1/distances?originCommuneId=00004&destinationCommuneId=00292
```

Flow:

1. Validate hai ID bằng `^\d{5}$`.
2. Lookup origin; nếu không tồn tại, trả `404`.
3. Nếu hai ID giống nhau và origin tồn tại, trả `0` mà không lookup lần hai.
4. Lookup destination; nếu không tồn tại, trả `404`.
5. Tính Haversine và trả response.

```typescript
interface DistanceResponse {
  originCommuneId: string
  destinationCommuneId: string
  distanceKm: number
  unit: 'km'
  datasetVersion: string
}
```

### 7.2. Operational endpoints

- `GET /health`: `200` khi dataset sẵn sàng; `503` với `loaded: false` nếu artifact lỗi.
- `GET /meta/version`: `version`, `asOf`, `recordCount`, checksums.
- `GET /openapi.json`: OpenAPI document.
- `GET /scalar`: Scalar API reference.

Không thêm endpoint ghi hoặc cập nhật dataset trong MVP.

## 8. Error contract

```typescript
interface ErrorResponse {
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}
```

- `400 Bad Request`: thiếu ID hoặc sai định dạng.
- `404 Not Found`: một hoặc cả hai mã không tồn tại.
- `503 Service Unavailable`: bundled dataset không thể khởi tạo an toàn.
- `500 Internal Server Error`: lỗi ngoài dự kiến.

Handler phải chuẩn hóa lỗi; không để unhandled exception làm crash Worker.

## 9. Tech stack

- Runtime: Cloudflare Workers.
- Framework: HonoJS.
- Language: TypeScript strict.
- Package manager: xác định trong planning.
- Schema/validation: thư viện tương thích Hono OpenAPI, xác định trong planning.
- API spec: OpenAPI.
- API reference: Scalar Hono integration.
- Test runner: Vitest.
- Runtime storage: versioned static JSON; không D1/KV/R2 binding.
- Raw archive: local Git-ignored content-addressed archive, build-time only, không public URL.

## 10. Testing

### Unit

- Cùng tọa độ trả `0`.
- Một cặp tọa độ chuẩn trả kết quả trong tolerance.
- Reject thiếu/NaN/infinite/out-of-range.
- Làm tròn đúng 2 chữ số.

### Integration

- Happy path giữa hai mã có thật.
- Cùng ID có tồn tại short-circuit về `0`; cùng ID không tồn tại trả `404`.
- `400`, `404`, `500`, `503` theo contract.
- Response luôn kèm `datasetVersion`.

### Data validation

- Đủ 3.321 ID unique.
- Tất cả ID đúng 5 chữ số.
- Tất cả centroid hợp lệ.
- Province reference hợp lệ.
- Manifest count và checksum khớp artifact.
- Mỗi input có URL đã pin, checksum, license metadata và attribution; PBF extraction audit phải chứng minh chỉ dùng relation `boundary=administrative`, `admin_level=6` ngoài các disputed-boundary override đã review và version-control.

### Contract/build

- `/openapi.json` validate được.
- `/scalar` render và trỏ đúng OpenAPI URL.
- `wrangler` dry-run build thành công.

## 11. Yêu cầu chất lượng

- TypeScript strict; không dùng `any`.
- Tách math utility, repository, service và HTTP routes.
- Không network call trong distance request.
- Không thêm abstraction chỉ để “sau này có thể dùng”.
- Dataset và source provenance phải reproducible.

## 12. Ngoài phạm vi MVP

- Authentication và authorization.
- Rate limiting.
- D1, KV, runtime R2 binding, cloud archive hoặc database khác.
- Web app ngoài Scalar.
- Admin CRUD và dashboard.
- Scheduled refresh.
- Geocoding theo tên/địa chỉ.
- Route/road distance và travel time.
- SLA, multi-region data replication hoặc analytics.

## 13. Acceptance criteria

- [x] Nguồn geometry là Geofabrik Vietnam `osm.pbf` đã pin cùng hai full OSM island relations và có attribution/ODbL metadata.
- [x] Pipeline sinh snapshot có báo cáo `3.321/3.321`; baseline 3.320 chỉ là chẩn đoán trước khi bổ sung island relations đã duyệt.
- [x] Manifest có version, `asOf`, provenance, SHA-256, attribution, ODbL URL, share-alike notice và derived-database notice.
- [x] Distance endpoint đúng OpenAPI contract.
- [x] Health, version, OpenAPI và Scalar endpoints hoạt động.
- [x] Unit, integration, data và contract tests pass.
- [x] Không có auth, rate limit, DB, runtime R2 binding, cloud storage hay UI ngoài Scalar.

## 14. Tham khảo

- [Quyết định 19/2025/QĐ-TTg](https://vanban.chinhphu.vn/?classid=1&docid=214409&orggroupid=3&pageid=27160)
- [Danh mục và mã số cấp xã — NSO](https://www.nso.gov.vn/wp-content/uploads/2025/06/Danh-sach-va-ma-so-cac-don-vi-hanh-chinh-cap-xa.pdf)
- [NSO đối chiếu đơn vị hành chính](https://danhmuchanhchinh.nso.gov.vn/Doi_Chieu_Moi.aspx)
- [Geofabrik Vietnam download page](https://download.geofabrik.de/asia/vietnam.html)
- [OpenStreetMap copyright and license](https://www.openstreetmap.org/copyright/All)
- [Open Database License 1.0](https://wiki.openstreetmap.org/wiki/Open_Database_License/ODbL-1.0.txt)
- [Administrative boundary tag](https://wiki.openstreetmap.org/wiki/Tag:boundary=administrative)
- [Research validation](./260728-1209-current-commune-distance-research.md)

## 15. Câu hỏi chưa giải quyết

- Snapshot Geofabrik nào sẽ được pin làm baseline release?
- Relation reconciliation có đạt đúng `3.321/3.321` sau filter `boundary=administrative` và `admin_level=6` không?
