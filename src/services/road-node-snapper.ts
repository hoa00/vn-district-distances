import type { RoadGraph } from "../data/load-road-graph";
import { haversineMeters } from "../domain/geo";

// Điểm WGS84 chuẩn hóa về E6 (6 chữ số thập phân), khử -0.
export interface E6Point {
  readonly latE6: number;
  readonly lngE6: number;
}

// Node đã snap: node index trong graph, khoảng snap (mét, ceil), và điểm đầu vào E6
// để Phase 2 dựng ephemeral connector geometry (input point → snapped node).
export interface SnappedNode {
  readonly node: number;
  readonly snapMeters: number;
  readonly point: E6Point;
}

// Kết quả snap: ngoài coverage (→ 422), snap thành công, hoặc trong bbox nhưng không có node ≤ snapMax (→ fallback).
export type SnapOutcome =
  | { readonly status: "outside-coverage" }
  | { readonly status: "snapped"; readonly snap: SnappedNode }
  | { readonly status: "no-connector" };

// Hard caps bảo vệ CPU (Cloudflare Free 10ms/request). Cửa sổ snap ở vĩ độ VN luôn 5×5 cell;
// cell đặc nhất (Hà Nội/TP.HCM) có tới ~1435 node → 5×5 window có thể vượt 7000 candidate.
// Cap đủ rộng để phủ p999 (~6400) thực đo được; nếu vượt, snap trả best-so-far (không trả sai).
const MAX_CELLS_VISITED = 64;
const MAX_CANDIDATES = 16_384;
const METERS_PER_DEGREE_LATITUDE = 111_320;

// Chuẩn hóa tọa độ WGS84 về E6, làm tròn 6 chữ số và chuẩn hóa -0 thành 0.
export function normalizeE6(latitude: number, longitude: number): E6Point {
  const latE6 = Math.round(latitude * 1_000_000) || 0;
  const lngE6 = Math.round(longitude * 1_000_000) || 0;
  return { latE6, lngE6 };
}

// Tìm node gần nhất trong bán kính snapMax (mặc định 10 km) qua spatial CSR index.
// Trả outside-coverage nếu điểm ngoài bbox mở rộng snapMax (O(1), không enumerate grid),
// no-connector nếu trong bbox nhưng không có node đủ gần, hoặc snapped node gần nhất.
export function snapNearestNode(graph: RoadGraph, point: E6Point): SnapOutcome {
  const { manifest } = graph;
  const latitude = point.latE6 / 1_000_000;
  const longitude = point.lngE6 / 1_000_000;
  const snapMax = manifest.snapMaximumMeters;
  const cellSize = manifest.spatialCellSizeDegrees;

  // Coverage check O(1) trước khi enumerate cell; dùng vĩ độ clamp để cos ổn định.
  const latMargin = snapMax / METERS_PER_DEGREE_LATITUDE;
  const coverageLatitude = Math.min(89.9, Math.max(-89.9, latitude));
  const lngMargin =
    snapMax /
    (METERS_PER_DEGREE_LATITUDE *
      Math.cos((coverageLatitude * Math.PI) / 180));
  if (
    latitude < manifest.minimumLatitude - latMargin ||
    latitude > manifest.maximumLatitude + latMargin ||
    longitude < manifest.minimumLongitude - lngMargin ||
    longitude > manifest.maximumLongitude + lngMargin
  ) {
    return { status: "outside-coverage" };
  }

  // Cell key phải khớp XOR formula Python builder: row*columnsPerRow + column.
  const cellsPerDegree = Math.round(1 / cellSize);
  const columnsPerRow = Math.round(360 * cellsPerDegree) + 1;
  const row = Math.floor((latitude + 90) * cellsPerDegree);
  const column = Math.floor((longitude + 180) * cellsPerDegree);

  // Bán kính cell bảo thủ phủ snapMax mét; dùng vĩ độ lớn nhất trong cửa sổ cho cos (cell hẹp dần về cực).
  const radiusLatitude = Math.ceil(
    snapMax / (cellSize * METERS_PER_DEGREE_LATITUDE),
  );
  const windowMaxAbsLatitude = Math.min(
    90,
    Math.abs(latitude) + radiusLatitude * cellSize,
  );
  const longitudeMetersPerCell =
    cellSize *
    METERS_PER_DEGREE_LATITUDE *
    Math.cos((windowMaxAbsLatitude * Math.PI) / 180);
  const radiusLongitude = Math.ceil(snapMax / longitudeMetersPerCell);

  let bestNode = -1;
  let bestMeters = Infinity;
  let cellsVisited = 0;
  let candidates = 0;
  cellScan:
  for (let rowDelta = -radiusLatitude; rowDelta <= radiusLatitude; rowDelta += 1) {
    for (
      let columnDelta = -radiusLongitude;
      columnDelta <= radiusLongitude;
      columnDelta += 1
    ) {
      const key = (row + rowDelta) * columnsPerRow + (column + columnDelta);
      const cellIndex = binarySearchUint32(graph.spatialCellKeys, key);
      if (cellIndex < 0) {
        continue;
      }
      cellsVisited += 1;
      // Cap là guard CPU: khi chạm, dừng quét và trả best-so-far (xét ở cuối) thay vì no-connector sai.
      if (cellsVisited > MAX_CELLS_VISITED) {
        break cellScan;
      }
      const start = graph.spatialCellOffsets[cellIndex]!;
      const end = graph.spatialCellOffsets[cellIndex + 1]!;
      for (let index = start; index < end; index += 1) {
        candidates += 1;
        if (candidates > MAX_CANDIDATES) {
          break cellScan;
        }
        const node = graph.spatialNodeIndices[index]!;
        const meters = haversineMeters(
          latitude,
          longitude,
          graph.nodeLatE6[node]! / 1_000_000,
          graph.nodeLngE6[node]! / 1_000_000,
        );
        // Tie-break theo (meters, node): khoảng bằng nhau thì chọn node index nhỏ hơn (deterministic).
        if (meters < bestMeters || (meters === bestMeters && node < bestNode)) {
          bestMeters = meters;
          bestNode = node;
        }
      }
    }
  }

  if (bestNode < 0 || bestMeters > snapMax) {
    return { status: "no-connector" };
  }
  return {
    status: "snapped",
    snap: { node: bestNode, snapMeters: Math.ceil(bestMeters), point },
  };
}

// Binary search trên cell keys tăng dần nghiêm ngặt; trả -1 nếu không tìm thấy.
function binarySearchUint32(
  keys: Readonly<Uint32Array>,
  target: number,
): number {
  let low = 0;
  let high = keys.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const value = keys[mid]!;
    if (value === target) {
      return mid;
    }
    if (value < target) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return -1;
}
