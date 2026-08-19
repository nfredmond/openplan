#!/usr/bin/env python3
"""Prepare every locked fresh-holdout geography through the borrowed-MTC baseline."""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from run_agreement_study import activitysim_executable, run_step, stock_configs_dir
from run_auto_ownership_transfer_study import EVALUATION_SETTINGS


SCHEMA_VERSION = "openplan.activitysim-auto-ownership-fresh-holdout-preparation.v1"


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def prepare(
    registry_path: str | Path,
    study_runs_dir: str | Path,
    screening_runs_root: str | Path,
    *,
    force: bool = False,
) -> list[dict[str, Any]]:
    registry = json.loads(Path(registry_path).read_text())
    if registry.get("status") != "pre_registered_before_candidate_execution":
        raise RuntimeError("Holdout registry is not pre-registered")
    studies = Path(study_runs_dir).resolve()
    screening = Path(screening_runs_root).resolve()
    eval_config = screening / "_borrowed_evaluation_config"
    eval_config.mkdir(parents=True, exist_ok=True)
    (eval_config / "settings.yaml").write_text(EVALUATION_SETTINGS)
    results = []

    for geography in registry["geographies"]:
        geography_id = geography["geography_id"]
        place = studies / geography_id
        logs = place / "logs"
        status_path = place / "status.json"
        status = json.loads(status_path.read_text()) if status_path.exists() else {
            "schema_version": SCHEMA_VERSION,
            "geography_id": geography_id,
            "label": geography["label"],
            "status": "running",
            "started_at_utc": _now(),
            "steps": {},
        }
        if status.get("status") == "completed" and not force:
            results.append(status)
            continue
        started = time.monotonic()
        status["status"] = "running"
        _write(status_path, status)
        base_name = f"auto-ownership-fresh-{geography_id}"
        base_run = screening / base_name
        bundle = place / "activitysim_bundle"
        borrowed_output = place / "activitysim_output" / "output"

        try:
            if force or not (base_run / "bundle_manifest.json").is_file():
                run_step([
                    sys.executable,
                    str(SCRIPT_DIR / "run_screening_model.py"),
                    "--name", base_name,
                    "--county-fips", geography_id,
                    "--output-root", str(screening),
                    "--keep-project",
                    *( ["--force"] if force else [] ),
                ], log_path=logs / "1-screening.log")
            status["steps"]["screening"] = {
                "completed_at_utc": _now(), "run_dir": str(base_run)
            }
            _write(status_path, status)

            if force or not (bundle / "households.csv").is_file():
                run_step([
                    sys.executable,
                    str(SCRIPT_DIR / "build_activitysim_input_bundle.py"),
                    "--screening-run-dir", str(base_run),
                    "--output-dir", str(bundle),
                    "--population", "census",
                    "--config-package", "mtc",
                    "--force",
                ], log_path=logs / "2-census-bundle.log")
            status["steps"]["census_bundle"] = {
                "completed_at_utc": _now(), "bundle_dir": str(bundle)
            }
            _write(status_path, status)

            final_households = borrowed_output / "final_households.csv"
            if force or not final_households.is_file():
                run_step([
                    activitysim_executable(), "run",
                    "-c", str(eval_config),
                    "-c", str(bundle / "configs"),
                    "-c", str(stock_configs_dir()),
                    "-d", str(bundle),
                    "-o", str(borrowed_output),
                ], log_path=logs / "3-borrowed-mtc.log")
            if not final_households.is_file():
                raise RuntimeError(f"Borrowed-MTC run did not write {final_households}")
            status["steps"]["borrowed_mtc"] = {
                "completed_at_utc": _now(), "final_households": str(final_households)
            }
            status["status"] = "completed"
        except Exception as exc:  # noqa: BLE001 - persist the exact failed place and stage
            status["status"] = "failed"
            status["error"] = {"kind": type(exc).__name__, "message": str(exc)}
        status["finished_at_utc"] = _now()
        status["seconds_this_attempt"] = round(time.monotonic() - started, 1)
        _write(status_path, status)
        results.append(status)
        if status["status"] == "failed":
            break
    return results


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("registry")
    parser.add_argument("study_runs_dir")
    parser.add_argument("screening_runs_root")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args(argv)
    results = prepare(
        args.registry, args.study_runs_dir, args.screening_runs_root, force=args.force
    )
    print(json.dumps(results, indent=2))
    return 0 if len(results) > 0 and all(row["status"] == "completed" for row in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
