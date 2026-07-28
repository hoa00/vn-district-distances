from __future__ import annotations

import hashlib
import json
import math
import struct
import sys
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping, Sequence

import osmium


MAGIC = b"VNRG"
SCHEMA_VERSION = 2
UNROUTABLE_NODE = 0xFFFFFFFF
LOW_CONFIDENCE_METERS = 1_000
MAX_SNAP_METERS = 10_000
MAX_ASSET_BYTES = 25 * 1024 * 1024
MAX_DECODED_BYTES = 64 * 1024 * 1024
SIMPLIFY_TOLERANCE_METERS = 50.0

# Spatial grid dùng cho nearest-node lookup runtime.
# Cell size 0.05° chia sẻ ý nghĩa với snap_communes; runtime index dùng packed unsigned key.
# Dùng nhân `* CELLS_PER_DEGREE` (20.0, chính xác trong float) thay vì `/ CELL_SIZE_DEGREES`
# (1/0.05 = 19.999999999999996) để cell key tại biên ±90/±180 xác định và khớp TypeScript.
SPATIAL_CELL_SIZE_DEGREES = 0.05
SPATIAL_CELLS_PER_DEGREE = 20.0
SPATIAL_LATITUDE_OFFSET = 90.0
SPATIAL_LONGITUDE_OFFSET = 180.0
SPATIAL_COLUMNS_PER_ROW = 7201

ROAD_CLASSES = (
    "motorway",
    "trunk",
    "primary",
    "secondary",
    "tertiary",
)
ROAD_CLASS_RANK = {name: index + 1 for index, name in enumerate(ROAD_CLASSES)}
ACCEPTED_HIGHWAYS = frozenset(
    ROAD_CLASSES + tuple(f"{name}_link" for name in ROAD_CLASSES)
)
BLOCKED_ACCESS = frozenset({"no", "private"})
ALLOWED_BARRIER_ACCESS = frozenset({"yes", "permissive", "designated"})
NON_BLOCKING_BARRIERS = frozenset(
    {"border_control", "cattle_grid", "entrance", "sally_port", "toll_booth"}
)

INTERNAL_EDGE_FLAG_FERRY = 1 << 7
ABI_EDGE_FLAG_FERRY = 1 << 0
CONNECTOR_FLAG_SNAPPED = 1 << 0
CONNECTOR_FLAG_LOW_CONFIDENCE = 1 << 1

SECTION_NODE_LAT_E6 = 1
SECTION_NODE_LNG_E6 = 2
SECTION_CSR_OFFSETS = 3
SECTION_EDGE_TARGETS = 4
SECTION_EDGE_WEIGHTS_M = 5
SECTION_EDGE_FLAGS = 6
SECTION_EDGE_GEOMETRY_OFFSETS = 7
SECTION_EDGE_GEOMETRY_DELTAS = 8
SECTION_CONNECTOR_COMMUNE_IDS = 9
SECTION_CONNECTOR_NODES = 10
SECTION_CONNECTOR_SNAP_M = 11
SECTION_CONNECTOR_GEOMETRY_OFFSETS = 12
SECTION_CONNECTOR_GEOMETRY_DELTAS = 13
SECTION_SPATIAL_CELL_KEYS = 14
SECTION_SPATIAL_CELL_OFFSETS = 15
SECTION_SPATIAL_NODE_INDICES = 16

HEADER_STRUCT = struct.Struct("<4sHHIIIIII")
SECTION_STRUCT = struct.Struct("<HBBIII")
SECTION_COUNT = 16
HEADER_BYTES = 288


@dataclass(frozen=True, slots=True)
class RoadNode:
    osm_id: int
    latitude: float
    longitude: float


@dataclass(frozen=True, slots=True)
class DirectedSegment:
    source: int
    target: int
    meters: float
    flags: int


@dataclass(frozen=True, slots=True)
class ContractedEdge:
    source: int
    target: int
    meters: int
    flags: int
    geometry: tuple[tuple[float, float], ...]


@dataclass(frozen=True, slots=True)
class Connector:
    commune_id: str
    node_id: int
    snap_meters: int
    component_id: int
    flags: int
    geometry: tuple[tuple[float, float], ...]


@dataclass(frozen=True, slots=True)
class RoadGraph:
    nodes: tuple[RoadNode, ...]
    edges: tuple[ContractedEdge, ...]
    connectors: tuple[Connector, ...]
    component_count: int


@dataclass(frozen=True, slots=True)
class _WayPolicy:
    accepted: bool
    forward: bool
    backward: bool
    flags: int


@dataclass(frozen=True, slots=True)
class _AcceptedWay:
    node_ids: tuple[int, ...]
    policy: _WayPolicy


class _WayReferenceHandler(osmium.SimpleHandler):
    def __init__(self) -> None:
        super().__init__()
        self.ways: list[_AcceptedWay] = []
        self.required_node_ids: set[int] = set()

    def way(self, way: osmium.osm.Way) -> None:
        tags = {tag.k: tag.v for tag in way.tags}
        policy = way_policy(tags)
        if not policy.accepted or len(way.nodes) < 2:
            return
        node_ids = tuple(item.ref for item in way.nodes)
        self.ways.append(_AcceptedWay(node_ids, policy))
        self.required_node_ids.update(node_ids)


class _RequiredNodeHandler(osmium.SimpleHandler):
    def __init__(self, required_node_ids: set[int]) -> None:
        super().__init__()
        self.required_node_ids = required_node_ids
        self.blocked_nodes: set[int] = set()
        self.nodes: dict[int, RoadNode] = {}

    def node(self, node: osmium.osm.Node) -> None:
        if node.id not in self.required_node_ids:
            return
        if node.location.valid():
            self.nodes[node.id] = RoadNode(
                osm_id=node.id,
                latitude=node.location.lat,
                longitude=node.location.lon,
            )
        tags = {tag.k: tag.v for tag in node.tags}
        barrier = tags.get("barrier")
        if not barrier or barrier in NON_BLOCKING_BARRIERS:
            return
        motor_access = _motor_access(tags)
        if motor_access not in ALLOWED_BARRIER_ACCESS:
            self.blocked_nodes.add(node.id)


def _motor_access(tags: Mapping[str, str]) -> str | None:
    return tags.get(
        "motorcar",
        tags.get("motor_vehicle", tags.get("vehicle", tags.get("access"))),
    )


def way_policy(tags: Mapping[str, str]) -> _WayPolicy:
    highway = tags.get("highway", "")
    is_ferry = tags.get("route") == "ferry"
    if highway not in ACCEPTED_HIGHWAYS and not is_ferry:
        return _WayPolicy(False, False, False, 0)

    access = _motor_access(tags) or ""
    if access in BLOCKED_ACCESS:
        return _WayPolicy(False, False, False, 0)
    if is_ferry and not any(
        key in tags for key in ("motorcar", "motor_vehicle", "vehicle")
    ):
        return _WayPolicy(False, False, False, 0)

    if is_ferry:
        flags = INTERNAL_EDGE_FLAG_FERRY
    else:
        base_class = highway.removesuffix("_link")
        flags = ROAD_CLASS_RANK[base_class]

    oneway = tags.get("oneway", "").lower()
    if oneway == "-1":
        return _WayPolicy(True, False, True, flags)
    if oneway in {"yes", "1", "true"}:
        return _WayPolicy(True, True, False, flags)
    if oneway in {"no", "0", "false"}:
        return _WayPolicy(True, True, True, flags)
    if tags.get("junction") == "roundabout" or highway == "motorway":
        return _WayPolicy(True, True, False, flags)
    return _WayPolicy(True, True, True, flags)


def load_directed_roads(
    pbf_path: Path,
) -> tuple[dict[int, RoadNode], tuple[DirectedSegment, ...]]:
    started = time.monotonic()
    print("road-graph: pass 1/2 scanning accepted ways", file=sys.stderr, flush=True)
    way_handler = _WayReferenceHandler()
    way_handler.apply_file(str(pbf_path))
    print(
        "road-graph: pass 1/2 complete "
        f"ways={len(way_handler.ways)} nodes={len(way_handler.required_node_ids)} "
        f"elapsed={time.monotonic() - started:.1f}s",
        file=sys.stderr,
        flush=True,
    )
    print("road-graph: pass 2/2 loading required nodes", file=sys.stderr, flush=True)
    node_handler = _RequiredNodeHandler(way_handler.required_node_ids)
    node_handler.apply_file(str(pbf_path))
    print(
        "road-graph: pass 2/2 complete "
        f"nodes={len(node_handler.nodes)} barriers={len(node_handler.blocked_nodes)} "
        f"elapsed={time.monotonic() - started:.1f}s",
        file=sys.stderr,
        flush=True,
    )
    nodes = {
        node_id: node
        for node_id, node in node_handler.nodes.items()
        if node_id not in node_handler.blocked_nodes
    }
    segment_map: dict[tuple[int, int, int], DirectedSegment] = {}
    for accepted_way in way_handler.ways:
        for source_id, target_id in zip(
            accepted_way.node_ids,
            accepted_way.node_ids[1:],
            strict=False,
        ):
            source = nodes.get(source_id)
            target = nodes.get(target_id)
            if source is None or target is None:
                continue
            meters = haversine_meters(
                source.latitude,
                source.longitude,
                target.latitude,
                target.longitude,
            )
            if not math.isfinite(meters) or meters <= 0:
                continue
            if accepted_way.policy.forward:
                _retain_shortest_segment(
                    segment_map,
                    DirectedSegment(
                        source_id,
                        target_id,
                        meters,
                        accepted_way.policy.flags,
                    ),
                )
            if accepted_way.policy.backward:
                _retain_shortest_segment(
                    segment_map,
                    DirectedSegment(
                        target_id,
                        source_id,
                        meters,
                        accepted_way.policy.flags,
                    ),
                )
    segments = tuple(segment_map[key] for key in sorted(segment_map))
    print(
        "road-graph: directed segments ready "
        f"count={len(segments)} elapsed={time.monotonic() - started:.1f}s",
        file=sys.stderr,
        flush=True,
    )
    return nodes, segments


def _retain_shortest_segment(
    segments: dict[tuple[int, int, int], DirectedSegment],
    candidate: DirectedSegment,
) -> None:
    key = (candidate.source, candidate.target, candidate.flags)
    previous = segments.get(key)
    if previous is None or candidate.meters < previous.meters:
        segments[key] = candidate


def haversine_meters(
    latitude_a: float,
    longitude_a: float,
    latitude_b: float,
    longitude_b: float,
) -> float:
    radius_meters = 6_371_000.0
    latitude_a_rad = math.radians(latitude_a)
    latitude_b_rad = math.radians(latitude_b)
    delta_latitude = latitude_b_rad - latitude_a_rad
    delta_longitude = math.radians(longitude_b - longitude_a)
    value = (
        math.sin(delta_latitude / 2) ** 2
        + math.cos(latitude_a_rad)
        * math.cos(latitude_b_rad)
        * math.sin(delta_longitude / 2) ** 2
    )
    angular = 2 * math.atan2(math.sqrt(value), math.sqrt(max(0.0, 1 - value)))
    return radius_meters * angular


def snap_communes(
    nodes: Mapping[int, RoadNode],
    records: Sequence[Mapping[str, object]],
) -> dict[str, tuple[int, int, int]]:
    cell_degrees = 0.05
    search_radius = 3
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for node_id, node in nodes.items():
        grid[_grid_cell(node.latitude, node.longitude, cell_degrees)].append(node_id)
    for bucket in grid.values():
        bucket.sort()

    snapped: dict[str, tuple[int, int, int]] = {}
    for record in sorted(records, key=lambda row: str(row["id"])):
        commune_id = str(record["id"])
        latitude = float(record["latitude"])
        longitude = float(record["longitude"])
        origin_cell = _grid_cell(latitude, longitude, cell_degrees)
        best: tuple[float, int] | None = None
        for row_delta in range(-search_radius, search_radius + 1):
            for column_delta in range(-search_radius, search_radius + 1):
                for node_id in grid.get(
                    (origin_cell[0] + row_delta, origin_cell[1] + column_delta),
                    (),
                ):
                    node = nodes[node_id]
                    meters = haversine_meters(
                        latitude,
                        longitude,
                        node.latitude,
                        node.longitude,
                    )
                    candidate = (meters, node_id)
                    if best is None or candidate < best:
                        best = candidate
        if best is None or best[0] > MAX_SNAP_METERS:
            snapped[commune_id] = (UNROUTABLE_NODE, 0, 0)
            continue
        snap_meters = math.ceil(best[0])
        flags = CONNECTOR_FLAG_SNAPPED
        if snap_meters > LOW_CONFIDENCE_METERS:
            flags |= CONNECTOR_FLAG_LOW_CONFIDENCE
        snapped[commune_id] = (best[1], snap_meters, flags)
    return snapped


def _grid_cell(
    latitude: float,
    longitude: float,
    cell_degrees: float,
) -> tuple[int, int]:
    return math.floor(latitude / cell_degrees), math.floor(longitude / cell_degrees)


def spatial_cell_key(latitude: float, longitude: float) -> int:
    # Packed unsigned cell key cho runtime CSR index; phải khớp XOR formula TypeScript.
    row = math.floor((latitude + SPATIAL_LATITUDE_OFFSET) * SPATIAL_CELLS_PER_DEGREE)
    column = math.floor(
        (longitude + SPATIAL_LONGITUDE_OFFSET) * SPATIAL_CELLS_PER_DEGREE
    )
    return row * SPATIAL_COLUMNS_PER_ROW + column


def build_spatial_index(
    nodes: Sequence[RoadNode],
) -> tuple[list[int], list[int], list[int]]:
    # CSR spatial index: mỗi node thuộc đúng một cell, sắp xếp node index tăng dần trong bucket,
    # cell keys tăng dần. Deterministic vì iterate node theo index 0..N-1.
    buckets: dict[int, list[int]] = defaultdict(list)
    for node_index, node in enumerate(nodes):
        buckets[spatial_cell_key(node.latitude, node.longitude)].append(node_index)
    cell_keys = sorted(buckets)
    cell_offsets = [0]
    node_indices: list[int] = []
    for key in cell_keys:
        bucket = sorted(buckets[key])
        node_indices.extend(bucket)
        cell_offsets.append(len(node_indices))
    return cell_keys, cell_offsets, node_indices


def graph_bounds(nodes: Sequence[RoadNode]) -> tuple[float, float, float, float]:
    latitudes = [node.latitude for node in nodes]
    longitudes = [node.longitude for node in nodes]
    return (
        min(latitudes),
        max(latitudes),
        min(longitudes),
        max(longitudes),
    )


def contract_graph(
    nodes: Mapping[int, RoadNode],
    segments: Sequence[DirectedSegment],
    *,
    retained_node_ids: Iterable[int],
) -> tuple[tuple[RoadNode, ...], tuple[ContractedEdge, ...], dict[int, int]]:
    outgoing: dict[int, list[DirectedSegment]] = defaultdict(list)
    undirected_neighbors: dict[int, set[int]] = defaultdict(set)
    segment_lookup: dict[tuple[int, int], list[DirectedSegment]] = defaultdict(list)
    for segment in segments:
        outgoing[segment.source].append(segment)
        undirected_neighbors[segment.source].add(segment.target)
        undirected_neighbors[segment.target].add(segment.source)
        segment_lookup[(segment.source, segment.target)].append(segment)
    for edges in outgoing.values():
        edges.sort(key=lambda edge: (edge.target, edge.flags, edge.meters))
    for edges in segment_lookup.values():
        edges.sort(key=lambda edge: (edge.flags, edge.meters))

    keep = set(retained_node_ids)
    for node_id, neighbors in undirected_neighbors.items():
        if len(neighbors) != 2:
            keep.add(node_id)
            continue
        neighbor_a, neighbor_b = sorted(neighbors)
        incident_flags = {
            edge.flags
            for pair in (
                (node_id, neighbor_a),
                (neighbor_a, node_id),
                (node_id, neighbor_b),
                (neighbor_b, node_id),
            )
            for edge in segment_lookup.get(pair, ())
        }
        if len(incident_flags) != 1:
            keep.add(node_id)
            continue
        flags = next(iter(incident_flags))
        forward_exists = bool(
            _edge_with_flags(segment_lookup, neighbor_a, node_id, flags)
            and _edge_with_flags(segment_lookup, node_id, neighbor_b, flags)
        )
        backward_exists = bool(
            _edge_with_flags(segment_lookup, neighbor_b, node_id, flags)
            and _edge_with_flags(segment_lookup, node_id, neighbor_a, flags)
        )
        if not forward_exists and not backward_exists:
            keep.add(node_id)

    visited: set[tuple[int, int, int]] = set()
    contracted_raw: list[
        tuple[int, int, float, int, tuple[tuple[float, float], ...]]
    ] = []
    for source in sorted(keep):
        for first in outgoing.get(source, ()):
            key = (first.source, first.target, first.flags)
            if key in visited:
                continue
            visited.add(key)
            previous = source
            current = first.target
            meters = first.meters
            flags = first.flags
            geometry = [
                (nodes[source].latitude, nodes[source].longitude),
                (nodes[current].latitude, nodes[current].longitude),
            ]
            while current not in keep:
                candidates = [
                    edge
                    for edge in outgoing.get(current, ())
                    if edge.target != previous and edge.flags == flags
                ]
                if len(candidates) != 1:
                    keep.add(current)
                    break
                edge = candidates[0]
                edge_key = (edge.source, edge.target, edge.flags)
                if edge_key in visited:
                    keep.add(current)
                    break
                visited.add(edge_key)
                previous, current = current, edge.target
                meters += edge.meters
                geometry.append(
                    (nodes[current].latitude, nodes[current].longitude)
                )
            contracted_raw.append(
                (
                    source,
                    current,
                    meters,
                    flags,
                    tuple(simplify_geometry(geometry, SIMPLIFY_TOLERANCE_METERS)),
                )
            )

    used_node_ids = sorted(
        {
            endpoint
            for source, target, _, _, _ in contracted_raw
            for endpoint in (source, target)
        }
        | set(retained_node_ids)
    )
    old_to_new = {old_id: index for index, old_id in enumerate(used_node_ids)}
    contracted_nodes = tuple(nodes[node_id] for node_id in used_node_ids)
    contracted_edges = tuple(
        ContractedEdge(
            source=old_to_new[source],
            target=old_to_new[target],
            meters=max(1, math.ceil(meters)),
            flags=flags,
            geometry=geometry,
        )
        for source, target, meters, flags, geometry in sorted(
            contracted_raw,
            key=lambda item: (old_to_new[item[0]], old_to_new[item[1]], item[3]),
        )
    )
    return contracted_nodes, contracted_edges, old_to_new


def _edge_with_flags(
    lookup: Mapping[tuple[int, int], Sequence[DirectedSegment]],
    source: int,
    target: int,
    flags: int,
) -> DirectedSegment | None:
    return next(
        (
            edge
            for edge in lookup.get((source, target), ())
            if edge.flags == flags
        ),
        None,
    )


def simplify_geometry(
    points: Sequence[tuple[float, float]],
    tolerance_meters: float,
) -> tuple[tuple[float, float], ...]:
    if len(points) <= 2:
        return tuple(points)
    reference_latitude = sum(point[0] for point in points) / len(points)
    scale_x = 111_320.0 * math.cos(math.radians(reference_latitude))
    scale_y = 110_574.0
    projected = tuple((point[1] * scale_x, point[0] * scale_y) for point in points)
    keep = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        start_point = projected[start]
        end_point = projected[end]
        best_distance = -1.0
        best_index = -1
        for index in range(start + 1, end):
            distance = _point_segment_distance(
                projected[index],
                start_point,
                end_point,
            )
            if distance > best_distance:
                best_distance = distance
                best_index = index
        if best_distance > tolerance_meters:
            keep.add(best_index)
            stack.append((start, best_index))
            stack.append((best_index, end))
    return tuple(points[index] for index in sorted(keep))


def _point_segment_distance(
    point: tuple[float, float],
    start: tuple[float, float],
    end: tuple[float, float],
) -> float:
    delta_x = end[0] - start[0]
    delta_y = end[1] - start[1]
    if delta_x == 0 and delta_y == 0:
        return math.hypot(point[0] - start[0], point[1] - start[1])
    ratio = (
        (point[0] - start[0]) * delta_x + (point[1] - start[1]) * delta_y
    ) / (delta_x * delta_x + delta_y * delta_y)
    ratio = min(1.0, max(0.0, ratio))
    projected_x = start[0] + ratio * delta_x
    projected_y = start[1] + ratio * delta_y
    return math.hypot(point[0] - projected_x, point[1] - projected_y)


def build_road_graph(
    nodes: Mapping[int, RoadNode],
    segments: Sequence[DirectedSegment],
    records: Sequence[Mapping[str, object]],
) -> RoadGraph:
    records_by_id = {str(record["id"]): record for record in records}
    raw_connectors = snap_communes(nodes, records)
    retained = {
        node_id
        for node_id, _, flags in raw_connectors.values()
        if node_id != UNROUTABLE_NODE and flags & CONNECTOR_FLAG_SNAPPED
    }
    graph_nodes, graph_edges, old_to_new = contract_graph(
        nodes,
        segments,
        retained_node_ids=retained,
    )
    node_components, component_count = graph_components(
        len(graph_nodes),
        graph_edges,
    )
    connectors: list[Connector] = []
    for commune_id, (old_node_id, snap_meters, flags) in sorted(
        raw_connectors.items()
    ):
        if old_node_id == UNROUTABLE_NODE:
            connectors.append(
                Connector(
                    commune_id,
                    UNROUTABLE_NODE,
                    UNROUTABLE_NODE,
                    UNROUTABLE_NODE,
                    0,
                    (),
                )
            )
            continue
        node_id = old_to_new[old_node_id]
        connectors.append(
            Connector(
                commune_id,
                node_id,
                snap_meters,
                node_components[node_id],
                flags,
                (
                    (
                        float(
                            records_by_id[commune_id]["latitude"]
                        ),
                        float(
                            records_by_id[commune_id]["longitude"]
                        ),
                    ),
                    (
                        graph_nodes[node_id].latitude,
                        graph_nodes[node_id].longitude,
                    ),
                ),
            )
        )
    return RoadGraph(
        nodes=graph_nodes,
        edges=graph_edges,
        connectors=tuple(connectors),
        component_count=component_count,
    )


def graph_components(
    node_count: int,
    edges: Sequence[ContractedEdge],
) -> tuple[tuple[int, ...], int]:
    adjacency: list[list[int]] = [[] for _ in range(node_count)]
    for edge in edges:
        adjacency[edge.source].append(edge.target)
        adjacency[edge.target].append(edge.source)
    components = [-1] * node_count
    component_id = 0
    for start in range(node_count):
        if components[start] != -1:
            continue
        components[start] = component_id
        queue = deque([start])
        while queue:
            current = queue.popleft()
            for target in adjacency[current]:
                if components[target] == -1:
                    components[target] = component_id
                    queue.append(target)
        component_id += 1
    return tuple(components), component_id


def encode_polyline6(points: Sequence[tuple[float, float]]) -> bytes:
    output: list[str] = []
    previous_latitude = 0
    previous_longitude = 0
    for latitude, longitude in points:
        latitude_e6 = round(latitude * 1_000_000)
        longitude_e6 = round(longitude * 1_000_000)
        output.append(_encode_polyline_value(latitude_e6 - previous_latitude))
        output.append(_encode_polyline_value(longitude_e6 - previous_longitude))
        previous_latitude = latitude_e6
        previous_longitude = longitude_e6
    return "".join(output).encode("ascii")


def _encode_polyline_value(value: int) -> str:
    encoded_value = ~(value << 1) if value < 0 else value << 1
    characters: list[str] = []
    while encoded_value >= 0x20:
        characters.append(chr((0x20 | (encoded_value & 0x1F)) + 63))
        encoded_value >>= 5
    characters.append(chr(encoded_value + 63))
    return "".join(characters)


def routing_profile_payload() -> dict[str, object]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "highways": sorted(ACCEPTED_HIGHWAYS),
        "accessPrecedence": ["motorcar", "motor_vehicle", "vehicle", "access"],
        "ferry": "requires-explicit-motorcar-motor_vehicle-or-vehicle-tag",
        "blockedAccess": sorted(BLOCKED_ACCESS),
        "barriers": "block-unless-explicitly-motor-accessible",
        "degree2Contraction": True,
        "edgeWeight": "ceil-unsimplified-haversine-meters",
        "geometry": "polyline6-douglas-peucker-50m",
        "snapLowConfidenceMeters": LOW_CONFIDENCE_METERS,
        "snapMaximumMeters": MAX_SNAP_METERS,
        "spatialCellSizeDegrees": SPATIAL_CELL_SIZE_DEGREES,
        "spatialIndex": "csr-grid-nearest-node",
    }


def routing_profile_hash() -> str:
    return hashlib.sha256(
        json.dumps(
            routing_profile_payload(),
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def serialize_graph(
    graph: RoadGraph,
    spatial_index: tuple[list[int], list[int], list[int]] | None = None,
) -> bytes:
    if spatial_index is None:
        spatial_index = build_spatial_index(graph.nodes)
    cell_keys, cell_offsets, node_indices = spatial_index

    ordered_edges = sorted(
        graph.edges,
        key=lambda edge: (edge.source, edge.target, edge.flags, edge.meters),
    )
    first_edge = [0] * (len(graph.nodes) + 1)
    for edge in ordered_edges:
        first_edge[edge.source + 1] += 1
    for index in range(1, len(first_edge)):
        first_edge[index] += first_edge[index - 1]

    geometry_offsets = [0]
    geometry_deltas: list[int] = []
    for edge in ordered_edges:
        geometry_deltas.extend(_geometry_deltas_e6(edge.geometry))
        geometry_offsets.append(len(geometry_deltas) // 2)

    connector_geometry_offsets = [0]
    connector_geometry_deltas: list[int] = []
    for connector in graph.connectors:
        connector_geometry_deltas.extend(_geometry_deltas_e6(connector.geometry))
        connector_geometry_offsets.append(len(connector_geometry_deltas) // 2)

    sections: list[tuple[int, int, bytes]] = [
        (
            SECTION_NODE_LAT_E6,
            4,
            _pack_values("<i", (round(node.latitude * 1_000_000) for node in graph.nodes)),
        ),
        (
            SECTION_NODE_LNG_E6,
            4,
            _pack_values("<i", (round(node.longitude * 1_000_000) for node in graph.nodes)),
        ),
        (SECTION_CSR_OFFSETS, 4, _pack_values("<I", first_edge)),
        (
            SECTION_EDGE_TARGETS,
            4,
            _pack_values("<I", (edge.target for edge in ordered_edges)),
        ),
        (
            SECTION_EDGE_WEIGHTS_M,
            4,
            _pack_values("<I", (edge.meters for edge in ordered_edges)),
        ),
        (
            SECTION_EDGE_FLAGS,
            1,
            bytes(
                ABI_EDGE_FLAG_FERRY
                if edge.flags & INTERNAL_EDGE_FLAG_FERRY
                else 0
                for edge in ordered_edges
            ),
        ),
        (
            SECTION_EDGE_GEOMETRY_OFFSETS,
            4,
            _pack_values("<I", geometry_offsets),
        ),
        (
            SECTION_EDGE_GEOMETRY_DELTAS,
            4,
            _pack_values("<i", geometry_deltas),
        ),
        (
            SECTION_CONNECTOR_COMMUNE_IDS,
            4,
            _pack_values(
                "<I",
                (int(connector.commune_id) for connector in graph.connectors),
            ),
        ),
        (
            SECTION_CONNECTOR_NODES,
            4,
            _pack_values(
                "<i",
                (
                    -1
                    if connector.node_id == UNROUTABLE_NODE
                    else connector.node_id
                    for connector in graph.connectors
                ),
            ),
        ),
        (
            SECTION_CONNECTOR_SNAP_M,
            4,
            _pack_values(
                "<I",
                (connector.snap_meters for connector in graph.connectors),
            ),
        ),
        (
            SECTION_CONNECTOR_GEOMETRY_OFFSETS,
            4,
            _pack_values("<I", connector_geometry_offsets),
        ),
        (
            SECTION_CONNECTOR_GEOMETRY_DELTAS,
            4,
            _pack_values("<i", connector_geometry_deltas),
        ),
        (
            SECTION_SPATIAL_CELL_KEYS,
            4,
            _pack_values("<I", cell_keys),
        ),
        (
            SECTION_SPATIAL_CELL_OFFSETS,
            4,
            _pack_values("<I", cell_offsets),
        ),
        (
            SECTION_SPATIAL_NODE_INDICES,
            4,
            _pack_values("<I", node_indices),
        ),
    ]
    return _serialize_sections(graph, sections)


def _pack_values(format_string: str, values: Iterable[int]) -> bytes:
    packer = struct.Struct(format_string)
    return b"".join(packer.pack(value) for value in values)


def _geometry_deltas_e6(
    points: Sequence[tuple[float, float]],
) -> tuple[int, ...]:
    if not points:
        return ()
    output: list[int] = []
    previous_latitude = 0
    previous_longitude = 0
    for index, (latitude, longitude) in enumerate(points):
        latitude_e6 = round(latitude * 1_000_000)
        longitude_e6 = round(longitude * 1_000_000)
        if index == 0:
            output.extend((latitude_e6, longitude_e6))
        else:
            output.extend(
                (
                    latitude_e6 - previous_latitude,
                    longitude_e6 - previous_longitude,
                )
            )
        previous_latitude = latitude_e6
        previous_longitude = longitude_e6
    return tuple(output)


def _serialize_sections(
    graph: RoadGraph,
    sections: Sequence[tuple[int, int, bytes]],
) -> bytes:
    if len(sections) != SECTION_COUNT:
        raise ValueError("invalid section count")
    offset = _align(HEADER_BYTES, 8)
    directory: list[bytes] = []
    payload = bytearray(offset)
    for section_id, element_width, content in sections:
        offset = _align(len(payload), max(8, element_width))
        if offset > len(payload):
            payload.extend(b"\0" * (offset - len(payload)))
        directory.append(
            SECTION_STRUCT.pack(
                section_id,
                element_width,
                0,
                offset,
                len(content),
                len(content) // element_width,
            )
        )
        payload.extend(content)
    header = HEADER_STRUCT.pack(
        MAGIC,
        SCHEMA_VERSION,
        SECTION_COUNT,
        HEADER_BYTES,
        len(graph.nodes),
        len(graph.edges),
        len(graph.connectors),
        0,
        0,
    )
    payload[: HEADER_STRUCT.size] = header
    directory_bytes = b"".join(directory)
    payload[HEADER_STRUCT.size : HEADER_STRUCT.size + len(directory_bytes)] = (
        directory_bytes
    )
    return bytes(payload)


def _align(value: int, alignment: int) -> int:
    return (value + alignment - 1) // alignment * alignment


def parse_binary_header(payload: bytes) -> dict[str, object]:
    if len(payload) < HEADER_BYTES:
        raise ValueError("road graph binary is truncated")
    (
        magic,
        schema_version,
        section_count,
        header_bytes,
        node_count,
        edge_count,
        connector_count,
        flags,
        reserved,
    ) = HEADER_STRUCT.unpack_from(payload)
    if magic != MAGIC:
        raise ValueError("invalid road graph magic")
    if schema_version != SCHEMA_VERSION:
        raise ValueError("unsupported road graph schema")
    if (
        section_count != SECTION_COUNT
        or header_bytes != HEADER_BYTES
        or flags != 0
        or reserved != 0
    ):
        raise ValueError("invalid road graph header")
    sections: dict[int, dict[str, int]] = {}
    cursor = HEADER_STRUCT.size
    for _ in range(section_count):
        section_id, element_width, section_flags, offset, length, element_count = (
            SECTION_STRUCT.unpack_from(payload, cursor)
        )
        cursor += SECTION_STRUCT.size
        if (
            section_flags != 0
            or section_id in sections
            or offset + length > len(payload)
            or element_width == 0
            or offset % max(8, element_width) != 0
            or length != element_width * element_count
        ):
            raise ValueError("invalid road graph section")
        sections[section_id] = {
            "elementWidth": element_width,
            "offset": offset,
            "length": length,
            "elementCount": element_count,
        }
    if set(sections) != set(range(1, SECTION_COUNT + 1)):
        raise ValueError("road graph sections are incomplete")
    return {
        "schemaVersion": schema_version,
        "nodeCount": node_count,
        "edgeCount": edge_count,
        "connectorCount": connector_count,
        "sections": sections,
    }


def build_road_graph_artifact(
    *,
    pbf_path: Path,
    dataset_path: Path,
    asset_directory: Path,
    manifest_path: Path,
) -> dict[str, object]:
    dataset_payload = json.loads(dataset_path.read_text(encoding="utf-8"))
    records = dataset_payload["records"]
    dataset_manifest = dataset_payload["manifest"]
    geometry_inputs = [
        item
        for item in dataset_manifest["inputs"]
        if item["role"] == "geometry"
        and item["archivePath"].endswith(pbf_path.name)
    ]
    if len(geometry_inputs) != 1:
        raise ValueError("pinned road PBF is not uniquely present in dataset inputs")
    osm_input = geometry_inputs[0]
    pbf_sha256 = sha256_file(pbf_path)
    if pbf_sha256 != osm_input["sha256"]:
        raise ValueError("road PBF sha256 does not match the pinned dataset input")

    started = time.monotonic()
    nodes, segments = load_directed_roads(pbf_path)
    print("road-graph: snapping and contracting topology", file=sys.stderr, flush=True)
    graph = build_road_graph(nodes, segments, records)
    print(
        "road-graph: topology ready "
        f"nodes={len(graph.nodes)} edges={len(graph.edges)} "
        f"components={graph.component_count} elapsed={time.monotonic() - started:.1f}s",
        file=sys.stderr,
        flush=True,
    )
    print("road-graph: serializing ABI v2", file=sys.stderr, flush=True)
    spatial_index = build_spatial_index(graph.nodes)
    cell_keys, _cell_offsets, _node_indices = spatial_index
    (
        minimum_latitude,
        maximum_latitude,
        minimum_longitude,
        maximum_longitude,
    ) = graph_bounds(graph.nodes)
    binary = serialize_graph(graph, spatial_index)
    if len(binary) >= MAX_ASSET_BYTES:
        raise ValueError("road graph asset exceeds 25 MiB")
    decoded_bytes = estimate_decoded_bytes(graph, len(binary))
    if decoded_bytes >= MAX_DECODED_BYTES:
        raise ValueError("road graph estimated decoded memory exceeds 64 MiB")

    asset_sha256 = hashlib.sha256(binary).hexdigest()
    asset_directory.mkdir(parents=True, exist_ok=True)
    asset_name = f"{asset_sha256}.bin"
    asset_path = asset_directory / asset_name
    asset_path.write_bytes(binary)
    relative_asset_path = f"/road-graph/{asset_name}"
    snapped_count = sum(
        connector.node_id != UNROUTABLE_NODE for connector in graph.connectors
    )
    manifest: dict[str, object] = {
        "schemaVersion": SCHEMA_VERSION,
        "graphVersion": f"v2-{asset_sha256[:16]}",
        "communeDatasetVersion": dataset_manifest["version"],
        "communeDatasetSha256": dataset_manifest["runtimeDatasetSha256"],
        "osmAsOf": osm_input["effectiveAt"],
        "osmSourceSha256": pbf_sha256,
        "routingProfileHash": routing_profile_hash(),
        "assetPath": relative_asset_path,
        "assetSha256": asset_sha256,
        "sizeBytes": len(binary),
        "nodeCount": len(graph.nodes),
        "edgeCount": len(graph.edges),
        "snappedCommuneCount": snapped_count,
        "unroutableCommuneCount": len(graph.connectors) - snapped_count,
        "spatialCellSizeDegrees": SPATIAL_CELL_SIZE_DEGREES,
        "spatialCellCount": len(cell_keys),
        "spatialIndexNodeCount": len(graph.nodes),
        "snapMaximumMeters": MAX_SNAP_METERS,
        "minimumLatitude": minimum_latitude,
        "maximumLatitude": maximum_latitude,
        "minimumLongitude": minimum_longitude,
        "maximumLongitude": maximum_longitude,
        "attribution": osm_input["attribution"],
        "licenseUrl": osm_input["licenseUrl"],
        "shareAlikeNotice": osm_input["shareAlikeNotice"],
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n",
        encoding="utf-8",
    )
    print(
        "road-graph: artifact complete "
        f"bytes={len(binary)} sha256={asset_sha256} "
        f"elapsed={time.monotonic() - started:.1f}s",
        file=sys.stderr,
        flush=True,
    )
    return manifest


def validate_road_graph_artifact(
    *,
    manifest_path: Path,
    asset_root: Path,
    dataset_path: Path | None = None,
) -> dict[str, object]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    required_fields = {
        "schemaVersion",
        "graphVersion",
        "communeDatasetVersion",
        "communeDatasetSha256",
        "osmAsOf",
        "osmSourceSha256",
        "routingProfileHash",
        "assetPath",
        "assetSha256",
        "sizeBytes",
        "nodeCount",
        "edgeCount",
        "snappedCommuneCount",
        "unroutableCommuneCount",
        "spatialCellSizeDegrees",
        "spatialCellCount",
        "spatialIndexNodeCount",
        "snapMaximumMeters",
        "minimumLatitude",
        "maximumLatitude",
        "minimumLongitude",
        "maximumLongitude",
        "attribution",
        "licenseUrl",
        "shareAlikeNotice",
    }
    if set(manifest) != required_fields or manifest["schemaVersion"] != SCHEMA_VERSION:
        raise ValueError("invalid road graph manifest")
    asset_path = asset_root / str(manifest["assetPath"]).lstrip("/")
    payload = asset_path.read_bytes()
    if len(payload) != manifest["sizeBytes"]:
        raise ValueError("road graph size mismatch")
    if hashlib.sha256(payload).hexdigest() != manifest["assetSha256"]:
        raise ValueError("road graph checksum mismatch")
    header = parse_binary_header(payload)
    if (
        header["nodeCount"] != manifest["nodeCount"]
        or header["edgeCount"] != manifest["edgeCount"]
        or header["connectorCount"]
        != manifest["snappedCommuneCount"] + manifest["unroutableCommuneCount"]
    ):
        raise ValueError("road graph binary and manifest differ")
    sections = header["sections"]
    if (
        manifest["spatialCellSizeDegrees"] != SPATIAL_CELL_SIZE_DEGREES
        or manifest["snapMaximumMeters"] != MAX_SNAP_METERS
        or manifest["spatialIndexNodeCount"] != manifest["nodeCount"]
        or manifest["spatialCellCount"] <= 0
        or sections[SECTION_SPATIAL_CELL_KEYS]["elementCount"]
        != manifest["spatialCellCount"]
        or sections[SECTION_SPATIAL_CELL_OFFSETS]["elementCount"]
        != manifest["spatialCellCount"] + 1
        or sections[SECTION_SPATIAL_NODE_INDICES]["elementCount"]
        != manifest["spatialIndexNodeCount"]
    ):
        raise ValueError("road graph spatial index mismatch")
    if (
        manifest["minimumLatitude"] > manifest["maximumLatitude"]
        or manifest["minimumLongitude"] > manifest["maximumLongitude"]
        or not -90 <= manifest["minimumLatitude"] <= 90
        or not -90 <= manifest["maximumLatitude"] <= 90
        or not -180 <= manifest["minimumLongitude"] <= 180
        or not -180 <= manifest["maximumLongitude"] <= 180
    ):
        raise ValueError("road graph bounds are invalid")
    if dataset_path is not None:
        dataset = json.loads(dataset_path.read_text(encoding="utf-8"))
        dataset_manifest = dataset["manifest"]
        if (
            dataset_manifest["version"] != manifest["communeDatasetVersion"]
            or dataset_manifest["runtimeDatasetSha256"]
            != manifest["communeDatasetSha256"]
            or len(dataset["records"]) != header["connectorCount"]
        ):
            raise ValueError("road graph commune dataset drift")
    return header


def estimate_decoded_bytes(graph: RoadGraph, asset_size: int) -> int:
    search_workspace = len(graph.nodes) * (8 + 4 + 4 + 1)
    return asset_size + search_workspace


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
