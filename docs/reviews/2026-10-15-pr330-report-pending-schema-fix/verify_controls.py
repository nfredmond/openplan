"""Bounded source controls. Requires the lane's private run.py and Vitest config.

Usage: python3 verify_controls.py REPOSITORY PRIVATE_DIRECTORY CAMPAIGN [CASE ...]
Each case holds the shared check lock across mutation, execution and restoration.
No application service, database, browser or network operation occurs.
"""
from pathlib import Path
import fcntl
import hashlib
import json
import os
import subprocess
import sys

repo, private = (Path(value).resolve() for value in sys.argv[1:3])
campaign = sys.argv[3]
assert campaign.isalnum(), "Campaign must be alphanumeric."
output = private / campaign
output.mkdir()
route = "openplan/src/app/api/reports/[reportId]/generate/route.ts"
payload = "openplan/src/lib/reports/project-jurisdiction.ts"
html = "openplan/src/lib/reports/html.ts"
reader = "openplan/src/lib/projects/project-jurisdiction.ts"
main = "generates schema-pending jurisdiction with readable place and cost"
older = "generates truthful older place and jurisdiction schema disclosure"
all_new = "schema-pending jurisdiction|older place and jurisdiction|schema-pending custody|strict jurisdiction validation|malformed existing jurisdiction|unclassified project read|failed fallback|older core projection"
cases = [
    ("harmless-comment", route, "// Remove only the named unavailable field group.", "// Recover only the named unavailable field group.", all_new, 15, None),
    ("strict-builder-on-pending", route, "const jurisdictionReadiness = projectJurisdictionSchemaPending", "const jurisdictionReadiness = false", main, 2, "Schema-pending jurisdiction still generates"),
    ("false-jurisdiction-success", payload, 'jurisdictionReadState: "schema_pending" as const', 'jurisdictionReadState: "ok" as const', main, 2, "Pending custody never invents a human declaration or registry assessment"),
    ("false-geography-success", payload, "    studyAreaReadState,", '    studyAreaReadState: "ok",', older, 2, "Pending payload records missing study geography"),
    ("missing-disclosure", html, 'if (payload.schema === "openplan.report-project-jurisdiction-schema-pending.v1") {\n    return `<section id="project-jurisdiction-context"><h2>Project jurisdiction context</h2><p>${esc(payload.disclosure)}</p>', 'if (payload.schema === "openplan.report-project-jurisdiction-schema-pending.v1") {\n    return `<section id="project-jurisdiction-context"><h2>Project jurisdiction context</h2><p>Unavailable</p>', main, 2, "Actual HTML discloses schema-pending jurisdiction"),
    ("missing-rendered-hash", html, 'Readiness payload SHA-256: ${esc(payload.payloadSha256)}.</p>', 'Readiness payload SHA-256: omitted.</p>', main, 2, "Actual HTML prints pending payload hash"),
    ("missing-rendered-schema", html, 'Payload schema: ${esc(payload.schema)}. Scope: ${esc(payload.scope)}. Registry SHA-256:', 'Payload schema: omitted. Scope: ${esc(payload.scope)}. Registry SHA-256:', main, 2, "Actual HTML prints pending schema identity"),
    ("false-unset-rendering", html, '<h2>Project jurisdiction context</h2><p>${esc(payload.disclosure)}</p>', '<h2>Project jurisdiction context</h2><p>No separate declaration</p><p>${esc(payload.disclosure)}</p>', main, 2, "Pending HTML never substitutes an unset or unresolved declaration"),
    ("invented-null-context", payload, '    jurisdictionReadState: "schema_pending" as const,', '    context: null,\n    jurisdictionReadState: "schema_pending" as const,', main, 2, "Pending custody never invents a human declaration or registry assessment"),
    ("forged-hash", payload, 'createHash("sha256").update(canonicalizeActionPayload(payload)).digest("hex")', '"0".repeat(64)', main, 2, "Pending custody hashes its actual disclosed read state"),
    ("generation-clock-in-hash", payload, '    projectId: project.id ?? null,', '    generatedAt: new Date().toISOString(),\n    projectId: project.id ?? null,', "keeps schema-pending custody identical across generation clocks", 1, "Pending custody excludes the generation clock"),
    ("drop-readable-cost", route, 'projectColumnsForPacket.join(", ")', 'projectColumnsForPacket.filter(column => column !== "estimated_cost_amount").join(", ")', main, 2, "Fallback retains readable estimated_cost_amount"),
    ("drop-readable-place", route, 'projectColumnsForPacket.join(", ")', 'projectColumnsForPacket.filter(column => column !== "place_label").join(", ")', main, 2, "Fallback retains readable place_label"),
    ("wrong-project-predicate", route, '.select(projectColumnsForPacket.join(", "))\n        .eq("id", report.project_id)', '.select(projectColumnsForPacket.join(", "))\n        .eq("id", report.id)', main, 2, "Fallback retains project predicate"),
    ("place-gap-mislabeled-jurisdiction", route, 'if (missing.kind === "jurisdiction") projectJurisdictionSchemaPending = true;', 'if (missing.kind === "jurisdiction" || missing.kind === "geography") projectJurisdictionSchemaPending = true;', "retains strict jurisdiction validation when only place schema is pending", 1, "Readable jurisdiction retains strict external contract"),
    ("missing-projection-guard", reader, 'if (!("jurisdiction_context" in row)) throw new ProjectJurisdictionError("Project jurisdiction was not read.");', 'if (!("jurisdiction_context" in row)) return null;', "refuses malformed existing jurisdiction even with pending place schema", 1, "Ordinary readers still reject missing projection"),
    ("malformed-jurisdiction-accepted", reader, 'if (!parsed.success) throw new ProjectJurisdictionError("Saved project jurisdiction is invalid.");', 'if (!parsed.success) return null;', "refuses malformed existing jurisdiction even with pending place schema", 1, "Malformed saved jurisdiction fails closed"),
    ("unclassified-schema-retry", route, ')?.toLowerCase();', ')?.toLowerCase() ?? "jurisdiction_context";', "refuses unclassified project read errors without dropping fields: schema cache unavailable", 1, "Unclassified failure never retries a narrower projection"),
    ("skip-estimate-recovery", route, 'if (!missing) break;', 'if (!missing || missing.kind === "estimate") break;', "recovers the older core projection only after each optional group is confirmed missing", 1, "Old core projection still generates"),
    ("skip-site-recovery", route, 'if (!missing) break;', 'if (!missing || missing.kind === "site") break;', "recovers the older core projection only after each optional group is confirmed missing", 1, "Old core projection still generates"),
    ("unclassified-read-refusal", route, '\n      return NextResponse.json({ error: "Failed to load report source records" }, { status: 500 });', '\n      return NextResponse.json({ error: "Failed to load report source records" }, { status: 200 });', "refuses unclassified project read errors without dropping fields", 6, "Unclassified failure refuses report"),
    ("failed-fallback-refusal", route, '\n      return NextResponse.json({ error: "Failed to load report source records" }, { status: 500 });', '\n      return NextResponse.json({ error: "Failed to load report source records" }, { status: 200 });', "refuses a failed fallback read instead of generating a partial artifact", 1, "Failed fallback refuses report"),
]

selected = set(sys.argv[4:])
assert not selected or selected <= {case[0] for case in cases}, "Unknown control selection."
cases = [case for case in cases if not selected or case[0] in selected]
originals = {name: (repo / name).read_bytes() for name in {case[1] for case in cases}}
summary = []
for label, name, before, after, selection, count, diagnostic in cases:
    with open("/home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        target = repo / name
        assert target.read_bytes() == originals[name], (label, "unexpected source change")
        source = originals[name].decode()
        assert before in source, (label, "mutation anchor absent")
        report_path = output / f"{label}.vitest.json"
        assert not report_path.exists(), (label, "refusing to overwrite evidence")
        check_label = f"{campaign}-{label}"
        try:
            target.write_text(source.replace(before, after, 1))
            command = ["python3", str(private / "run.py"), check_label, str(repo / "openplan"),
                       "node", "node_modules/vitest/vitest.mjs", "run", "src/test/report-generate-route.test.ts",
                       "--config", str(private / "vitest.config.mts"), "--configLoader", "runner",
                       "--maxWorkers", "1", "--no-file-parallelism", "-t", selection,
                       "--reporter", "json", "--outputFile", str(report_path)]
            result = subprocess.run(command, env={**os.environ, "PR330_LOCK_HELD": "1"}, capture_output=True, text=True)
            (output / f"{label}.controller.log").write_text(result.stdout + result.stderr)
            report = json.loads(report_path.read_text())
            executed = [test for suite in report["testResults"] for test in suite["assertionResults"]
                        if test["status"] in {"passed", "failed"}]
            assert len(executed) == count, (label, "wrong test selection", len(executed), count)
            if diagnostic is None:
                assert result.returncode == 0 and report["success"] and all(test["status"] == "passed" for test in executed), label
                outcome = "SURVIVED"
            else:
                assert result.returncode == 1 and not report["success"], (label, "wrong runner outcome")
                assert all(test["status"] == "failed" and any("AssertionError" in message and diagnostic in message for message in test["failureMessages"]) for test in executed), (label, "wrong assertion", executed)
                outcome = "KILLED"
            receipt = json.loads((private / "logs" / f"{check_label}.json").read_text())
            assert receipt["exitCode"] == result.returncode
            assert receipt["metrics"]["memory.max"] == "1610612736"
            assert receipt["metrics"]["memory.swap.max"] == "0"
            assert "oom_kill 0" in receipt["metrics"]["memory.events"]
            item = {"label": label, "outcome": outcome, "selectedTests": count, "diagnostic": diagnostic,
                    "source": name, "elapsedSeconds": receipt["elapsedSeconds"], "memoryPeakBytes": int(receipt["metrics"]["memory.peak"])}
        finally:
            target.write_bytes(originals[name])
            assert target.read_bytes() == originals[name], (label, "restoration differs")
        item["restoredSha256"] = hashlib.sha256(target.read_bytes()).hexdigest()
        summary.append(item)
        (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
        print(json.dumps(item), flush=True)

assert all((repo / name).read_bytes() == content for name, content in originals.items())
print("All source bytes restored exactly.", flush=True)
