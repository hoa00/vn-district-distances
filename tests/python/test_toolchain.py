import pytest
from pyproj import Transformer
from shapely.geometry import Point


def test_equal_area_toolchain_round_trips_wgs84_point() -> None:
    to_equal_area = Transformer.from_crs("EPSG:4326", "EPSG:6933", always_xy=True)
    to_wgs84 = Transformer.from_crs("EPSG:6933", "EPSG:4326", always_xy=True)

    source = Point(105.814, 21.034)
    projected = Point(*to_equal_area.transform(source.x, source.y))
    restored = Point(*to_wgs84.transform(projected.x, projected.y))

    assert restored.x == pytest.approx(source.x, abs=1e-7)
    assert restored.y == pytest.approx(source.y, abs=1e-7)
