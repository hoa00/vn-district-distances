from __future__ import annotations

from pathlib import Path

import pytest

from scripts.geo_pipeline.models import CatalogRecord
from scripts.geo_pipeline.pipeline import load_catalog_records, load_catalog_text_pages
from tests.python.fixtures import CATALOG_TEXT_PAGE


def test_load_catalog_text_pages_extracts_string_ids_and_commune_types(tmp_path: Path) -> None:
    pdf = tmp_path / "catalog.pdf"
    pdf.write_bytes(b"ignored")

    records = load_catalog_records(
        pdf,
        text_pages=lambda _path: [CATALOG_TEXT_PAGE],
    )

    assert [record.id for record in records] == ["00001", "00002", "00003"]
    assert records[0].province_id == "01"
    assert records[2].type == "dac-khu"


def test_load_catalog_text_pages_rejects_malformed_rows() -> None:
    with pytest.raises(ValueError, match="catalog row"):
        load_catalog_text_pages(["00001 | only three fields | xa"])


def test_load_catalog_text_pages_parses_the_official_pdf_layout() -> None:
    records = load_catalog_text_pages(
        ["57 10273  Xã Phú Xuyên Thành phố Hà Nội"],
        province_ids={"thành phố hà nội": "01"},
    )

    assert records == (
        CatalogRecord(
            id="10273",
            name="Xã Phú Xuyên",
            type="xa",
            province_id="01",
            province_name="Thành phố Hà Nội",
        ),
    )
