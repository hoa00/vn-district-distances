from __future__ import annotations

import hashlib
import json
import struct
from pathlib import Path

import pytest

from scripts.geo_pipeline.road_graph import (
    ABI_EDGE_FLAG_FERRY,
    CONNECTOR_FLAG_LOW_CONFIDENCE,
    DirectedSegment,
    HEADER_BYTES,
    HEADER_STRUCT,
    INTERNAL_EDGE_FLAG_FERRY,
    RoadNode,
    SECTION_COUNT,
    SECTION_EDGE_FLAGS,
    UNROUTABLE_NODE,
    build_road_graph,
    contract_graph,
    parse_binary_header,
    serialize_graph,
    simplify_geometry,
    validate_road_graph_artifact,
    way_policy,
)


def test_way_policy_respects_direction_access_and_ferry() -> None:
    one_way = way_policy({"highway": "primary", "oneway": "yes"})
    reverse = way_policy({"highway": "secondary_link", "oneway": "-1"})
    private = way_policy({"highway": "tertiary", "access": "private"})
    ferry = way_policy({"route": "ferry", "motor_vehicle": "yes"})
    foot_ferry = way_policy({"route": "ferry", "foot": "yes"})
    blocked_car = way_policy({"highway": "primary", "motorcar": "no"})
    blocked_car_ferry = way_policy(
        {"route": "ferry", "motorcar": "no", "motor_vehicle": "yes"}
    )

    assert (one_way.accepted, one_way.forward, one_way.backward) == (
        True,
        True,
        False,
    )
    assert (reverse.accepted, reverse.forward, reverse.backward) == (
        True,
        False,
        True,
    )
    assert private.accepted is False
    assert ferry.accepted is True
    assert ferry.flags & INTERNAL_EDGE_FLAG_FERRY
    assert foot_ferry.accepted is False
    assert blocked_car.accepted is False
    assert blocked_car_ferry.accepted is False


def test_contraction_preserves_unsimplified_weight_and_retained_snap() -> None:
    nodes = {
        1: RoadNode(1, 10.0, 106.0),
        2: RoadNode(2, 10.001, 106.001),
        3: RoadNode(3, 10.002, 106.0),
        4: RoadNode(4, 10.003, 106.0),
    }
    segments = (
        DirectedSegment(1, 2, 100, 1),
        DirectedSegment(2, 3, 125, 1),
        DirectedSegment(3, 4, 150, 1),
    )

    graph_nodes, graph_edges, old_to_new = contract_graph(
        nodes,
        segments,
        retained_node_ids={1, 4},
    )

    assert len(graph_nodes) == 2
    assert old_to_new == {1: 0, 4: 1}
    assert len(graph_edges) == 1
    assert graph_edges[0].meters == 375
    assert graph_edges[0].source == 0
    assert graph_edges[0].target == 1
    assert graph_edges[0].geometry[0] == (10.0, 106.0)
    assert graph_edges[0].geometry[-1] == (10.003, 106.0)


def test_simplification_keeps_endpoints() -> None:
    points = (
        (10.0, 106.0),
        (10.0001, 106.0001),
        (10.0002, 106.0002),
        (10.001, 106.001),
    )

    simplified = simplify_geometry(points, tolerance_meters=50)

    assert simplified == (points[0], points[-1])


def test_connectors_apply_low_confidence_and_unroutable_thresholds() -> None:
    nodes = {
        1: RoadNode(1, 10.0, 106.0),
        2: RoadNode(2, 10.01, 106.0),
    }
    segments = (
        DirectedSegment(1, 2, 1_106, 1),
        DirectedSegment(2, 1, 1_106, 1),
    )
    records = (
        {"id": "00001", "latitude": 10.0, "longitude": 106.0},
        {"id": "00002", "latitude": 10.021, "longitude": 106.0},
        {"id": "00003", "latitude": 10.2, "longitude": 106.0},
    )

    graph = build_road_graph(nodes, segments, records)
    connectors = {connector.commune_id: connector for connector in graph.connectors}

    assert connectors["00001"].snap_meters == 0
    assert connectors["00002"].flags & CONNECTOR_FLAG_LOW_CONFIDENCE
    assert connectors["00003"].node_id == UNROUTABLE_NODE
    assert connectors["00003"].snap_meters == UNROUTABLE_NODE
    assert connectors["00003"].geometry == ()


def test_binary_abi_is_exact_and_deterministic() -> None:
    nodes = {
        1: RoadNode(1, 10.0, 106.0),
        2: RoadNode(2, 10.01, 106.0),
    }
    segments = (
        DirectedSegment(1, 2, 1_106, INTERNAL_EDGE_FLAG_FERRY),
        DirectedSegment(2, 1, 1_106, INTERNAL_EDGE_FLAG_FERRY),
    )
    records = (
        {"id": "00001", "latitude": 10.0, "longitude": 106.0},
        {"id": "00002", "latitude": 10.01, "longitude": 106.0},
    )
    graph = build_road_graph(nodes, segments, records)

    first = serialize_graph(graph)
    second = serialize_graph(graph)
    header = parse_binary_header(first)
    flags_section = header["sections"][SECTION_EDGE_FLAGS]
    edge_flags = first[
        flags_section["offset"] : flags_section["offset"] + flags_section["length"]
    ]

    assert first == second
    assert HEADER_STRUCT.size == 32
    assert HEADER_BYTES == 240
    assert struct.unpack_from("<H", first, 6)[0] == SECTION_COUNT == 13
    assert edge_flags == bytes([ABI_EDGE_FLAG_FERRY, ABI_EDGE_FLAG_FERRY])
    assert header["sections"][8]["elementCount"] == 8
    assert header["sections"][13]["elementCount"] == 8


def test_validation_rejects_corruption_and_dataset_drift(tmp_path: Path) -> None:
    nodes = {
        1: RoadNode(1, 10.0, 106.0),
        2: RoadNode(2, 10.01, 106.0),
    }
    graph = build_road_graph(
        nodes,
        (
            DirectedSegment(1, 2, 1_106, 1),
            DirectedSegment(2, 1, 1_106, 1),
        ),
        (
            {"id": "00001", "latitude": 10.0, "longitude": 106.0},
            {"id": "00002", "latitude": 10.01, "longitude": 106.0},
        ),
    )
    payload = serialize_graph(graph)
    digest = hashlib.sha256(payload).hexdigest()
    asset = tmp_path / "road-graph" / f"{digest}.bin"
    asset.parent.mkdir()
    asset.write_bytes(payload)
    manifest = {
        "schemaVersion": 1,
        "graphVersion": f"v1-{digest[:16]}",
        "communeDatasetVersion": "dataset-v1",
        "communeDatasetSha256": "a" * 64,
        "osmAsOf": "2026-07-27T20:21:20Z",
        "osmSourceSha256": "b" * 64,
        "routingProfileHash": "c" * 64,
        "assetPath": f"/road-graph/{digest}.bin",
        "assetSha256": digest,
        "sizeBytes": len(payload),
        "nodeCount": len(graph.nodes),
        "edgeCount": len(graph.edges),
        "snappedCommuneCount": 2,
        "unroutableCommuneCount": 0,
        "attribution": "OpenStreetMap contributors",
        "licenseUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
        "shareAlikeNotice": "ODbL applies.",
    }
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    header = validate_road_graph_artifact(
        manifest_path=manifest_path,
        asset_root=tmp_path,
    )
    assert header["connectorCount"] == 2

    asset.write_bytes(payload[:-1] + bytes([payload[-1] ^ 0x01]))
    with pytest.raises(ValueError, match="checksum"):
        validate_road_graph_artifact(
            manifest_path=manifest_path,
            asset_root=tmp_path,
        )


def test_header_rejects_wrong_magic() -> None:
    with pytest.raises(ValueError, match="magic"):
        parse_binary_header(b"BAD!" + bytes(HEADER_BYTES - 4))
