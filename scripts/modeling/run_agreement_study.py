#!/usr/bin/env python3
"""Run the pre-registered agreement study, one county at a time.

======================================================= WHAT IT DOES PER COUNTY

Five steps, in this order, because each one depends on the last:

1. **Base run** — the trip-based gravity model, `--keep-project --counts auto`,
   never calibrated. This is also the run that downloads the network; every
   later run for this county adopts it.
2. **ActivitySim** — bundle with the MTC config package, run the model, reduce
   its trip list to a demand package, assign it over the SAME network.
3. **Noise floor** — the ActivitySim demand assigned a second time. Identical
   demand, so whatever differs is the assignment, not the models.
4. **Validation** — both runs already validate against the same clipped count
   set, fetched once by step 1.
5. **Agreement map** — the two assignments compared, with the measured floor.

======================================================== WHAT IT REFUSES TO DO

- **Any calibrated run.** Calibration alters link capacities and free-flow
  times, so the network would no longer be held constant and the comparison
  would be measuring the calibration.
- **A county with too few counts.** Below the pre-registered floor the county is
  dropped AND LOGGED with the number it had; a median error over three stations
  is not an accuracy figure, and a study that quietly keeps them reports one.
- **Silence about failure.** Every county that fails is written into its own
  `status.json` with the step and the error. A batch that ran 12 counties and
  reports 9 must be able to say which 3 and why.

Sequential on purpose: Overpass rate-limits network downloads per IP, and a
parallel batch would spend its time being throttled and then blamed on the
model. Resumable: a county whose `status.json` says it finished is skipped.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import traceback
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping, Sequence

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from agreement_study_registry import DEFAULT_REGISTRY_PATH, load_registry

REPO_ROOT = _SCRIPT_DIR.parents[1]
STATUS_NAME = "status.json"
STUDY_SCHEMA_VERSION = "openplan.agreement_study_run.v1"

# Both sides of every comparison, from the registry's pre-registered rules.
CONVERGENCE_ENV = {
    "OPENPLAN_ASSIGNMENT_RGAP_TARGET": "0.0005",
    "OPENPLAN_ASSIGNMENT_MAX_ITERATIONS": "3000",
}


class AgreementStudyError(RuntimeError):
    """A county could not be run, with the reason to record."""


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text())


def write_json(path: Path, payload: Mapping[str, Any]) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(payload, indent=2) + "\n")


def refuse_calibrated(manifest_path: Path) -> None:
    """A comparison over a calibrated run compares the calibration.

    Checked on the manifest of every run that reaches a comparison, rather than
    trusted from the flags the driver passed: a calibrated run that arrived some
    other way — resumed, hand-made, copied — would otherwise be compared exactly
    as if it were not.
    """
    manifest = read_json(manifest_path)
    calibration = manifest.get("calibration")
    if calibration:
        raise AgreementStudyError(
            f"{manifest_path} records a calibration ({sorted(calibration)[:3]}). Calibration alters "
            "link capacities and free-flow times, so the network is no longer held constant and "
            "any difference in link volumes is not attributable to the demand model."
        )


def station_count(run_dir: Path) -> int | None:
    """How many observed stations this county's clipped count set matched."""
    summary_path = run_dir / "validation" / "validation_summary.json"
    if not summary_path.exists():
        return None
    summary = read_json(summary_path)
    for key in ("stations_matched", "stations", "matched_stations"):
        if isinstance(summary.get(key), int):
            return summary[key]
    return None


def run_step(command: Sequence[str], *, log_path: Path, env: Mapping[str, str] | None = None) -> None:
    """Run one subprocess, with its whole output kept for the failure that happens later."""
    log_path.parent.mkdir(parents=True, exist_ok=True)
    merged = {**os.environ, **CONVERGENCE_ENV, **(env or {})}
    with log_path.open("w") as handle:
        completed = subprocess.run(
            list(command), stdout=handle, stderr=subprocess.STDOUT, cwd=str(REPO_ROOT), env=merged
        )
    if completed.returncode != 0:
        tail = "\n".join(log_path.read_text(errors="replace").splitlines()[-15:])
        raise AgreementStudyError(
            f"{Path(command[1]).name if len(command) > 1 else command[0]} exited "
            f"{completed.returncode}. Last lines:\n{tail}"
        )


def python_executable() -> str:
    return sys.executable


def activitysim_executable() -> str:
    """The ActivitySim CLI, which lives in its own venv — the modeling venv has none."""
    candidate = REPO_ROOT / "workers" / "activitysim_worker" / ".venv-exec" / "bin" / "activitysim"
    if not candidate.exists():
        raise AgreementStudyError(
            f"No ActivitySim executable at {candidate}. The study needs the worker's execution "
            "venv; install it before running the batch."
        )
    return str(candidate)


def stock_configs_dir() -> Path:
    from activitysim_mtc_inputs import resolve_stock_prototype_mtc

    return resolve_stock_prototype_mtc(None)["configs_dir"]


def run_county(
    county: Mapping[str, Any],
    *,
    study_dir: Path,
    runs_root: Path,
    minimum_stations: int,
    force: bool = False,
) -> dict[str, Any]:
    """One county, end to end. Returns its status record whether or not it worked."""
    county_fips = str(county["county_fips"])
    county_dir = study_dir / county_fips
    status_path = county_dir / STATUS_NAME
    if status_path.exists() and not force:
        existing = read_json(status_path)
        if existing.get("status") in ("completed", "dropped"):
            existing["resumed"] = True
            return existing

    started = time.monotonic()
    status: dict[str, Any] = {
        "schema_version": STUDY_SCHEMA_VERSION,
        "county_fips": county_fips,
        "region": county.get("region"),
        "band": county.get("band"),
        "half": county.get("half"),
        "tracts": county.get("tracts"),
        "started_at_utc": _utc_now(),
        "status": "running",
        "steps": {},
    }
    write_json(status_path, status)

    base_name = f"study-{county_fips}-base"
    asim_name = f"study-{county_fips}-asim"
    floor_name = f"study-{county_fips}-floor"
    base_run = runs_root / base_name
    asim_run = runs_root / asim_name
    floor_run = runs_root / floor_name
    bundle_dir = county_dir / "activitysim_bundle"
    asim_out = county_dir / "activitysim_output"
    demand_dir = county_dir / "activitysim_demand_package"
    logs = county_dir / "logs"

    def record(step: str, **fields: Any) -> None:
        status["steps"][step] = {"finished_at_utc": _utc_now(), **fields}
        write_json(status_path, status)

    try:
        # 1 — the trip-based base run. Downloads the network the others reuse.
        run_step(
            [
                python_executable(),
                str(_SCRIPT_DIR / "run_screening_model.py"),
                "--name", base_name,
                "--county-fips", county_fips,
                "--keep-project",
                "--counts", "auto",
                *(["--force"] if force else []),
            ],
            log_path=logs / "1-base.log",
        )
        refuse_calibrated(base_run / "bundle_manifest.json")
        stations = station_count(base_run)
        record("base_run", run_dir=str(base_run), stations=stations)

        # The pre-registered floor, applied BEFORE the expensive steps: a county
        # that cannot be graded should not cost an ActivitySim run.
        if stations is None or stations < minimum_stations:
            status["status"] = "dropped"
            status["dropped_reason"] = (
                f"{stations if stations is not None else 'no'} observed count stations matched this "
                f"county; the pre-registered floor is {minimum_stations}. A median error over a "
                "handful of stations is not an accuracy figure."
            )
            status["finished_at_utc"] = _utc_now()
            status["seconds"] = round(time.monotonic() - started, 1)
            write_json(status_path, status)
            return status

        # 2 — ActivitySim: bundle, run, reduce, assign.
        run_step(
            [
                python_executable(),
                str(_SCRIPT_DIR / "build_activitysim_input_bundle.py"),
                "--screening-run-dir", str(base_run),
                "--output-dir", str(bundle_dir),
                "--population", "census",
                "--config-package", "mtc",
                "--force",
            ],
            log_path=logs / "2a-bundle.log",
        )
        record("bundle", bundle_dir=str(bundle_dir))

        if asim_out.exists():
            shutil.rmtree(asim_out)
        (asim_out / "workdir").mkdir(parents=True, exist_ok=True)
        run_step(
            [
                activitysim_executable(),
                "run",
                "-c", str(bundle_dir / "configs"),
                "-c", str(stock_configs_dir()),
                "-d", str(bundle_dir),
                "-o", str(asim_out / "output"),
                "-w", str(asim_out / "workdir"),
            ],
            log_path=logs / "2b-activitysim.log",
        )
        trips_csv = asim_out / "output" / "final_trips.csv"
        if not trips_csv.exists():
            raise AgreementStudyError(
                f"ActivitySim finished without writing {trips_csv}; there is no trip list to assign."
            )
        record("activitysim", trips_csv=str(trips_csv))

        run_step(
            [
                python_executable(),
                str(_SCRIPT_DIR / "activitysim_demand_package.py"),
                "--trips-csv", str(trips_csv),
                "--zone-attributes-csv", str(base_run / "package" / "zone_attributes.csv"),
                "--output-dir", str(demand_dir),
            ],
            log_path=logs / "2c-demand-package.log",
        )
        conversion = read_json(demand_dir / "manifest.json")["conversion"]
        record("demand_package", vehicle_trips=conversion["vehicle_trips"],
               unrecognised_modes=conversion["unrecognised_modes"])

        for name, run_dir, log in (
            (asim_name, asim_run, "3a-asim-assign.log"),
            (floor_name, floor_run, "3b-floor-assign.log"),
        ):
            run_step(
                [
                    python_executable(),
                    str(_SCRIPT_DIR / "run_screening_model.py"),
                    "--name", name,
                    "--county-fips", county_fips,
                    "--keep-project",
                    *(["--counts", "auto"] if run_dir is asim_run else []),
                    "--demand-package-dir", str(demand_dir),
                    "--reuse-network-from-run", str(base_run),
                    *(["--force"] if force else []),
                ],
                log_path=logs / log,
            )
            refuse_calibrated(run_dir / "bundle_manifest.json")
        record("assignments", asim_run=str(asim_run), floor_run=str(floor_run),
               asim_stations=station_count(asim_run))

        # 4 — the floor, then the map that uses it.
        comparator = str(_SCRIPT_DIR / "compare_behavioral_demand_outputs.py")
        floor_dir = county_dir / "noise_floor"
        run_step(
            [
                python_executable(), comparator,
                "--link-volumes-first", str(asim_run / "run_output" / "link_volumes.csv"),
                "--link-volumes-second", str(floor_run / "run_output" / "link_volumes.csv"),
                "--first-label", "ActivitySim demand, assignment run 1",
                "--second-label", "ActivitySim demand, assignment run 2",
                "--first-manifest", str(asim_run / "bundle_manifest.json"),
                "--second-manifest", str(floor_run / "bundle_manifest.json"),
                "--output-dir", str(floor_dir),
                "--force",
            ],
            log_path=logs / "4-noise-floor.log",
        )
        floor_json = floor_dir / "corridor_agreement.json"
        agreement_dir = county_dir / "agreement"
        run_step(
            [
                python_executable(), comparator,
                "--link-volumes-first", str(base_run / "run_output" / "link_volumes.csv"),
                "--link-volumes-second", str(asim_run / "run_output" / "link_volumes.csv"),
                "--first-label", "AequilibraE gravity (trip-based)",
                "--second-label", "ActivitySim prototype_mtc (activity-based)",
                "--first-manifest", str(base_run / "bundle_manifest.json"),
                "--second-manifest", str(asim_run / "bundle_manifest.json"),
                "--loaded-links-geojson", str(base_run / "run_output" / "retained_network.geojson"),
                "--noise-floor-json", str(floor_json),
                "--output-dir", str(agreement_dir),
                "--force",
            ],
            log_path=logs / "5-agreement.log",
        )
        agreement = read_json(agreement_dir / "corridor_agreement.json")
        record(
            "agreement",
            agreement_json=str(agreement_dir / "corridor_agreement.json"),
            noise_floor_json=str(floor_json),
            agree_share_meaningful_links=agreement["summary"]["agree_share_meaningful_links"],
            attribution_is_supportable=agreement["attribution_is_supportable"],
        )

        status["status"] = "completed"
        status["artifacts"] = {
            "base_run": str(base_run),
            "asim_run": str(asim_run),
            "floor_run": str(floor_run),
            "agreement_json": str(agreement_dir / "corridor_agreement.json"),
            "noise_floor_json": str(floor_json),
            "base_validation": str(base_run / "validation" / "validation_results.csv"),
            "asim_validation": str(asim_run / "validation" / "validation_results.csv"),
        }
    except Exception as exc:  # noqa: BLE001 — every failure is recorded, never swallowed
        status["status"] = "failed"
        status["error"] = {
            "kind": exc.__class__.__name__,
            "message": str(exc),
            "traceback": traceback.format_exc(limit=6),
        }
    status["finished_at_utc"] = _utc_now()
    status["seconds"] = round(time.monotonic() - started, 1)
    write_json(status_path, status)
    return status


def run_study(
    *,
    half: str,
    registry_path: Path,
    study_root: Path,
    runs_root: Path,
    force: bool = False,
    limit: int | None = None,
) -> dict[str, Any]:
    registry = load_registry(registry_path)
    if half not in registry["counties"]:
        raise AgreementStudyError(f"The registry has no '{half}' half; it has {sorted(registry['counties'])}.")
    counties = registry["counties"][half]
    if limit is not None:
        counties = counties[:limit]
    minimum_stations = registry["pre_registered_rules"]["minimum_stations_per_county"]

    study_dir = study_root / half
    study_dir.mkdir(parents=True, exist_ok=True)
    results = []
    for index, county in enumerate(counties, start=1):
        print(f"[{index}/{len(counties)}] {county['county_fips']} ({county['region']}, {county['band']})", flush=True)
        status = run_county(
            county,
            study_dir=study_dir,
            runs_root=runs_root,
            minimum_stations=minimum_stations,
            force=force,
        )
        print(f"    -> {status['status']} in {status.get('seconds', 0):.0f}s", flush=True)
        results.append(status)

    summary = {
        "schema_version": STUDY_SCHEMA_VERSION,
        "half": half,
        "registry": str(registry_path),
        "generated_at_utc": _utc_now(),
        "counties_attempted": len(results),
        "completed": [r["county_fips"] for r in results if r["status"] == "completed"],
        # Named, never a count: "9 of 12 counties ran" without the other three
        # reads as a study that covered everything it meant to.
        "dropped": [
            {"county_fips": r["county_fips"], "reason": r.get("dropped_reason")}
            for r in results
            if r["status"] == "dropped"
        ],
        "failed": [
            {"county_fips": r["county_fips"], "error": (r.get("error") or {}).get("message")}
            for r in results
            if r["status"] == "failed"
        ],
    }
    write_json(study_dir / "batch_summary.json", summary)
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the pre-registered agreement study batch.")
    parser.add_argument("--half", choices=["dev", "holdout"], required=True)
    parser.add_argument("--registry", default=str(REPO_ROOT / DEFAULT_REGISTRY_PATH))
    parser.add_argument("--study-root", default=str(REPO_ROOT / "data" / "agreement-study" / "runs"))
    parser.add_argument("--runs-root", default=str(REPO_ROOT / "data" / "screening-runs"))
    parser.add_argument("--force", action="store_true", help="Re-run counties already recorded as finished")
    parser.add_argument("--limit", type=int, help="Only the first N counties of the half (smoke runs)")
    args = parser.parse_args()

    summary = run_study(
        half=args.half,
        registry_path=Path(args.registry).expanduser().resolve(),
        study_root=Path(args.study_root).expanduser().resolve(),
        runs_root=Path(args.runs_root).expanduser().resolve(),
        force=args.force,
        limit=args.limit,
    )
    print(json.dumps(summary, indent=2))
    return 0 if not summary["failed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
