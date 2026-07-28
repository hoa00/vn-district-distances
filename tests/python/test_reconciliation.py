from __future__ import annotations

import pytest

from scripts.geo_pipeline.models import CatalogRecord, OSMRelation
from scripts.geo_pipeline.pipeline import reconcile_catalog_to_relations, require_release_ready


def test_reconcile_catalog_to_relations_classifies_missing_duplicate_and_match() -> None:
    catalog = [
        CatalogRecord(id="00001", name="Phường An Lợi", type="phuong", province_id="01"),
        CatalogRecord(id="00002", name="Xã Bình Minh", type="xa", province_id="02"),
        CatalogRecord(id="00003", name="Đặc khu Côn Đảo", type="dac-khu", province_id="79"),
    ]
    relations = [
        OSMRelation(
            relation_id=101,
            name="Phường An Lợi",
            type="boundary",
            boundary="administrative",
            admin_level=6,
            province_id="01",
            tags={"wikidata": "Q1"},
        ),
        OSMRelation(
            relation_id=102,
            name="Xã Bình Minh",
            type="boundary",
            boundary="administrative",
            admin_level=6,
            province_id="02",
            tags={"wikidata": "Q2"},
        ),
        OSMRelation(
            relation_id=103,
            name="Xã Bình Minh",
            type="boundary",
            boundary="administrative",
            admin_level=6,
            province_id="02",
            tags={"wikidata": "Q3"},
        ),
    ]

    report = reconcile_catalog_to_relations(catalog, relations)

    assert report.counts["matched_osm_relation"] == 1
    assert report.counts["ambiguous_needs_review"] == 1
    assert report.counts["unmapped_in_osm"] == 1


def test_require_release_ready_rejects_non_3321_catalog() -> None:
    with pytest.raises(ValueError, match="3,321"):
        require_release_ready(matched_count=2, expected_count=3321)


def test_reconciliation_uses_unique_unscoped_island_relation_without_fabrication() -> None:
    catalog = [
        CatalogRecord(
            id="20333",
            name="Đặc khu Hoàng Sa",
            type="dac-khu",
            province_id="48",
        )
    ]
    relations = [
        OSMRelation(
            relation_id=20333,
            name="Đặc khu Hoàng Sa",
            type="boundary",
            boundary="administrative",
            admin_level=6,
            province_id="",
        )
    ]

    report = reconcile_catalog_to_relations(catalog, relations)

    assert report.counts == {
        "matched_osm_relation": 1,
        "unmapped_in_osm": 0,
        "ambiguous_needs_review": 0,
    }


def test_reconciliation_normalizes_decomposed_vietnamese_diacritics() -> None:
    catalog = [
        CatalogRecord(
            id="20333",
            name="Đặc khu Hoàng Sa",
            type="dac-khu",
            province_id="48",
        )
    ]
    relations = [
        OSMRelation(
            relation_id=20333,
            name="Đặc khu Hoàng Sa",
            type="boundary",
            boundary="administrative",
            admin_level=6,
            province_id="48",
        )
    ]

    report = reconcile_catalog_to_relations(catalog, relations)

    assert report.counts["matched_osm_relation"] == 1


def test_reconciliation_uses_unique_global_name_when_osm_parent_scope_is_wrong() -> None:
    catalog = [
        CatalogRecord(
            id="22736",
            name="Đặc khu Trường Sa",
            type="dac-khu",
            province_id="56",
        )
    ]
    relations = [
        OSMRelation(
            relation_id=3479413,
            name="Đặc khu Trường Sa",
            type="boundary",
            boundary="administrative",
            admin_level=6,
            province_id="48",
        )
    ]

    report = reconcile_catalog_to_relations(catalog, relations)

    assert report.counts["matched_osm_relation"] == 1
