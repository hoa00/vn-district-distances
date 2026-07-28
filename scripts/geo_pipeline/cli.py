from __future__ import annotations

import argparse
import json
from pathlib import Path

from scripts.geo_pipeline.pipeline import (
    archive_raw_asset,
    build_runtime_dataset,
    dump_runtime_dataset,
    extract_admin_level_6_relations_from_pbf,
    extract_overridden_relations_from_pbf,
    load_catalog_records,
    load_osm_relations_geojson,
    load_province_map_csv,
    load_relation_overrides_csv,
    load_runtime_dataset_payload,
    load_sources,
    resolve_manifest_inputs,
    validate_checksum_md5,
    validate_runtime_dataset,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="geo_pipeline")
    subparsers = parser.add_subparsers(dest="command", required=True)

    acquire = subparsers.add_parser("acquire")
    acquire.add_argument("--source", required=True)
    acquire.add_argument("--archive-root", required=True)
    acquire.add_argument("--byte-limit", type=int, default=400 * 1024 * 1024)
    acquire.add_argument("--expected-md5")
    acquire.add_argument("--expected-sha256")

    build = subparsers.add_parser("build")
    build.add_argument("--sources", required=True)
    build.add_argument("--archive-root", required=True)
    build.add_argument("--catalog", required=True)
    build.add_argument("--province-map", required=True)
    build.add_argument("--relations", required=True, action="append")
    build.add_argument("--override-relations")
    build.add_argument("--relation-overrides")
    build.add_argument("--output", required=True)
    build.add_argument("--version", required=True)
    build.add_argument("--as-of", required=True)

    validate = subparsers.add_parser("validate")
    validate.add_argument("--dataset", required=True)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "acquire":
        source_path = Path(args.source)
        if args.expected_md5:
            validate_checksum_md5(source_path, args.expected_md5)
        archived = archive_raw_asset(
            source_path,
            Path(args.archive_root),
            byte_limit=args.byte_limit,
        )
        if args.expected_sha256 and archived.digest != args.expected_sha256:
            raise ValueError("sha256 mismatch")
        print(
            json.dumps(
                {
                    "archivePath": archived.path.as_posix(),
                    "sha256": archived.digest,
                    "sizeBytes": archived.size_bytes,
                }
            )
        )
        return 0

    if args.command == "build":
        sources = load_sources(Path(args.sources))
        inputs = resolve_manifest_inputs(sources, Path(args.archive_root))
        province_map = load_province_map_csv(Path(args.province_map))
        catalog = load_catalog_records(
            Path(args.catalog),
            province_ids=province_map,
        )
        relations = []
        for relation_arg in args.relations:
            relations_path = Path(relation_arg)
            if relations_path.suffix.lower() == ".pbf":
                relations.extend(
                    extract_admin_level_6_relations_from_pbf(
                        relations_path,
                        province_ids=province_map,
                    )
                )
            else:
                relations.extend(load_osm_relations_geojson(relations_path))
        if bool(args.override_relations) != bool(args.relation_overrides):
            raise ValueError(
                "--override-relations and --relation-overrides must be supplied together"
            )
        if args.override_relations:
            overrides = load_relation_overrides_csv(Path(args.relation_overrides))
            relations.extend(
                extract_overridden_relations_from_pbf(
                    Path(args.override_relations),
                    overrides=overrides,
                )
            )
        dataset = build_runtime_dataset(
            catalog,
            relations,
            version=args.version,
            as_of=args.as_of,
            inputs=inputs,
        )
        dump_runtime_dataset(dataset, Path(args.output))
        return 0

    if args.command == "validate":
        dataset = load_runtime_dataset_payload(Path(args.dataset))
        validate_runtime_dataset(dataset)
        print(json.dumps({"ok": True, "recordCount": dataset.manifest.record_count}))
        return 0

    raise AssertionError(f"unknown command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
