"""Run local source controls under the private capped runner and shared lock.

Usage: python3 verify_controls.py REPOSITORY PRIVATE_DIRECTORY [CAMPAIGN [CASE ...]]
The caller supplies run.py and vitest.config.mts in its private directory.
Each trial restores exact source bytes, including when its check fails.
"""
from pathlib import Path
import fcntl
import hashlib
import json
import os
import subprocess
import sys

repo, private = (Path(value).resolve() for value in sys.argv[1:3])
route = "openplan/src/app/api/reports/[reportId]/generate/route.ts"
parser = "openplan/src/lib/supabase/pending-schema.ts"
report_test = "src/test/report-generate-route.test.ts"
parser_test = "src/test/pending-schema-missing-column.test.ts"
projection_guard = "src/test/reference-count-projection-guard.test.ts"
classifier_guard = "src/test/one-pending-schema-classifier.test.ts"
all_files = [report_test, parser_test, "src/test/report-html-accepted-narrative.test.ts", projection_guard, classifier_guard]
initial = "keeps the initial project projection literal"
groups = "removes exactly the confirmed optional group"
refusal = "refuses unclassified project read errors without dropping fields"
call = '      const missingColumn = readPendingSchemaMissingColumn(message, "projects");'
private_copy = '''      const missingColumn = (
        /column (?:(?:public\\.)?projects\\.)?["']?(\\w+)["']? does not exist/i.exec(message)?.[1]
        ?? /could not find the ['"](\\w+)['"] column of ['"]projects['"]/i.exec(message)?.[1]
      )?.toLowerCase();'''
full_projection = next(line for line in (repo / route).read_text().splitlines() if line.startswith("const PACKET_PROJECT_COLUMNS ="))
literal = full_projection.split(" = ", 1)[1].removesuffix(";")
computed = "const PACKET_PROJECT_COLUMNS = [" + literal + '].join(", ");'
# Each tuple names the source fault and the assertions that must observe it.
cases = [
    ("harmless", route, "// Remove only the named unavailable field group.", "// Recover only the named unavailable field group.", all_files, None, None),
    ("computed-projection", route, full_projection, computed, [projection_guard, report_test], "guards the guard|" + initial, {"guards the guard": "expected 182 to be less than 182", "keeps the initial project projection literal": "Source guard resolves the actual initial projection"}),
    ("inline-private-parser", route, call, private_copy, [classifier_guard], "no inline pending-schema regex.*adds no new file", {"adds no new file": "these files test a pending-schema regex inline"}),
    ("initial-projection-omission", route, ", place_ref,", ",", [report_test], initial, {initial: "Actual initial projection retains every group in order"}),
    ("extra-fallback-omission", route, "projectColumnsForPacket.filter(column => !missing.columns.some", 'projectColumnsForPacket.filter(column => column !== "created_at" && !missing.columns.some', [report_test], groups, {groups: "Fallback removes the complete named group and nothing else"}),
    ("parser-returns-no-column", parser, "  if (!message || !looksLikePendingSchema(message)", "  return null;\n  if (!message || !looksLikePendingSchema(message)", [parser_test], "reads the supported|uses the supplied relation|preserves quoted column", {"reads the supported": "Supported missing column retains its identity", "uses the supplied relation": "expected null to be", "preserves quoted column": "Quoted names retain case"}),
    ("parser-relation-bypass", parser, "if (postgres) return !postgres[1] || postgres[1] === relation ? postgres[3] : null;", "if (postgres) return postgres[3];", [parser_test, report_test], "refuses a different relation: column|" + refusal + ": column reports", {"refuses a different relation": "Named relation must match", refusal: "Unclassified failure never retries a narrower projection"}),
    ("cache-relation-bypass", parser, "return cache && cache[4] === relation ? cache[2] : null;", "return cache ? cache[2] : null;", [parser_test, report_test], "refuses a different relation: Could|" + refusal + ": Could not find", {"refuses a different relation": "Named relation must match", refusal: "Unclassified failure never retries a narrower projection"}),
    ("parser-unknown-accepted", parser, "  if (!message || !looksLikePendingSchema(message)", '  return "jurisdiction_context";\n  if (!message || !looksLikePendingSchema(message)', [parser_test], "refuses an unrecognized or unsafe message|refuses an unsupported relation argument", {"refuses an unrecognized": "Unknown forms must refuse narrowing", "refuses an unsupported": "Relation argument must be a simple name"}),
    ("quoted-column-folded", parser, "? postgres[3] : null;", "? postgres[3].toLowerCase() : null;", [parser_test, report_test], "preserves quoted column|" + refusal + ": column projects.*Jurisdiction_Context", {"preserves quoted column": "Quoted names retain case", refusal: "Unclassified failure never retries a narrower projection"}),
    ("permission-prefix-accepted", parser, "  if (!message || !looksLikePendingSchema(message)", '  if (message?.startsWith("permission denied:")) return "jurisdiction_context";\n  if (!message || !looksLikePendingSchema(message)', [parser_test, report_test], "refuses an unrecognized or unsafe message: permission denied:|" + refusal + ": permission denied:", {"refuses an unrecognized": "Unknown forms must refuse narrowing", refusal: "Unclassified failure never retries a narrower projection"}),
    ("boolean-classifier-changed", parser, "  return /relation .* does not exist", "  return false && /relation .* does not exist", [parser_test], "leaves the ordinary boolean classifier", {"leaves the ordinary boolean": "Existing boolean classification is unchanged"}),
]
originals = {name: (repo / name).read_bytes() for name in [route, parser]}
campaign = sys.argv[3] if len(sys.argv) > 3 else "controls"
assert campaign.isalnum(), "Campaign must be alphanumeric"
selected = set(sys.argv[4:])
assert not selected or selected <= {case[0] for case in cases}, "Unknown case selection"
cases = [case for case in cases if not selected or case[0] in selected]
expected_counts = {
    "harmless": 180, "computed-projection": 2, "inline-private-parser": 1,
    "initial-projection-omission": 1, "extra-fallback-omission": 4,
    "parser-returns-no-column": 9, "parser-relation-bypass": 2,
    "cache-relation-bypass": 2, "parser-unknown-accepted": 22,
    "quoted-column-folded": 2, "boolean-classifier-changed": 1,
    "permission-prefix-accepted": 2,
}
output = private / campaign
output.mkdir()
summary = []
for label, name, before, after, files, selection, diagnostics in cases:
    with open("/home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        assert all((repo / item).read_bytes() == value for item, value in originals.items()), "Unexpected source drift"
        target = repo / name
        source = originals[name].decode()
        assert source.count(before) == 1, (label, "mutation anchor must be unique", source.count(before))
        report_path = output / f"{label}.vitest.json"
        assert not report_path.exists(), "Refuse to overwrite a trial"
        try:
            target.write_text(source.replace(before, after, 1))
            command = ["python3", str(private / "run.py"), campaign + "-" + label, str(repo / "openplan"), "node", "node_modules/vitest/vitest.mjs", "run", *files, "--config", str(private / "vitest.config.mts"), "--configLoader", "runner", "--maxWorkers", "1", "--no-file-parallelism", "--sequence.shuffle", "--sequence.seed", "723279", "--reporter", "json", "--outputFile", str(report_path)]
            if selection:
                command += ["-t", selection]
            result = subprocess.run(command, env={**os.environ, "PR330_LOCK_HELD": "1"}, capture_output=True, text=True)
            (output / f"{label}.controller.log").write_text(result.stdout + result.stderr)
            report = json.loads(report_path.read_text())
            executed = [test for suite in report["testResults"] for test in suite["assertionResults"] if test["status"] in {"passed", "failed"}]
            assert len(executed) == expected_counts[label], (label, "Wrong assertion selection", len(executed), expected_counts[label])
            if diagnostics is None:
                assert result.returncode == 0 and report["success"] and all(test["status"] == "passed" for test in executed), label
                outcome = "SURVIVED"
            else:
                assert result.returncode == 1 and not report["success"], (label, "Wrong runner result")
                for test in executed:
                    expected = [diagnostic for title, diagnostic in diagnostics.items() if title in test["title"]]
                    assert len(expected) == 1, (label, "Unexpected test", test["title"])
                    assert test["status"] == "failed" and any("AssertionError" in message and expected[0] in message for message in test["failureMessages"]), (label, "Wrong assertion", test)
                outcome = "KILLED"
            receipt = json.loads((private / "logs" / f"{campaign}-{label}.json").read_text())
            assert receipt["exitCode"] == result.returncode
            assert receipt["cwd"] == str(repo / "openplan")
            assert receipt["metrics"]["memory.max"] == "1610612736" and receipt["metrics"]["memory.swap.max"] == "0"
            assert "oom_kill 0" in receipt["metrics"]["memory.events"]
            summary.append({"label": label, "source": name, "outcome": outcome, "executedTests": len(executed), "diagnostics": diagnostics, "receipt": str(private / "logs" / f"{campaign}-{label}.json"), "report": str(report_path), "memoryPeakBytes": int(receipt["metrics"]["memory.peak"])})
            print(json.dumps(summary[-1]), flush=True)
        finally:
            target.write_bytes(originals[name])
            assert target.read_bytes() == originals[name], (label, "Restoration failed")
            (output / "restored-hashes.json").write_text(json.dumps({item: hashlib.sha256((repo / item).read_bytes()).hexdigest() for item in originals}, indent=2) + "\n")
        (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
