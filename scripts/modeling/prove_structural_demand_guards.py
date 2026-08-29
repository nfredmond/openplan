#!/usr/bin/env python3
"""Prove the v0.43 structural guards with one survivor and killed mutations."""
from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "workers" / "aequilibrae_worker"
MODELING = ROOT / "scripts" / "modeling"
PYTHON = WORKER / ".venv" / "bin" / "python"
SCIENTIFIC_TEST = MODELING / "tests" / "test_model_structural_input_audit.py"
CUSTODY_TEST = WORKER / "test_structural_demand_custody.py"


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one mutation seam, found {count}")
    return source.replace(old, new)


def run_function(temp: Path, test_path: Path, function: str) -> subprocess.CompletedProcess[str]:
    test_source = test_path.read_text()
    if test_path == SCIENTIFIC_TEST:
        test_source = replace_once(
            test_source,
            'ROOT = Path(__file__).resolve().parents[3]',
            f'ROOT = Path({str(ROOT)!r})',
            "test root",
        )
    staged_test = temp / test_path.name
    staged_test.write_text(test_source)
    env = os.environ.copy()
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["PYTHONPATH"] = os.pathsep.join((str(temp), str(WORKER), str(MODELING)))
    return subprocess.run(
        [str(PYTHON), "-B", "-c", f"import runpy; ns=runpy.run_path({str(staged_test)!r}); ns[{function!r}]()"],
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
    )


def stage_base(temp: Path) -> None:
    for path in (
        WORKER / "model_structural_input_audit.py",
        WORKER / "model_validation_structural_diagnosis_v3.py",
        WORKER / "main.py",
        MODELING / "run_structural_demand_diagnosis.py",
    ):
        source = path.read_text()
        if path.name == "run_structural_demand_diagnosis.py":
            source = replace_once(
                source,
                'ROOT = Path(__file__).resolve().parents[2]',
                f'ROOT = Path({str(ROOT)!r})',
                "runner root",
            )
        (temp / path.name).write_text(source)


def mutate(temp: Path, filename: str, old: str, new: str, label: str) -> None:
    path = temp / filename
    path.write_text(replace_once(path.read_text(), old, new, label))


def main() -> int:
    checks = [
        ("premature output access", "run_structural_demand_diagnosis.py", "if completed != expected:", "if False:", SCIENTIFIC_TEST, "test_output_derived_fields_are_refused_before_assignment_output"),
        ("hidden gravity fallback", "run_structural_demand_diagnosis.py", 'lodes.get(key) != "unknown"', "False", SCIENTIFIC_TEST, "test_unsupported_country_and_mixed_vintage_cannot_sneak_into_registry"),
        ("invented through shares", "model_structural_input_audit.py", 'if external.get("through_share_evidence") != UNKNOWN:', "if False:", SCIENTIFIC_TEST, "test_audit_validation_rejects_invented_through_share_dropped_crossings_and_swallowed_unreachable"),
        ("dropped crossings", "model_structural_input_audit.py", "if retained & dropped or retained | dropped != detected:", "if False:", SCIENTIFIC_TEST, "test_audit_validation_rejects_invented_through_share_dropped_crossings_and_swallowed_unreachable"),
        ("swallowed unreachable demand", "model_structural_input_audit.py", 'if unreachable < 0 or abs(unreachable - float(loading.get("demand_removed_as_unreachable", -2))) > 1e-6:', "if False:", SCIENTIFIC_TEST, "test_audit_validation_rejects_invented_through_share_dropped_crossings_and_swallowed_unreachable"),
        ("centroid-only loading", "model_structural_input_audit.py", "if loadable < 0 or structural < 0 or loadable + structural != roadway_total:", "if False:", SCIENTIFIC_TEST, "test_audit_validation_rejects_invented_through_share_dropped_crossings_and_swallowed_unreachable"),
        ("discarded unloaded records", "model_validation_structural_diagnosis_v3.py", 'return ("unloaded" if value == 0 else "loaded"), value', 'return "loaded", value', SCIENTIFIC_TEST, "test_v3_retains_loaded_unloaded_unreachable_excluded_ambiguous_unsupported_and_missing"),
        ("discarded unloaded links", "model_validation_structural_diagnosis_v3.py", 'if int(loading.get("loaded_links", -1)) + int(loading.get("unloaded_links", -1)) != int(loading.get("output_link_records", -2)):', "if False:", SCIENTIFIC_TEST, "test_v3_validation_rejects_discarded_unloaded_records_and_links"),
        ("averaged methods", "model_validation_structural_diagnosis_v3.py", '"ratio_activitysim_to_aequilibrae": b / a if numeric and a != 0 else UNKNOWN,', '"ratio_activitysim_to_aequilibrae": b / a if numeric and a != 0 else UNKNOWN, "average": (a + b) / 2 if numeric else UNKNOWN,', SCIENTIFIC_TEST, "test_method_comparison_keeps_values_differences_and_ratios_without_average"),
        ("swallowed custody failure", "main.py", 'result["custody_write"] = "structural demand evidence write failed"\n        result["custody_write_error"] = str(exc)', 'result["custody_write"] = "structural demand evidence write failed"\n        result["scientific_check"] = "checked"\n        result["custody_write_error"] = str(exc)', CUSTODY_TEST, "test_failed_transaction_is_visibly_scientifically_unchecked"),
    ]

    with tempfile.TemporaryDirectory(prefix="openplan-v043-mutations-") as raw:
        temp = Path(raw)
        stage_base(temp)
        mutate(temp, "model_structural_input_audit.py", '"""Assignment-blind structural audit', '"""Assignment-blind structural audit', "no-op")
        survivor = run_function(temp, SCIENTIFIC_TEST, "test_output_derived_fields_are_refused_before_assignment_output")
        if survivor.returncode != 0:
            print("NO-OP DID NOT SURVIVE")
            print(survivor.stderr)
            return 1
        print("SURVIVED no-op mutation")

    for label, filename, old, new, test_path, function in checks:
        with tempfile.TemporaryDirectory(prefix="openplan-v043-mutations-") as raw:
            temp = Path(raw)
            stage_base(temp)
            mutate(temp, filename, old, new, label)
            result = run_function(temp, test_path, function)
            if result.returncode == 0:
                print(f"SURVIVED forbidden mutation: {label}")
                return 1
            print(f"KILLED {label}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
