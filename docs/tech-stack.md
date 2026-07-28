# Tech Stack

## Overview

Stack đã được chốt cho MVP service nội bộ tính khoảng cách cấp xã Việt Nam.

## Runtime

- Cloudflare Workers.
- HonoJS.
- TypeScript strict.
- Cloudflare Workers Assets for the static road graph asset.

## API

- REST-style HTTP API.
- OpenAPI document sinh từ route schema.
- Scalar làm API reference tại `/scalar`.
- Scalar CDN pin version và có CSP; không dùng tag `latest`.
- Deployment and dry-run use Wrangler directly.

## Data

- Một `runtime-dataset.json` chứa manifest + records được bundle cùng Worker sau khi reconcile đúng `3.321/3.321`.
- Lookup bằng bảng tra cứu trong memory.
- Không D1, KV, runtime R2 binding hoặc database trong MVP.
- Catalog dùng nguồn NSO/Quyết định 19; geometry dùng Geofabrik Vietnam OSM PBF đã pin theo timestamp, license ODbL 1.0.
- Raw input nằm trong local content-addressed SHA-256 archive được Git ignore; không dùng eKMap, R2, API key hoặc dịch vụ trả phí.
- Static road graph được build thành asset content-addressed, publish qua `./public`, và load qua Cloudflare Workers Assets.
- Pipeline nhận OSM relation `boundary=administrative`, `admin_level=6`; ngoại lệ duy nhất là Hoàng Sa, dùng OSM relation `17296617` có `boundary=disputed` và được khóa bằng `data/relation-overrides.csv`. Baseline `3.320/3.321` chỉ là chẩn đoán trước khi bổ sung hai full relation snapshot.
- Road routes là coarse, approximate, và có fallback straight-line với factor `1.3` khi graph không thể dùng.
- Data pipeline chạy build-time và cập nhật thủ công.

## Testing and Tooling

- Vitest cho unit/integration/contract tests; pytest cho pyosmium/Shapely/pyproj pipeline.
- Wrangler cho local development, dry-run build và deployment.
- Data gates kiểm tra checksum, OSM extraction, reconciliation `3.321/3.321`, attribution và ODbL metadata.
- Commands hiện dùng:
  - `npm run data:road-graph:build`
  - `npm run data:road-graph:validate`
  - `npm run release:verify`
  - `npx wrangler dev`
  - `npx wrangler deploy`

## Explicit Non-goals

- Authentication.
- Rate limiting.
- Admin UI hoặc dashboard.
- Scheduled data synchronization.
- Runtime geometry processing, cloud archive/R2 access hoặc paid geometry API.

## Decision Rationale

Dataset chỉ khoảng 3.321 centroid và là read-only snapshot. Static JSON giảm số thành phần vận hành, tránh consistency của KV và migration/query overhead của D1. Road graph cũng là asset static, nên Workers Assets đủ cho vận hành thường ngày mà không cần R2 hoặc service ngoài. Artifact chỉ được sinh khi toàn bộ official catalog map one-to-one với relation OSM thật và phải mang attribution/ODbL metadata. D1 chỉ nên được xem lại khi xuất hiện nhu cầu cập nhật runtime, query linh hoạt hoặc admin CRUD.

## References

- [Product requirements](./research-PRD.md)
- [Research report](./260728-1209-current-commune-distance-research.md)
- [Geofabrik Vietnam extracts](https://download.geofabrik.de/asia/vietnam.html)
- [OpenStreetMap attribution guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)
- [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Hono OpenAPI](https://hono.dev/examples/hono-openapi)
- [Hono Scalar](https://hono.dev/examples/scalar)
