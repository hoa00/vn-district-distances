from __future__ import annotations

from shapely.geometry import Point, Polygon

from scripts.geo_pipeline.pipeline import (
    centroid_from_polygon_wgs84,
    extract_admin_level_6_relations_from_pbf,
    extract_overridden_relations_from_pbf,
    make_valid_polygonal,
    point_is_covered_by_polygon,
)


def test_make_valid_polygonal_repairs_self_intersection() -> None:
    bow_tie = Polygon([(0, 0), (2, 2), (0, 2), (2, 0), (0, 0)])

    repaired = make_valid_polygonal(bow_tie)

    assert not repaired.is_empty
    assert repaired.geom_type in {"Polygon", "MultiPolygon"}


def test_centroid_from_polygon_wgs84_uses_equal_area_projection() -> None:
    square = Polygon([(105.0, 21.0), (105.2, 21.0), (105.2, 21.2), (105.0, 21.2), (105.0, 21.0)])

    centroid = centroid_from_polygon_wgs84(square)

    assert 105.0 < centroid.longitude < 105.2
    assert 21.0 < centroid.latitude < 21.2
    assert centroid.centroid_outside_geometry is False


def test_point_is_covered_by_polygon_treats_boundary_as_inside() -> None:
    polygon = Polygon([(0, 0), (1, 0), (1, 1), (0, 1), (0, 0)])
    boundary_point = Point(1, 0.5)

    assert point_is_covered_by_polygon(polygon, boundary_point) is True


def test_pyosmium_extracts_relation_geometry_and_parent_province(tmp_path) -> None:
    osm = tmp_path / "fixture.osm"
    osm.write_text(
        """<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6">
  <node id="1" lat="21.0" lon="105.0"/>
  <node id="2" lat="21.0" lon="105.1"/>
  <node id="3" lat="21.1" lon="105.1"/>
  <node id="4" lat="21.1" lon="105.0"/>
  <node id="5" lat="20.9" lon="104.9"/>
  <node id="6" lat="20.9" lon="105.2"/>
  <node id="7" lat="21.2" lon="105.2"/>
  <node id="8" lat="21.2" lon="104.9"/>
  <way id="100">
    <nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/>
  </way>
  <way id="200">
    <nd ref="5"/><nd ref="6"/><nd ref="7"/><nd ref="8"/><nd ref="5"/>
  </way>
  <relation id="10">
    <member type="way" ref="200" role="outer"/>
    <member type="relation" ref="20" role="subarea"/>
    <tag k="type" v="boundary"/>
    <tag k="boundary" v="administrative"/>
    <tag k="admin_level" v="4"/>
    <tag k="name" v="Thành phố Hà Nội"/>
  </relation>
  <relation id="20">
    <member type="way" ref="100" role="outer"/>
    <tag k="type" v="boundary"/>
    <tag k="boundary" v="administrative"/>
    <tag k="admin_level" v="6"/>
    <tag k="name" v="Phường Ba Đình"/>
  </relation>
</osm>
""",
        encoding="utf-8",
    )

    relations = extract_admin_level_6_relations_from_pbf(
        osm,
        province_ids={"thành phố hà nội": "01"},
    )

    assert len(relations) == 1
    assert relations[0].relation_id == 20
    assert relations[0].province_id == "01"
    assert relations[0].geometry is not None


def test_pyosmium_extracts_reviewed_disputed_boundary_override(tmp_path) -> None:
    osm = tmp_path / "disputed.osm"
    osm.write_text(
        """<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6">
  <node id="1" lat="16.0" lon="111.0"/>
  <node id="2" lat="16.0" lon="111.1"/>
  <node id="3" lat="16.1" lon="111.1"/>
  <node id="4" lat="16.1" lon="111.0"/>
  <way id="100">
    <nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/>
  </way>
  <relation id="17296617">
    <member type="way" ref="100" role="outer"/>
    <tag k="type" v="boundary"/>
    <tag k="boundary" v="disputed"/>
    <tag k="name" v="Paracel Islands"/>
  </relation>
</osm>
""",
        encoding="utf-8",
    )

    relations = extract_overridden_relations_from_pbf(
        osm,
        overrides={17296617: ("20333", "Đặc khu Hoàng Sa", "48")},
    )

    assert len(relations) == 1
    assert relations[0].name == "Đặc khu Hoàng Sa"
    assert relations[0].province_id == "48"
    assert relations[0].tags["catalog:id"] == "20333"
    assert relations[0].tags["source:boundary"] == "disputed"
    assert relations[0].geometry is not None
