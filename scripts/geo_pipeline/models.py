from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from shapely.geometry.base import BaseGeometry

CommuneType = Literal["xa", "phuong", "dac-khu"]
SourceRole = Literal["commune-catalog", "province-catalog", "geometry"]
ReconciliationStatus = Literal[
    "matched_osm_relation",
    "unmapped_in_osm",
    "ambiguous_needs_review",
]


@dataclass(frozen=True, slots=True)
class SourceInput:
    role: SourceRole
    source_url: str
    checksum_url: str
    checksum_md5: str
    archive_name: str
    effective_at: str
    retrieved_at: str
    sha256: str
    attribution: str
    license_url: str
    share_alike_notice: str
    derived_database_notice: str
    byte_limit: int


@dataclass(frozen=True, slots=True)
class DatasetInput:
    role: SourceRole
    source_url: str
    archive_path: str
    effective_at: str
    retrieved_at: str
    sha256: str
    attribution: str
    license_url: str
    share_alike_notice: str
    derived_database_notice: str


@dataclass(frozen=True, slots=True)
class ArchivedArtifact:
    path: Path
    digest: str
    size_bytes: int


@dataclass(frozen=True, slots=True)
class CatalogRecord:
    id: str
    name: str
    type: CommuneType
    province_id: str
    province_name: str | None = None
    wikidata: str | None = None


@dataclass(frozen=True, slots=True)
class CommuneCentroid:
    id: str
    name: str
    type: CommuneType
    province_id: str
    latitude: float
    longitude: float
    centroid_outside_geometry: bool


@dataclass(frozen=True, slots=True)
class OSMRelation:
    relation_id: int
    name: str
    type: str
    boundary: str
    admin_level: int
    province_id: str
    tags: dict[str, str] = field(default_factory=dict)
    geometry: BaseGeometry | None = None


@dataclass(frozen=True, slots=True)
class GeometryCentroid:
    latitude: float
    longitude: float
    centroid_outside_geometry: bool


@dataclass(frozen=True, slots=True)
class ReconciliationRow:
    catalog_id: str
    status: ReconciliationStatus
    relation_ids: tuple[int, ...] = ()
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class ReconciliationReport:
    rows: tuple[ReconciliationRow, ...]
    counts: dict[str, int]


@dataclass(frozen=True, slots=True)
class RuntimeManifest:
    schema_version: Literal[1]
    version: str
    as_of: str
    generated_at: str
    record_count: int
    runtime_dataset_sha256: str
    inputs: tuple[DatasetInput, ...]


@dataclass(frozen=True, slots=True)
class RuntimeDataset:
    manifest: RuntimeManifest
    records: tuple[CommuneCentroid, ...]
