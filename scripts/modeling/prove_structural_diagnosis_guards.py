#!/usr/bin/env python3
"""Prove the structural-diagnosis regression suite kills forbidden mutations."""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODELING = ROOT / "scripts" / "modeling"
SOURCE = MODELING / "model_validation_structural_diagnosis.py"
TEST = MODELING / "tests" / "test_model_validation_structural_diagnosis.py"

MUTATIONS = (
    (
        "open output during assignment-blind stage",
        '"model_output_bytes_read": False,',
        '"model_output_bytes_read": True,',
    ),
    (
        "change a frozen match",
        '"match_changes": 0,',
        '"match_changes": 1,',
    ),
    (
        "use only centroid geometry",
        'full_link_distance_meters(lon, lat, links[index]["geometry"]), index',
        '_centroid_distance_meters(lon, lat, links[index]), index',
    ),
    (
        "drop the zero-volume unloaded state",
        'else "unloaded_zero"\n            if raw_value == 0',
        'else "loaded_nonzero"\n            if raw_value == 0',
    ),
    (
        "drop the absent-output state",
        'if not output_row_present\n            else "unloaded_zero"',
        'if False and not output_row_present\n            else "unloaded_zero"',
    ),
    (
        "invent a model year",
        'proven_when=model_year not in {None, "", UNKNOWN},',
        'proven_when=True,',
    ),
    (
        "accept changed frozen link IDs",
        'or aeq["frozen_link_ids"] != asim["frozen_link_ids"]',
        'or False',
    ),
    (
        "average methods",
        '"aggregation": "none",',
        '"aggregation": "average",',
    ),
)


def run_suite(mutated_source: str) -> subprocess.CompletedProcess[str]:
    with tempfile.TemporaryDirectory(prefix="openplan-diagnosis-mutation-") as temporary:
        mutation_path = Path(temporary) / SOURCE.name
        mutation_path.write_text(mutated_source)
        bootstrap = f"""
import importlib.util
import pathlib
import sys
import unittest
sys.path.insert(0, {str(MODELING)!r})
sys.path.insert(0, {str(TEST.parent)!r})
spec = importlib.util.spec_from_file_location('model_validation_structural_diagnosis', {str(mutation_path)!r})
module = importlib.util.module_from_spec(spec)
sys.modules['model_validation_structural_diagnosis'] = module
spec.loader.exec_module(module)
test_spec = importlib.util.spec_from_file_location('structural_diagnosis_mutation_tests', {str(TEST)!r})
tests = importlib.util.module_from_spec(test_spec)
test_spec.loader.exec_module(tests)
result = unittest.TextTestRunner(verbosity=0).run(unittest.defaultTestLoader.loadTestsFromModule(tests))
raise SystemExit(0 if result.wasSuccessful() else 1)
"""
        return subprocess.run(
            [sys.executable, "-B", "-c", bootstrap],
            cwd=ROOT,
            text=True,
            capture_output=True,
            env={"PYTHONDONTWRITEBYTECODE": "1"},
            check=False,
        )


def main() -> int:
    source = SOURCE.read_text()
    survivor = run_suite(source + "\n# Harmless mutation survivor.\n")
    if survivor.returncode != 0:
        print("HARNESS FAILURE: harmless mutation did not survive", file=sys.stderr)
        print(survivor.stdout + survivor.stderr, file=sys.stderr)
        return 2
    print("SURVIVED: harmless comment")

    for label, old, new in MUTATIONS:
        if old not in source:
            print(f"HARNESS FAILURE: {label!r} target was absent", file=sys.stderr)
            return 2
        result = run_suite(source.replace(old, new, 1))
        if result.returncode == 0:
            print(f"SURVIVED UNEXPECTEDLY: {label}", file=sys.stderr)
            return 1
        print(f"KILLED: {label}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
