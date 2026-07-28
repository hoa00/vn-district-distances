from __future__ import annotations

import hashlib
from pathlib import Path

from scripts.geo_pipeline.pipeline import archive_raw_asset, load_sources


def test_load_sources_keeps_timestamped_geofabrik_snapshot_and_license_metadata() -> None:
    sources = load_sources(Path("data/sources.yaml"))

    geometry = next(item for item in sources if item.role == "geometry")

    assert geometry.source_url.endswith("vietnam-260727.osm.pbf")
    assert geometry.checksum_url.endswith(".md5")
    assert geometry.checksum_md5 == "0c4397b566463e07f6f50a8e885a82ae"
    assert geometry.byte_limit == 400 * 1024 * 1024
    assert "OpenStreetMap" in geometry.attribution
    assert "ODbL" in geometry.derived_database_notice


def test_archive_raw_asset_uses_content_addressed_sha256_path(tmp_path: Path) -> None:
    source_file = tmp_path / "input.bin"
    source_file.write_bytes(b"snapshot")

    archived = archive_raw_asset(source_file, tmp_path / "archive")

    assert archived.digest == hashlib.sha256(b"snapshot").hexdigest()
    assert archived.path.as_posix().endswith(
        f"archive/sha256/{hashlib.sha256(b'snapshot').hexdigest()}/input.bin"
    )
    assert archived.size_bytes == 8
