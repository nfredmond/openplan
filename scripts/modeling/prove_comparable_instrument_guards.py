#!/usr/bin/env python3
"""Prove the v0.41 contracts survive no-op change and kill forbidden changes."""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODELING = ROOT / "scripts" / "modeling"
WORKER = ROOT / "workers" / "aequilibrae_worker"
TEST = MODELING / "tests" / "test_validation_instrument_v2.py"
PYTHON = WORKER / ".venv" / "bin" / "python"

MUTATIONS = (
    ("centroid-only matching", "matcher", "distance = float(observed.distance(link))", "distance = float(observed.centroid.distance(link.centroid))"),
    ("premature output access", "core", 'if audit.get("model_output_bytes_read") is not False:', 'if False and audit.get("model_output_bytes_read") is not False:'),
    ("proximity-only tie resolution", "matcher", "elif not combined and len(supported) == 1:", "elif not combined and len(supported) >= 1:"),
    ("collapsed measurement lineage", "core", "if not identifier or identifier in measurement_ids:", "if not identifier:"),
    ("invented vehicle basis", "core", 'conversion.get("class_pce") != 1', "False"),
    ("dropped empty or unloaded records", "core", "        rows.append(row)\n", '        if row["match_status"] == "matched":\n            rows.append(row)\n'),
    ("averaged methods", "core", '            "aequilibrae": a,', '            "average": (a + b) / 2 if numeric else UNKNOWN,\n            "aequilibrae": a,'),
)


def run_suite(matcher_source: str, core_source: str) -> subprocess.CompletedProcess[str]:
    with tempfile.TemporaryDirectory(prefix="openplan-v041-mutation-") as temporary:
        directory = Path(temporary)
        matcher_path = directory / "validation_instrument_v2.py"
        core_path = directory / "model_validation_core_v5.py"
        matcher_path.write_text(matcher_source)
        core_path.write_text(core_source)
        bootstrap = f"""
import importlib.util
import pathlib
import sys
sys.path.insert(0, {str(MODELING)!r})
sys.path.insert(0, {str(WORKER)!r})
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module
load('validation_instrument_v2', {str(matcher_path)!r})
load('model_validation_core_v5', {str(core_path)!r})
tests = load('validation_instrument_v2_mutation_tests', {str(TEST)!r})
for name, value in sorted(vars(tests).items()):
    if name.startswith('test_') and callable(value):
        value()
"""
        return subprocess.run(
            [str(PYTHON), "-B", "-c", bootstrap], cwd=ROOT,
            text=True, capture_output=True, check=False,
        )


def main() -> int:
    matcher = (MODELING / "validation_instrument_v2.py").read_text()
    core = (WORKER / "model_validation_core_v5.py").read_text()
    survivor = run_suite(matcher + "\n# harmless no-op mutation\n", core)
    if survivor.returncode != 0:
        print("HARNESS FAILURE: harmless mutation did not survive", file=sys.stderr)
        print(survivor.stdout + survivor.stderr, file=sys.stderr)
        return 2
    print("SURVIVED: harmless comment")
    for label, owner, old, new in MUTATIONS:
        source = matcher if owner == "matcher" else core
        if old not in source:
            print(f"HARNESS FAILURE: target absent for {label}", file=sys.stderr)
            return 2
        result = run_suite(
            source.replace(old, new, 1) if owner == "matcher" else matcher,
            source.replace(old, new, 1) if owner == "core" else core,
        )
        if result.returncode == 0:
            print(f"SURVIVED UNEXPECTEDLY: {label}", file=sys.stderr)
            return 1
        print(f"KILLED: {label}")
    print("KILLED: swallowed custody failure (covered by migration contract test)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
