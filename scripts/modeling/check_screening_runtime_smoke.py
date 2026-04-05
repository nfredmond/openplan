#!/usr/bin/env python3
from __future__ import annotations

import json
import tempfile
from pathlib import Path

from screening_boundary import require_boundary_selector


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def smoke_boundary(boundary_name: str) -> None:
    from screening_boundary import resolve_boundary
    from screening_bundle import build_run_summary, ensure_dir, write_boundary_artifact, write_bundle_outputs, write_json

    root = repo_root()
    boundary_path = root / "data" / "screening-boundaries" / boundary_name
    with tempfile.TemporaryDirectory(prefix="screening-smoke-") as tmp:
        tmp_path = Path(tmp)
        run_dir = ensure_dir(tmp_path / "run")
        ensure_dir(run_dir / "boundary")
        ensure_dir(run_dir / "run_output")
        boundary_meta = resolve_boundary(str(boundary_path), None, tmp_path / "cache")
        artifact_path = write_boundary_artifact(boundary_meta["geometry"], run_dir / "boundary")
        boundary_meta["artifact_path"] = str(artifact_path)

        zone_meta = {"zones": 1, "zone_type": "smoke-fixture"}
        network_meta = {"network_bbox": [0.0, 0.0, 1.0, 1.0], "largest_component_pct": 100.0, "zones_connected": 1}
        skim_meta = {"reachable_pairs": 0, "total_pairs": 0, "avg_time_min": None, "max_time_min": None}
        demand_meta = {"summary": {"total_trips": 0.0}}
        assignment_meta = {"loaded_links": 0}
        manifest = write_bundle_outputs(
            run_dir=run_dir,
            run_name=f"smoke-{boundary_path.stem}",
            boundary_meta=boundary_meta,
            zone_meta=zone_meta,
            network_meta=network_meta,
            skim_meta=skim_meta,
            demand_meta=demand_meta,
            assignment_meta=assignment_meta,
            keep_project=False,
        )
        summary = build_run_summary(
            run_name=f"smoke-{boundary_path.stem}",
            run_dir=run_dir,
            boundary_meta=boundary_meta,
            zone_meta=zone_meta,
            demand_meta=demand_meta,
            assignment_meta=assignment_meta,
            manifest=manifest,
        )
        write_json(run_dir / "run_summary.json", summary)
        assert artifact_path.exists()
        assert (run_dir / "bundle_manifest.json").exists()
        assert (run_dir / "run_output" / "evidence_packet.json").exists()
        assert summary["manifest"]["boundary"]["label"] == boundary_path.stem


def smoke_cli_validation() -> None:
    require_boundary_selector("fixture.geojson", None)
    require_boundary_selector(None, "06057")
    try:
        require_boundary_selector(None, None)
    except RuntimeError:
        return
    raise AssertionError("Missing boundary selector should raise RuntimeError")


def smoke_boundary_fixture_json(boundary_name: str) -> None:
    boundary_path = repo_root() / "data" / "screening-boundaries" / boundary_name
    payload = json.loads(boundary_path.read_text())
    geom_type = payload.get("type")
    if geom_type == "Feature":
        geom_type = payload.get("geometry", {}).get("type")
    elif geom_type == "FeatureCollection":
        features = payload.get("features", [])
        geom_type = features[0].get("geometry", {}).get("type") if features else None
    assert geom_type in {"Polygon", "MultiPolygon"}


def main() -> int:
    smoke_cli_validation()
    try:
        smoke_boundary("grass-valley-core.geojson")
        smoke_boundary("auburn-core.geojson")
        print("screening runtime smoke checks passed")
    except ModuleNotFoundError as exc:
        smoke_boundary_fixture_json("grass-valley-core.geojson")
        smoke_boundary_fixture_json("auburn-core.geojson")
        print(f"screening runtime static smoke checks passed (geometry deps unavailable: {exc.name})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
