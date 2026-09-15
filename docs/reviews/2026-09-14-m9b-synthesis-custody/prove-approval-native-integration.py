"""Exercise approval schema counts, SQL-read classifications and operator migration disclosure."""
from pathlib import Path
import hashlib
import json
import subprocess
import tempfile

review = Path(__file__).resolve().parent
repo = review.parents[2]
app = repo / "openplan"
catalog = app / "src/test/a-column-nothing-reads-is-a-question.test.ts"
inventory = app / "src/test/migrations/inventory.test.ts"
migration = app / "supabase/migrations/20261014000028_engagement_synthesis_approvals.sql"
changelog = repo / "CHANGELOG.md"
originals = {path: path.read_bytes() for path in [catalog, inventory, migration, changelog]}
tests = ["src/test/migrations/inventory.test.ts", "src/test/migrations/release-ordering.test.ts", "src/test/a-column-nothing-reads-is-a-question.test.ts"]
cases = [("baseline", None, "", "", None), ("harmless-comment", migration, "-- Approval is internal", "-- Retained approval is internal", None)]
for line in originals[catalog].decode().splitlines(keepends=True):
    if 'column: "engagement_synthesis_approval_events.' in line:
        cases.append(("unclassified-" + line.split('column: "')[1].split('"')[0], catalog, line, "", "finds no unread column that is not accounted for"))
for label, old, new in [("relation-count", "relations: 270", "relations: 269"), ("table-count", "tables: 256", "tables: 255"), ("rls-count", "rlsEnabledTables: 256", "rlsEnabledTables: 255")]:
    cases.append((label, inventory, old, new, "reads every relation the migrations declare"))
cases.append(("rls-disabled", migration, "ALTER TABLE public.engagement_synthesis_approval_events ENABLE ROW LEVEL SECURITY;", "-- Synthetic missing RLS fault.", "distinguishes a table with no RLS from a table with no policy"))
line = next(line for line in originals[changelog].decode().splitlines(keepends=True) if line.startswith("- `20261014000028_"))
cases.append(("undisclosed-migration", changelog, line, "", "the CHANGELOG's Unreleased section names every migration landed since the newest tag"))
results = []
try:
    with tempfile.TemporaryDirectory(prefix="openplan-approval-integration-") as scratch:
        for name, path, before, after, assertion in cases:
            for file, raw in originals.items():
                file.write_bytes(raw)
            if path:
                value = path.read_text()
                assert value.count(before) == 1, name
                path.write_text(value.replace(before, after, 1))
            report = Path(scratch) / "result.json"
            report.unlink(missing_ok=True)
            run = subprocess.run(["node_modules/.bin/vitest", "run", *tests, "--reporter=json", "--outputFile=" + str(report)], cwd=app, capture_output=True, text=True, timeout=60)
            payload = json.loads(report.read_text())
            failures = [test["fullName"] for suite in payload["testResults"] for test in suite["assertionResults"] if test["status"] == "failed"]
            correct = (run.returncode == 0 and payload["numPassedTests"] == 40 and payload["numFailedTests"] == 0) if assertion is None else (run.returncode != 0 and any(assertion in name for name in failures))
            results.append({"case": name, "expected": "survives" if assertion is None else "fails", "expectedOutcome": bool(correct), "exit": run.returncode,
                "passed": payload["numPassedTests"], "failed": payload["numFailedTests"], "failedAssertions": failures})
            print(name, "expected" if correct else "UNEXPECTED", flush=True)
            if not correct:
                raise AssertionError((name, failures, run.stdout[-1500:], run.stderr[-1500:]))
finally:
    for path, raw in originals.items():
        path.write_bytes(raw)
    (review / "approval-native-integration-mutations.json").write_text(json.dumps({"cases": results,
        "sourcesRestored": all(path.read_bytes() == raw for path, raw in originals.items()),
        "sourceSha256": {str(path.relative_to(repo)): hashlib.sha256(raw).hexdigest() for path, raw in originals.items()},
        "blindCategories": ["Static schema counts do not establish runtime access or transaction safety.", "SQL-read classifications document real SQL references but do not establish a connected browser consumer.", "Migration disclosure does not prove an upgrade was applied or a release published."]}, indent=2) + "\n")
