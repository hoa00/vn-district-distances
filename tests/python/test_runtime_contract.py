from __future__ import annotations

import json
from dataclasses import replace

import pytest

from scripts.geo_pipeline.models import (
    CommuneCentroid,
    DatasetInput,
    RuntimeDataset,
    RuntimeManifest,
)
from scripts.geo_pipeline.pipeline import (
    load_runtime_dataset,
    serialize_runtime_dataset,
    sha256_json,
    validate_runtime_dataset,
)


def _input(role: str, digest_character: str) -> DatasetInput:
    digest = digest_character * 64
    is_geometry = role == "geometry"
    return DatasetInput(
        role=role,  # type: ignore[arg-type]
        source_url=f"https://example.test/{role}",
        archive_path=f"data/raw/sha256/{digest}/{role}.bin",
        effective_at="2026-07-27",
        retrieved_at="2026-07-28T00:00:00Z",
        sha256=digest,
        attribution=(
            "OpenStreetMap contributors" if is_geometry else "Vietnam NSO"
        ),
        license_url=(
            "https://opendatacommons.org/licenses/odbl/1-0/"
            if is_geometry
            else "https://example.test/public-data"
        ),
        share_alike_notice=(
            "ODbL share-alike applies." if is_geometry else "Public data notice."
        ),
        derived_database_notice="Derived database provenance notice.",
    )


def _dataset() -> RuntimeDataset:
    manifest = RuntimeManifest(
        schema_version=1,
        version="test",
        as_of="2026-07-27",
        generated_at="2026-07-28T00:00:00Z",
        record_count=1,
        runtime_dataset_sha256="",
        inputs=(
            _input("commune-catalog", "a"),
            _input("province-catalog", "b"),
            _input("geometry", "c"),
        ),
    )
    record = CommuneCentroid(
        id="00004",
        name="Phường Ba Đình",
        type="phuong",
        province_id="01",
        latitude=21.034,
        longitude=105.814,
        centroid_outside_geometry=False,
    )
    draft = RuntimeDataset(manifest=manifest, records=(record,))
    digest = sha256_json(json.loads(serialize_runtime_dataset(draft)))
    return RuntimeDataset(
        manifest=replace(manifest, runtime_dataset_sha256=digest),
        records=(record,),
    )


def test_runtime_json_matches_the_typescript_camel_case_contract(tmp_path) -> None:
    dataset = _dataset()
    serialized = serialize_runtime_dataset(dataset)
    payload = json.loads(serialized)

    assert "runtimeDatasetSha256" in payload["manifest"]
    assert "sourceUrl" in payload["manifest"]["inputs"][0]
    assert "source_url" not in payload["manifest"]["inputs"][0]
    assert payload["records"][0]["provinceId"] == "01"
    assert "province_id" not in payload["records"][0]

    path = tmp_path / "runtime-dataset.json"
    path.write_text(serialized, encoding="utf-8")
    loaded = load_runtime_dataset(path)
    validate_runtime_dataset(loaded, expected_count=1)


def test_runtime_validation_rejects_manifest_count_drift() -> None:
    dataset = _dataset()
    invalid = replace(
        dataset,
        manifest=replace(dataset.manifest, record_count=2),
    )

    with pytest.raises(ValueError, match="record count"):
        validate_runtime_dataset(invalid, expected_count=1)


def test_runtime_serialization_is_record_order_independent() -> None:
    first = _dataset()
    second_record = replace(
        first.records[0],
        id="00008",
        name="Phường Ngọc Hà",
    )
    manifest = replace(first.manifest, record_count=2)
    forward = RuntimeDataset(
        manifest=manifest,
        records=(first.records[0], second_record),
    )
    reverse = RuntimeDataset(
        manifest=manifest,
        records=(second_record, first.records[0]),
    )

    assert serialize_runtime_dataset(forward) == serialize_runtime_dataset(reverse)
