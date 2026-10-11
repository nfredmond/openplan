"""Challenge cancelled replay and the installed CLI budget, restoring source."""
import hashlib
import json
import os
import sys
import time
from pathlib import Path

from candidate_process_bounds import run_bounded

root = Path(__file__).resolve().parents[3]
app = root / "openplan"
out = Path(sys.argv[1]).resolve()
out.mkdir(mode=0o700, parents=True, exist_ok=False)
paths = {
    "attempt": app / "src/lib/gtfs/managed-worker-attempt.ts",
    "queue": app / "src/lib/gtfs/managed-worker-queue.ts",
    "cli": app / "scripts/workers/gtfs-ingestion.ts",
}
originals = {name: path.read_text() for name, path in paths.items()}
variants = [
    ("baseline", {}, None, None),
    ("harmless-comment", {"attempt": originals["attempt"].replace(
        "// Cancellation supersedes", "// Recorded cancellation supersedes")}, None, None),
    ("cancelled-terminal-replay", {"attempt": originals["attempt"].replace(
        '    if (snapshot.state === "cancelled") return { state: "observed_terminal" as const, snapshot };\n', "")},
        "observes cancellation before replaying", "promise rejected"),
    ("fixed-supervisor-budget", {"queue": originals["queue"].replace(
        "Math.max(30 * 60_000, budget + 30_000)", "30 * 60_000")},
        "extends the supervisor for a configured", "2730000"),
    ("cli-overrides-budget", {"cli": originals["cli"].replace(
        "parser: gtfsQueueParserOptions(process.env)",
        "parser: { ...gtfsQueueParserOptions(process.env), maxRuntimeMs: 30 * 60_000 }")},
        "the actual installed CLI passes", "2730000"),
    ("timer-overflow-allowed", {"queue": originals["queue"].replace(
        "z.number().int().max(2_147_483_647).parse(Math.max(30 * 60_000, budget + 30_000))",
        "Math.max(30 * 60_000, budget + 30_000)")},
        "refuses an unrepresentable parser timer 2147483647", "expected [Function] to throw an error"),
    ("restored", {}, None, None),
]
records = []
try:
    for name, changes, title, failure in variants:
        for key, path in paths.items():
            path.write_text(changes.get(key, originals[key]))
        if changes:
            assert any(changes[key] != originals[key] for key in changes), "Mutation made no source change"
        report = out / (name + ".json")
        started = time.monotonic()
        code, reason = run_bounded([
            str(app / "node_modules/.bin/vitest"), "run", "src/test/gtfs-managed-worker-attempt.test.ts",
            "src/test/gtfs-managed-worker-queue.test.ts", "src/test/gtfs-worker-cli-options.test.ts",
            "--maxWorkers=1", "--reporter=json", "--outputFile=" + str(report),
        ], app, {**os.environ, "NODE_OPTIONS": "--max-old-space-size=512"}, out / (name + ".log"), 90)
        assert reason is None, (name, reason)
        data = json.loads(report.read_text())
        if title:
            assert code != 0 and data["numFailedTests"] > 0, name
            matched = [case for suite in data["testResults"] for case in suite["assertionResults"]
                       if title in case["title"] and case["status"] == "failed"]
            assert matched and any(failure in "\n".join(case["failureMessages"]) for case in matched), name
        else:
            assert code == 0 and data["numFailedTests"] == 0 and data["numPendingTests"] == 0, name
        records.append({"case": name, "exitCode": code, "expectedTest": title, "expectedFailure": failure,
                        "passed": True, "seconds": round(time.monotonic() - started, 3)})
finally:
    for name, path in paths.items():
        path.write_text(originals[name])
        assert path.read_text() == originals[name]

result = {"records": records, "sourceSha256": {
    str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths.values()},
    "limits": "Mocked database transport and actual CLI configuration invocation. Native SQL, real parser runtime, hosted commissioning and scientific accuracy remain separate."}
(out / "review-recovery-controls.json").write_text(json.dumps(result, indent=2) + "\n")
print("Three positive and four targeted broken recovery/CLI variants pass their stated expectations.")
