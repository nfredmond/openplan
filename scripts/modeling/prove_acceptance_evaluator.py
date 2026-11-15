#!/usr/bin/env python3
"""Mutate disposable evaluator copies; never open scientific inputs or edit source."""
from __future__ import annotations

import ast
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "workers/aequilibrae_worker/model_validation_acceptance.py"
TEST = ROOT / "workers/aequilibrae_worker/test_model_validation_acceptance.py"
RUNNER = '''import io, json, unittest
suite = unittest.defaultTestLoader.loadTestsFromName("test_model_validation_acceptance")
result = unittest.TextTestRunner(stream=io.StringIO()).run(suite)
print(json.dumps({"tests": result.testsRun, "failures": [str(t) for t, _ in result.failures],
                  "errors": [str(t) for t, _ in result.errors], "skipped": len(result.skipped)}))
'''


def run_copy(source: str, selected: str | None = None) -> dict:
    with tempfile.TemporaryDirectory(prefix="openplan-acceptance-synthetic-") as directory:
        root = Path(directory)
        (root / SOURCE.name).write_text(source)
        (root / TEST.name).write_bytes(TEST.read_bytes())
        runner = RUNNER.replace('"test_model_validation_acceptance"', repr("test_model_validation_acceptance.AcceptanceTests." + selected)) if selected else RUNNER
        child = subprocess.run([sys.executable, "-B", "-c", runner], cwd=root,
                               env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
                               capture_output=True, text=True, timeout=30)
        if child.returncode:
            raise RuntimeError(f"test runner failed, not a mutation kill: {child.stderr}")
        result = json.loads(child.stdout)
        if result["errors"] or result["skipped"] or not result["tests"]:
            raise RuntimeError(f"invalid mutation result: {result}")
        return result


def mutations(source: str):
    lines = source.splitlines(keepends=True)
    offsets = [0]
    for line in lines:
        offsets.append(offsets[-1] + len(line))
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "_require":
            condition = node.args[0]
            start = offsets[condition.lineno - 1] + condition.col_offset
            end = offsets[condition.end_lineno - 1] + condition.end_col_offset
            label = ast.unparse(node.args[1])
            yield f"refusal:{node.lineno}:{label}", source[:start] + "True" + source[end:]
    changes = {
        "missing-observation": ('spec, row = specs[identifier], rows.get(identifier)', 'spec, row = specs[identifier], rows.get(identifier)\n                    if row is None:\n                        row = {"observed": values.get(identifier), "lower": values.get(identifier), "upper": values.get(identifier), "source_sha256": spec["source_sha256"], "interval_evidence_sha256": "0" * 64, "interval_method": protocol["shared_context"]["interval_method"], "grade": "A", "qa_passed": True, "match_status": "matched", "basis": spec["basis"]}'),
        "invalid-model-output": ('modeled = values.get(identifier)', 'modeled = values.get(identifier)\n                    if not _number(modeled) or modeled < 0:\n                        modeled = row["observed"]'),
        "interval-validity": ('if not all(_number(v) for v in (observed, lower, upper)) or not 0 <= lower <= observed <= upper:', 'if False:'),
        "interval-provenance": ('if row.get("source_sha256") != spec["source_sha256"] or not _hash(row.get("interval_evidence_sha256")) or row.get("interval_method") != protocol["shared_context"]["interval_method"]:', 'if False:'),
        "observation-grade": ('if row.get("grade") not in {"A", "B"} or row.get("qa_passed") is not True or row.get("match_status") != "matched":', 'if False:'),
        "basis-comparability": ('if row.get("basis") != spec["basis"] or output.get("basis", {}).get(identifier) != spec["basis"]:', 'if False:'),
        "independent-evidence": ('if len(clusters) < gate["minimum_independent_clusters"]:', 'if False:'),
        "local-failure": ('if "fail" in outcomes:', 'if False:'),
        "missing-claim": ('if not outcomes or "inconclusive" in outcomes:', 'if False:'),
        "missing-scale": ('(["inconclusive"] if reasons else [])', '[]'),
        "max-raw": ('return max(r["raw_ape"] for r in rows)', 'return min(r["raw_ape"] for r in rows)'),
        "max-excess": ('return max(r["excess_ape"] for r in rows)', 'return min(r["excess_ape"] for r in rows)'),
        "raw-residual": ('signed = modeled - observed', 'signed = 0'),
        "interval-excess": ('excess = max(lower - modeled, modeled - upper, 0)', 'excess = 0'),
        "raw-ape": ('abs(signed) / observed * 100', 'abs(signed) / observed'),
        "excess-ape": ('excess / observed * 100', 'excess / observed'),
        "rmse": ('math.sqrt(len(rows))', 'len(rows)'),
        "share": ('r["raw_ape"] <= g["tolerance_percent"]', 'r["raw_ape"] > g["tolerance_percent"]'),
        "correlation": ('return statistics.correlation(observed, modeled)', 'return 1.0'),
        "threshold": ('outcome = "pass" if passes else "fail"', 'outcome = "pass"'),
        "method-averaging": ('modeled = values.get(identifier)', 'modeled = (model_outputs["aequilibrae"]["values"].get(identifier, 0) + model_outputs["activitysim"]["values"].get(identifier, 0)) / 2'),
        "weight": ('weight * observed, weight * modeled, weight * lower, weight * upper', 'observed, modeled, lower, upper'),
    }
    for label, (old, new) in changes.items():
        if source.count(old) != 1:
            raise RuntimeError(f"mutation anchor is not unique: {label}")
        yield label, source.replace(old, new)


def main() -> None:
    source = SOURCE.read_text()
    before = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    baseline = run_copy(source)
    if baseline["failures"] or baseline["errors"]:
        raise RuntimeError(f"baseline failed: {baseline}")
    survivor = run_copy(source + "\n# Harmless mutation control.\n")
    if survivor["failures"] or survivor["errors"]:
        raise RuntimeError("harmless mutation did not survive")
    records = []
    for label, candidate in mutations(source):
        selected = {"invalid-model-output": "test_bad_outputs_are_inconclusive", "interval-validity": "test_insufficient_interval_reversed", "method-averaging": "test_local_failure_cannot_be_hidden"}.get(label)
        result = run_copy(candidate, selected)
        # Assertions, not imports, runner errors, skipped tests or syntax errors,
        # must catch a mutant. Retain the exact failing test identities.
        record = {"mutation": label, "outcome": "killed" if result["failures"] else "SURVIVED",
                  "assertions": result["failures"], "additional_errors_not_counted_as_kills": result["errors"]}
        records.append(record)
    restored = run_copy(source)
    if restored["failures"] or restored["errors"] or hashlib.sha256(SOURCE.read_bytes()).hexdigest() != before:
        raise RuntimeError("restored source changed or failed")
    print(json.dumps({"source_sha256": before, "baseline": baseline, "harmless": "survived",
                      "mutations": records, "restored": restored,
                      "blind_category": "Synthetic supplied-input arithmetic only; no source authenticity, access-control, native engine, production, or scientific acceptance evidence."}, indent=2))
    if any(r["outcome"] != "killed" for r in records):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
