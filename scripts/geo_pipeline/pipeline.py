from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import re
import shutil
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Callable, Iterable, Mapping

import yaml
from pyproj import Transformer
from pypdf import PdfReader
from shapely import make_valid
from shapely.geometry import GeometryCollection, Point, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform, unary_union

from scripts.geo_pipeline.models import (
    ArchivedArtifact,
    CatalogRecord,
    CommuneType,
    CommuneCentroid,
    DatasetInput,
    GeometryCentroid,
    OSMRelation,
    ReconciliationReport,
    ReconciliationRow,
    RuntimeDataset,
    RuntimeManifest,
    SourceInput,
)

COMMUNE_ID_RE = re.compile(r"^\d{5}$")
PROVINCE_ID_RE = re.compile(r"^\d{2}$")
ALLOWED_TYPES = {"xa", "phuong", "dac-khu"}
DEFAULT_BYTE_LIMIT = 400 * 1024 * 1024
DEFAULT_RELEASE_COUNT = 3321
EQUAL_AREA_CRS = "EPSG:6933"
WGS84_CRS = "EPSG:4326"


def load_sources(path: Path) -> tuple[SourceInput, ...]:
    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    raw_sources = payload.get("sources", []) if isinstance(payload, dict) else payload
    sources: list[SourceInput] = []
    for item in raw_sources:
        sources.append(
            SourceInput(
                role=item["role"],
                source_url=item["sourceUrl"],
                checksum_url=item["checksumUrl"],
                checksum_md5=item["checksumMd5"],
                archive_name=item["archiveName"],
                effective_at=item["effectiveAt"],
                retrieved_at=item["retrievedAt"],
                sha256=item["sha256"],
                attribution=item["attribution"],
                license_url=item["licenseUrl"],
                share_alike_notice=item["shareAlikeNotice"],
                derived_database_notice=item["derivedDatabaseNotice"],
                byte_limit=int(item["byteLimit"]),
            )
        )
    return tuple(sources)


def resolve_manifest_inputs(
    sources: Iterable[SourceInput],
    archive_root: Path,
) -> tuple[DatasetInput, ...]:
    inputs: list[DatasetInput] = []
    for source in sources:
        if not re.fullmatch(r"[a-f0-9]{64}", source.sha256):
            raise ValueError(f"approved sha256 missing for {source.role}")
        archived_path = (
            archive_root / "sha256" / source.sha256 / source.archive_name
        )
        if not archived_path.is_file():
            raise ValueError(f"archived source missing for {source.role}")
        if _sha256_file(archived_path) != source.sha256:
            raise ValueError(f"archived source sha256 mismatch for {source.role}")
        inputs.append(
            DatasetInput(
                role=source.role,
                source_url=source.source_url,
                archive_path=archived_path.as_posix(),
                effective_at=source.effective_at,
                retrieved_at=source.retrieved_at,
                sha256=source.sha256,
                attribution=source.attribution,
                license_url=source.license_url,
                share_alike_notice=source.share_alike_notice,
                derived_database_notice=source.derived_database_notice,
            )
        )
    return tuple(inputs)


def archive_raw_asset(source_path: Path, archive_root: Path, byte_limit: int = DEFAULT_BYTE_LIMIT) -> ArchivedArtifact:
    size_bytes = source_path.stat().st_size
    if size_bytes > byte_limit:
        raise ValueError(f"raw asset exceeds byte limit: {size_bytes} > {byte_limit}")

    digest = _sha256_file(source_path)
    target_dir = archive_root / "sha256" / digest
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / source_path.name
    if not target_path.exists():
        shutil.copy2(source_path, target_path)
    return ArchivedArtifact(path=target_path, digest=digest, size_bytes=size_bytes)


def validate_checksum_md5(source_path: Path, checksum_text: str) -> None:
    expected = checksum_text.strip().split()[0]
    actual = hashlib.md5(source_path.read_bytes(), usedforsecurity=False).hexdigest()
    if actual != expected:
        raise ValueError(f"md5 mismatch for {source_path.name}")


def load_catalog_text_pages(
    pages: Iterable[str],
    *,
    province_ids: Mapping[str, str] | None = None,
) -> tuple[CatalogRecord, ...]:
    records: list[CatalogRecord] = []
    for page_text in pages:
        for line in page_text.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            if "|" in stripped:
                parts = [part.strip() for part in stripped.split("|")]
                if len(parts) != 4:
                    raise ValueError(f"catalog row must have 4 fields: {stripped}")
                records.append(_parse_catalog_row(parts))
                continue
            parsed = _parse_official_pdf_catalog_line(stripped, province_ids)
            if parsed is not None:
                records.append(parsed)
    return tuple(records)


def load_catalog_records(
    path: Path,
    *,
    text_pages: Callable[[Path], Iterable[str]] | None = None,
    province_ids: Mapping[str, str] | None = None,
) -> tuple[CatalogRecord, ...]:
    if path.suffix.lower() == ".csv":
        return _load_catalog_csv(path)
    if path.suffix.lower() == ".pdf":
        extractor = text_pages or load_catalog_pdf_text_pages
        return load_catalog_text_pages(
            extractor(path),
            province_ids=province_ids,
        )
    raise ValueError(f"unsupported catalog format: {path.suffix}")


def load_catalog_pdf_text_pages(path: Path) -> list[str]:
    reader = PdfReader(str(path))
    pages: list[str] = []
    for page in reader.pages:
        pages.append(page.extract_text() or "")
    return pages


def reconcile_catalog_to_relations(
    catalog: Iterable[CatalogRecord],
    relations: Iterable[OSMRelation],
) -> ReconciliationReport:
    catalog_rows = tuple(catalog)
    relation_rows = tuple(relations)
    by_key: dict[tuple[str, str], list[OSMRelation]] = {}
    by_ascii_key: dict[tuple[str, str], list[OSMRelation]] = {}
    by_global_name: dict[str, list[OSMRelation]] = {}
    by_global_ascii_name: dict[str, list[OSMRelation]] = {}
    by_unscoped_name: dict[str, list[OSMRelation]] = {}
    by_unscoped_ascii_name: dict[str, list[OSMRelation]] = {}
    by_wikidata: dict[str, list[OSMRelation]] = {}
    by_catalog_id: dict[str, list[OSMRelation]] = {}
    for relation in relation_rows:
        if not _is_supported_relation(relation):
            continue
        by_key.setdefault(_relation_key(relation), []).append(relation)
        by_ascii_key.setdefault(
            (_normalize_name_ascii(relation.name), relation.province_id),
            [],
        ).append(relation)
        by_global_name.setdefault(_normalize_name(relation.name), []).append(relation)
        by_global_ascii_name.setdefault(
            _normalize_name_ascii(relation.name),
            [],
        ).append(relation)
        if not relation.province_id:
            by_unscoped_name.setdefault(
                _normalize_name(relation.name),
                [],
            ).append(relation)
            by_unscoped_ascii_name.setdefault(
                _normalize_name_ascii(relation.name),
                [],
            ).append(relation)
        wikidata = relation.tags.get("wikidata")
        if wikidata:
            by_wikidata.setdefault(wikidata.strip(), []).append(relation)
        catalog_id = relation.tags.get("catalog:id")
        if catalog_id:
            by_catalog_id.setdefault(catalog_id.strip(), []).append(relation)

    rows: list[ReconciliationRow] = []
    used_relation_ids: set[int] = set()
    counts = Counter()
    for record in catalog_rows:
        candidates = _candidate_relations(
            record,
            by_key,
            by_ascii_key,
            by_global_name,
            by_global_ascii_name,
            by_unscoped_name,
            by_unscoped_ascii_name,
            by_wikidata,
            by_catalog_id,
            used_relation_ids,
        )
        if not candidates:
            rows.append(ReconciliationRow(record.id, "unmapped_in_osm", reason="no candidate relation"))
            counts["unmapped_in_osm"] += 1
            continue
        if len(candidates) > 1:
            rows.append(
                ReconciliationRow(
                    record.id,
                    "ambiguous_needs_review",
                    relation_ids=tuple(rel.relation_id for rel in candidates),
                    reason="multiple candidate relations",
                )
            )
            counts["ambiguous_needs_review"] += 1
            continue
        match = candidates[0]
        used_relation_ids.add(match.relation_id)
        rows.append(
            ReconciliationRow(
                record.id,
                "matched_osm_relation",
                relation_ids=(match.relation_id,),
            )
        )
        counts["matched_osm_relation"] += 1
    counts_dict = {
        "matched_osm_relation": counts.get("matched_osm_relation", 0),
        "unmapped_in_osm": counts.get("unmapped_in_osm", 0),
        "ambiguous_needs_review": counts.get("ambiguous_needs_review", 0),
    }
    return ReconciliationReport(rows=tuple(rows), counts=counts_dict)


def require_release_ready(*, matched_count: int, expected_count: int = DEFAULT_RELEASE_COUNT) -> None:
    if matched_count != expected_count:
        raise ValueError(f"release blocked: expected {expected_count:,} matches, got {matched_count:,}")


def make_valid_polygonal(geometry: BaseGeometry) -> BaseGeometry:
    repaired = make_valid(geometry)
    if repaired.is_empty:
        return repaired
    if repaired.geom_type in {"Polygon", "MultiPolygon"}:
        return repaired
    if repaired.geom_type == "GeometryCollection":
        polygonal_parts = [item for item in repaired.geoms if item.geom_type in {"Polygon", "MultiPolygon"}]
        if not polygonal_parts:
            return GeometryCollection()
        merged = unary_union(polygonal_parts)
        return merged
    return repaired


def point_is_covered_by_polygon(polygon: BaseGeometry, point: Point) -> bool:
    return polygon.covers(point)


def centroid_from_polygon_wgs84(geometry: BaseGeometry) -> GeometryCentroid:
    if geometry.is_empty:
        raise ValueError("geometry is empty")
    projected = transform(Transformer.from_crs(WGS84_CRS, EQUAL_AREA_CRS, always_xy=True).transform, geometry)
    repaired = make_valid_polygonal(projected)
    centroid = repaired.centroid
    longitude, latitude = Transformer.from_crs(EQUAL_AREA_CRS, WGS84_CRS, always_xy=True).transform(
        centroid.x,
        centroid.y,
    )
    point_projected = Point(centroid.x, centroid.y)
    return GeometryCentroid(
        latitude=latitude,
        longitude=longitude,
        centroid_outside_geometry=not point_is_covered_by_polygon(repaired, point_projected),
    )


def build_runtime_dataset(
    catalog: Iterable[CatalogRecord],
    relations: Iterable[OSMRelation],
    *,
    version: str,
    as_of: str,
    inputs: tuple[DatasetInput, ...],
) -> RuntimeDataset:
    catalog_rows = tuple(catalog)
    relation_rows = tuple(relations)
    reconciliation = reconcile_catalog_to_relations(catalog_rows, relation_rows)
    require_release_ready(
        matched_count=reconciliation.counts.get("matched_osm_relation", 0),
        expected_count=DEFAULT_RELEASE_COUNT,
    )
    relation_by_id = {relation.relation_id: relation for relation in relation_rows}
    catalog_by_id = {record.id: record for record in catalog_rows}
    records: list[CommuneCentroid] = []
    for row in reconciliation.rows:
        if row.status != "matched_osm_relation":
            raise ValueError(f"release blocked: unresolved catalog row {row.catalog_id}")
        catalog_record = catalog_by_id[row.catalog_id]
        relation = relation_by_id[row.relation_ids[0]]
        if relation.geometry is None:
            raise ValueError(f"missing geometry for relation {relation.relation_id}")
        centroid = centroid_from_polygon_wgs84(relation.geometry)
        records.append(
            CommuneCentroid(
                id=catalog_record.id,
                name=catalog_record.name,
                type=catalog_record.type,
                province_id=catalog_record.province_id,
                latitude=centroid.latitude,
                longitude=centroid.longitude,
                centroid_outside_geometry=centroid.centroid_outside_geometry,
            )
        )
    manifest = RuntimeManifest(
        schema_version=1,
        version=version,
        as_of=as_of,
        generated_at=_generated_at(),
        record_count=len(records),
        runtime_dataset_sha256="",
        inputs=inputs,
    )
    dataset = RuntimeDataset(manifest=manifest, records=tuple(records))
    manifest = RuntimeManifest(
        schema_version=1,
        version=manifest.version,
        as_of=manifest.as_of,
        generated_at=manifest.generated_at,
        record_count=manifest.record_count,
        runtime_dataset_sha256=sha256_json(_runtime_dataset_payload(dataset, runtime_dataset_sha256="")),
        inputs=inputs,
    )
    return RuntimeDataset(manifest=manifest, records=tuple(records))


def serialize_runtime_dataset(dataset: RuntimeDataset) -> str:
    payload = _runtime_dataset_payload(dataset, runtime_dataset_sha256=dataset.manifest.runtime_dataset_sha256)
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def validate_runtime_dataset(dataset: RuntimeDataset, *, expected_count: int = DEFAULT_RELEASE_COUNT) -> None:
    require_release_ready(matched_count=len(dataset.records), expected_count=expected_count)
    if dataset.manifest.record_count != len(dataset.records):
        raise ValueError("manifest record count mismatch")
    if not dataset.manifest.runtime_dataset_sha256:
        raise ValueError("runtime dataset sha256 missing")
    roles = {source.role for source in dataset.manifest.inputs}
    if roles != {"commune-catalog", "province-catalog", "geometry"}:
        raise ValueError("manifest must contain all three source roles")
    for source in dataset.manifest.inputs:
        if not re.fullmatch(r"[a-f0-9]{64}", source.sha256):
            raise ValueError(f"invalid source sha256 for {source.role}")
        expected_prefix = f"data/raw/sha256/{source.sha256}/"
        if not source.archive_path.startswith(expected_prefix):
            raise ValueError(f"invalid archive path for {source.role}")
        if not all(
            [
                source.source_url,
                source.effective_at,
                source.retrieved_at,
                source.attribution,
                source.license_url,
                source.share_alike_notice,
                source.derived_database_notice,
            ]
        ):
            raise ValueError(f"incomplete source metadata for {source.role}")
        if source.role == "geometry" and (
            "OpenStreetMap" not in source.attribution
            or "odbl" not in source.license_url.lower()
            or "ODbL" not in source.share_alike_notice
        ):
            raise ValueError("geometry source must include OSM/ODbL metadata")
    expected_sha = sha256_json(_runtime_dataset_payload(dataset, runtime_dataset_sha256=""))
    if dataset.manifest.runtime_dataset_sha256 != expected_sha:
        raise ValueError("runtime dataset sha256 mismatch")
    seen_ids: set[str] = set()
    for record in dataset.records:
        if not COMMUNE_ID_RE.fullmatch(record.id):
            raise ValueError(f"invalid commune id: {record.id}")
        if record.id in seen_ids:
            raise ValueError(f"duplicate commune id: {record.id}")
        seen_ids.add(record.id)
        if not PROVINCE_ID_RE.fullmatch(record.province_id):
            raise ValueError(f"invalid province id: {record.province_id}")
        if not record.name.strip() or record.type not in ALLOWED_TYPES:
            raise ValueError(f"invalid commune metadata: {record.id}")
        if not math.isfinite(record.latitude) or not (-90 <= record.latitude <= 90):
            raise ValueError(f"invalid latitude: {record.latitude}")
        if not math.isfinite(record.longitude) or not (-180 <= record.longitude <= 180):
            raise ValueError(f"invalid longitude: {record.longitude}")


def load_runtime_dataset(path: Path) -> RuntimeDataset:
    payload = json.loads(path.read_text(encoding="utf-8"))
    manifest_payload = payload["manifest"]
    records_payload = payload["records"]
    manifest = RuntimeManifest(
        schema_version=manifest_payload["schemaVersion"],
        version=manifest_payload["version"],
        as_of=manifest_payload["asOf"],
        generated_at=manifest_payload["generatedAt"],
        record_count=manifest_payload["recordCount"],
        runtime_dataset_sha256=manifest_payload["runtimeDatasetSha256"],
        inputs=tuple(
            DatasetInput(
                role=source["role"],
                source_url=source["sourceUrl"],
                archive_path=source["archivePath"],
                effective_at=source["effectiveAt"],
                retrieved_at=source["retrievedAt"],
                sha256=source["sha256"],
                attribution=source["attribution"],
                license_url=source["licenseUrl"],
                share_alike_notice=source["shareAlikeNotice"],
                derived_database_notice=source["derivedDatabaseNotice"],
            )
            for source in manifest_payload["inputs"]
        ),
    )
    records = tuple(
        CommuneCentroid(
            id=record["id"],
            name=record["name"],
            type=record["type"],
            province_id=record["provinceId"],
            latitude=record["latitude"],
            longitude=record["longitude"],
            centroid_outside_geometry=record["centroidOutsideGeometry"],
        )
        for record in records_payload
    )
    return RuntimeDataset(manifest=manifest, records=records)


def load_osm_relations_geojson(path: Path) -> tuple[OSMRelation, ...]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    features = payload.get("features", [])
    relations: list[OSMRelation] = []
    for feature in features:
        properties = feature.get("properties", {})
        relations.append(
            OSMRelation(
                relation_id=int(properties["relation_id"]),
                name=properties["name"],
                type=properties.get("type", "boundary"),
                boundary=properties.get("boundary", "administrative"),
                admin_level=int(properties.get("admin_level", 6)),
                province_id=properties["province_id"],
                tags={key: str(value) for key, value in properties.items() if value is not None},
                geometry=shape(feature["geometry"]),
            )
        )
    return tuple(relations)


def extract_admin_level_6_relations_from_pbf(
    path: Path,
    *,
    province_ids: Mapping[str, str],
    location_storage: str = "flex_mem",
) -> tuple[OSMRelation, ...]:
    try:
        import osmium
    except ImportError as exc:  # pragma: no cover - dependency is part of runtime
        raise RuntimeError("osmium is required for PBF extraction") from exc

    class HierarchyHandler(osmium.SimpleHandler):
        def __init__(self) -> None:
            super().__init__()
            self.parent_by_child: dict[int, str] = {}

        def relation(self, relation: osmium.osm.Relation) -> None:  # type: ignore[name-defined]
            tags = {tag.k: tag.v for tag in relation.tags}
            if (
                tags.get("boundary") != "administrative"
                or tags.get("admin_level") != "4"
            ):
                return
            province_id = province_ids.get(_normalize_name(tags.get("name", "")))
            if province_id is None:
                return
            for member in relation.members:
                if member.type == "r":
                    self.parent_by_child[int(member.ref)] = province_id

    hierarchy = HierarchyHandler()
    hierarchy.apply_file(str(path), locations=False)

    factory = osmium.geom.GeoJSONFactory()
    raw_relations: list[OSMRelation] = []
    province_geometries: list[tuple[str, BaseGeometry]] = []
    processor = (
        osmium.FileProcessor(str(path))
        .with_locations(location_storage)
        .with_areas()
    )
    for obj in processor:
        if not isinstance(obj, osmium.osm.Area) or obj.from_way():
            continue
        tags = {tag.k: tag.v for tag in obj.tags}
        if tags.get("boundary") != "administrative":
            continue
        admin_level = int(tags.get("admin_level", "0"))
        if admin_level not in {4, 6}:
            continue
        geometry = shape(json.loads(factory.create_multipolygon(obj)))
        if admin_level == 4:
            province_id = province_ids.get(_normalize_name(tags.get("name", "")))
            if province_id is not None:
                province_geometries.append((province_id, geometry))
            continue
        relation_id = int(obj.orig_id())
        raw_relations.append(
            OSMRelation(
                relation_id=relation_id,
                name=tags.get("name", ""),
                type=tags.get("type", "") or "boundary",
                boundary=tags.get("boundary", ""),
                admin_level=6,
                province_id=hierarchy.parent_by_child.get(relation_id, ""),
                tags=tags,
                geometry=geometry,
            )
        )

    relations: list[OSMRelation] = []
    for relation in raw_relations:
        province_id = relation.province_id
        if not province_id and relation.geometry is not None:
            point = relation.geometry.representative_point()
            containing = [
                candidate_id
                for candidate_id, province_geometry in province_geometries
                if province_geometry.covers(point)
            ]
            if len(containing) == 1:
                province_id = containing[0]
        relations.append(
            OSMRelation(
                relation_id=relation.relation_id,
                name=relation.name,
                type=relation.type,
                boundary=relation.boundary,
                admin_level=relation.admin_level,
                province_id=province_id,
                tags=relation.tags,
                geometry=relation.geometry,
            )
        )
    return tuple(relations)


def extract_overridden_relations_from_pbf(
    path: Path,
    *,
    overrides: Mapping[int, tuple[str, str, str]],
    location_storage: str = "flex_mem",
) -> tuple[OSMRelation, ...]:
    """Extract explicitly reviewed OSM relation geometries outside admin-level rules."""
    if not overrides:
        return ()
    try:
        import osmium
    except ImportError as exc:  # pragma: no cover - dependency is part of runtime
        raise RuntimeError("osmium is required for PBF extraction") from exc

    factory = osmium.geom.GeoJSONFactory()
    relations: list[OSMRelation] = []
    processor = (
        osmium.FileProcessor(str(path))
        .with_locations(location_storage)
        .with_areas()
    )
    for obj in processor:
        if not isinstance(obj, osmium.osm.Area) or obj.from_way():
            continue
        relation_id = int(obj.orig_id())
        override = overrides.get(relation_id)
        if override is None:
            continue
        catalog_id, official_name, province_id = override
        tags = {tag.k: tag.v for tag in obj.tags}
        geometry = shape(json.loads(factory.create_multipolygon(obj)))
        relations.append(
            OSMRelation(
                relation_id=relation_id,
                name=official_name,
                type="boundary",
                boundary="administrative",
                admin_level=6,
                province_id=province_id,
                tags={
                    **tags,
                    "catalog:id": catalog_id,
                    "source:boundary": tags.get("boundary", ""),
                    "geometry:override": "reviewed",
                },
                geometry=geometry,
            )
        )
    missing = sorted(set(overrides) - {relation.relation_id for relation in relations})
    if missing:
        raise ValueError(f"relation overrides missing geometry: {missing}")
    return tuple(relations)


def dump_runtime_dataset(dataset: RuntimeDataset, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    serialized = serialize_runtime_dataset(dataset)
    path.write_text(serialized, encoding="utf-8")


def load_runtime_dataset_payload(path: Path) -> RuntimeDataset:
    return load_runtime_dataset(path)


def _load_catalog_csv(path: Path) -> tuple[CatalogRecord, ...]:
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        records: list[CatalogRecord] = []
        for row in reader:
            record_id = row["id"].strip()
            province_id = row["provinceId"].strip()
            if not COMMUNE_ID_RE.fullmatch(record_id):
                raise ValueError(f"catalog row has invalid commune id: {record_id}")
            if not PROVINCE_ID_RE.fullmatch(province_id):
                raise ValueError(f"catalog row has invalid province id: {province_id}")
            records.append(
                CatalogRecord(
                    id=record_id,
                    name=row["name"].strip(),
                    type=_parse_commune_type(row["type"]),
                    province_id=province_id,
                    province_name=(row.get("provinceName") or "").strip() or None,
                    wikidata=(row.get("wikidata") or "").strip() or None,
                )
            )
        return tuple(records)


def load_province_map_csv(path: Path) -> dict[str, str]:
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        result: dict[str, str] = {}
        for row in reader:
            province_id = (row.get("provinceId") or "").strip()
            name = (row.get("name") or "").strip()
            if not PROVINCE_ID_RE.fullmatch(province_id) or not name:
                raise ValueError("province map requires provinceId and name")
            aliases = [name, (row.get("osmName") or "").strip()]
            aliases.extend(
                re.sub(r"^(?:Tỉnh|Thành phố)\s+", "", alias)
                for alias in tuple(aliases)
                if alias
            )
            for alias in aliases:
                if not alias:
                    continue
                key = _normalize_name(alias)
                existing = result.get(key)
                if existing is not None and existing != province_id:
                    raise ValueError(f"ambiguous province alias: {alias}")
                result[key] = province_id
        if not result:
            raise ValueError("province map is empty")
        return result


def load_relation_overrides_csv(path: Path) -> dict[int, tuple[str, str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        result: dict[int, tuple[str, str, str]] = {}
        for row in reader:
            catalog_id = (row.get("catalogId") or "").strip()
            relation_id = int((row.get("relationId") or "").strip())
            name = (row.get("name") or "").strip()
            province_id = (row.get("provinceId") or "").strip()
            if (
                not COMMUNE_ID_RE.fullmatch(catalog_id)
                or relation_id <= 0
                or not name
                or not PROVINCE_ID_RE.fullmatch(province_id)
            ):
                raise ValueError(
                    "relation override requires catalogId, relationId, name, and provinceId"
                )
            if relation_id in result:
                raise ValueError(f"duplicate relation override: {relation_id}")
            result[relation_id] = (catalog_id, name, province_id)
        if not result:
            raise ValueError("relation override map is empty")
        return result


def _parse_official_pdf_catalog_line(
    line: str,
    province_ids: Mapping[str, str] | None,
) -> CatalogRecord | None:
    match = re.fullmatch(
        r"\d+\s+(\d{5})\s+((?:Xã|Phường|Đặc khu)\s+.+?)\s+((?:Tỉnh|Thành phố|Tp)\s+.+)",
        line,
    )
    if match is None:
        return None
    if province_ids is None:
        raise ValueError("province map is required for the official PDF catalog")

    record_id, full_name, raw_province_name = match.groups()
    province_name = re.sub(
        r"^Tp\s+",
        "Thành phố ",
        raw_province_name.strip(),
    )
    province_id = province_ids.get(_normalize_name(province_name))
    if province_id is None:
        raise ValueError(f"unknown province in official catalog: {province_name}")
    type_prefix = full_name.split(maxsplit=1)[0]
    commune_type_by_prefix: dict[str, CommuneType] = {
        "Xã": "xa",
        "Phường": "phuong",
        "Đặc": "dac-khu",
    }
    return CatalogRecord(
        id=record_id,
        name=full_name,
        type=commune_type_by_prefix[type_prefix],
        province_id=province_id,
        province_name=province_name,
    )


def _parse_catalog_row(parts: list[str]) -> CatalogRecord:
    record_id, name, commune_type, province_id = parts
    if not COMMUNE_ID_RE.fullmatch(record_id):
        raise ValueError(f"catalog row has invalid commune id: {record_id}")
    if not PROVINCE_ID_RE.fullmatch(province_id):
        raise ValueError(f"catalog row has invalid province id: {province_id}")
    return CatalogRecord(
        id=record_id,
        name=name,
        type=_parse_commune_type(commune_type),
        province_id=province_id,
    )


def _parse_commune_type(value: str) -> CommuneType:
    commune_type = value.strip()
    if commune_type not in ALLOWED_TYPES:
        raise ValueError(f"unsupported commune type: {value}")
    return commune_type  # type: ignore[return-value]


def _relation_key(relation: OSMRelation) -> tuple[str, str]:
    return (_normalize_name(relation.name), relation.province_id)


def _candidate_relations(
    record: CatalogRecord,
    by_key: dict[tuple[str, str], list[OSMRelation]],
    by_ascii_key: dict[tuple[str, str], list[OSMRelation]],
    by_global_name: dict[str, list[OSMRelation]],
    by_global_ascii_name: dict[str, list[OSMRelation]],
    by_unscoped_name: dict[str, list[OSMRelation]],
    by_unscoped_ascii_name: dict[str, list[OSMRelation]],
    by_wikidata: dict[str, list[OSMRelation]],
    by_catalog_id: dict[str, list[OSMRelation]],
    used_relation_ids: set[int],
) -> list[OSMRelation]:
    candidates: list[OSMRelation] = []
    candidates = [
        relation
        for relation in by_catalog_id.get(record.id, [])
        if relation.relation_id not in used_relation_ids
    ]
    if record.wikidata:
        wikidata_candidates = [
            relation
            for relation in by_wikidata.get(record.wikidata.strip(), [])
            if relation.relation_id not in used_relation_ids
        ]
        if wikidata_candidates:
            candidates = wikidata_candidates
    if not candidates:
        candidates = [
            relation
            for relation in by_key.get((_normalize_name(record.name), record.province_id), [])
            if relation.relation_id not in used_relation_ids
        ]
    if not candidates:
        global_exact = [
            relation
            for relation in by_global_name.get(_normalize_name(record.name), [])
            if relation.relation_id not in used_relation_ids
        ]
        if len(global_exact) == 1:
            candidates = global_exact
    if not candidates:
        global_ascii = [
            relation
            for relation in by_global_ascii_name.get(
                _normalize_name_ascii(record.name),
                [],
            )
            if relation.relation_id not in used_relation_ids
        ]
        if len(global_ascii) == 1:
            candidates = global_ascii
    if not candidates:
        candidates = [
            relation
            for relation in by_ascii_key.get(
                (_normalize_name_ascii(record.name), record.province_id),
                [],
            )
            if relation.relation_id not in used_relation_ids
        ]
    if not candidates:
        exact_unscoped = [
            relation
            for relation in by_unscoped_name.get(
                _normalize_name(record.name),
                [],
            )
            if relation.relation_id not in used_relation_ids
        ]
        if exact_unscoped:
            candidates = exact_unscoped
    if not candidates:
        ascii_unscoped = [
            relation
            for relation in by_unscoped_ascii_name.get(
                _normalize_name_ascii(record.name),
                [],
            )
            if relation.relation_id not in used_relation_ids
        ]
        if ascii_unscoped:
            candidates = ascii_unscoped
    return candidates


def _is_supported_relation(relation: OSMRelation) -> bool:
    return relation.boundary == "administrative" and relation.admin_level == 6 and relation.type == "boundary"


def _normalize_name(value: str) -> str:
    normalized = unicodedata.normalize("NFC", value)
    return re.sub(r"[\W_]+", " ", normalized.casefold(), flags=re.UNICODE).strip()


def _normalize_name_ascii(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    stripped = "".join(char for char in normalized if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", " ", stripped.lower()).strip()


def _generated_at() -> str:
    epoch = os.environ.get("SOURCE_DATE_EPOCH")
    if not epoch:
        return "1970-01-01T00:00:00Z"
    from datetime import datetime, timezone

    return datetime.fromtimestamp(int(epoch), tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _runtime_dataset_payload(
    dataset: RuntimeDataset,
    runtime_dataset_sha256: str | None,
) -> dict[str, object]:
    return {
        "manifest": {
            "schemaVersion": dataset.manifest.schema_version,
            "version": dataset.manifest.version,
            "asOf": dataset.manifest.as_of,
            "generatedAt": dataset.manifest.generated_at,
            "recordCount": dataset.manifest.record_count,
            "runtimeDatasetSha256": (
                dataset.manifest.runtime_dataset_sha256
                if runtime_dataset_sha256 is None
                else runtime_dataset_sha256
            ),
            "inputs": [
                {
                    "role": source.role,
                    "sourceUrl": source.source_url,
                    "archivePath": source.archive_path,
                    "effectiveAt": source.effective_at,
                    "retrievedAt": source.retrieved_at,
                    "sha256": source.sha256,
                    "attribution": source.attribution,
                    "licenseUrl": source.license_url,
                    "shareAlikeNotice": source.share_alike_notice,
                    "derivedDatabaseNotice": source.derived_database_notice,
                }
                for source in dataset.manifest.inputs
            ],
        },
        "records": [
            {
                "id": record.id,
                "name": record.name,
                "type": record.type,
                "provinceId": record.province_id,
                "latitude": record.latitude,
                "longitude": record.longitude,
                "centroidOutsideGeometry": record.centroid_outside_geometry,
            }
            for record in sorted(dataset.records, key=lambda item: item.id)
        ],
    }


def sha256_json(payload: dict[str, object]) -> str:
    text = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
