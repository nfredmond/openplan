#!/usr/bin/env python3
"""Run the focused packet test and restore each source mutation in finally."""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile


REVIEW = Path(__file__).resolve().parent
ROOT = REVIEW.parents[2]
APP = ROOT / "openplan"
SOURCE = APP / "src/lib/reports/geography-figure.ts"
TEST = "src/test/packet-geography-figure.test.ts"
TEST_NAME = "keeps resolved study-place identity separate from jurisdiction and legal authority"
EVIDENCE = REVIEW / "evidence"
FIXED = "The project's area of record is a searched study place whose boundary and county filter can be recovered. Project jurisdiction requires a separate human declaration and assessment. Geography does not resolve adopting authority or legal applicability."
OLD = "The project's area of record \u2014 a place that was searched for, so the boundary, the county filter and the jurisdiction can all be re-derived from it."
RUNNER = """
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { startVitest } = await import(pathToFileURL(resolve('node_modules/vitest/dist/node.js')).href);
const context = await startVitest('test', [process.env.FOCUSED_TEST], {
  root: process.cwd(), config: resolve('vitest.config.ts'), configLoader: 'bundle',
  run: true, watch: false, maxWorkers: 1, fileParallelism: false, pool: 'forks',
  reporters: ['default', 'json'], outputFile: { json: process.env.RESULT_PATH },
}, { cacheDir: process.env.PRIVATE_CACHE });
if (!context) throw new Error('Vitest did not initialize');
console.log(JSON.stringify({cwd: process.cwd(), cacheDir: context.vite.config.cacheDir,
  maxWorkers: context.config.maxWorkers, pool: context.config.pool,
  configFile: context.vite.config.configFile}));
await context.close();
"""


def digest(data):
    return hashlib.sha256(data).hexdigest()


def run_case(name, content):
    original = SOURCE.read_bytes()
    result_path = EVIDENCE / f"{name}.json"
    env = {**os.environ, "NODE_OPTIONS": "--max-old-space-size=1024",
           "FOCUSED_TEST": TEST, "RESULT_PATH": str(result_path),
           "PRIVATE_CACHE": str(CACHE / name), "NO_COLOR": "1"}
    try:
        SOURCE.write_bytes(content)
        result = subprocess.run(["node", "--input-type=module", "-e", RUNNER],
                                cwd=APP, env=env, text=True, capture_output=True,
                                timeout=90)
        (EVIDENCE / f"{name}.log").write_text((result.stdout + result.stderr).rstrip() + "\n")
        report = json.loads(result_path.read_text())
        failures = [assertion for suite in report["testResults"]
                    for assertion in suite["assertionResults"]
                    if assertion["status"] == "failed"]
        record = {"case": name, "exitCode": result.returncode,
                  "passed": report["numPassedTests"], "failed": report["numFailedTests"],
                  "failedTitles": [item["title"] for item in failures],
                  "sourceSha256": digest(content)}
        print(json.dumps(record), flush=True)
        if name == "old-inference":
            assert result.returncode == 1 and len(failures) == 1, record
            assert failures[0]["title"] == TEST_NAME, record
            # Vitest abbreviates JSON failureMessages; stderr includes the full expected copy.
            assert 'Expected: "Project jurisdiction requires a separate human declaration and assessment."' in result.stderr
        else:
            assert result.returncode == 0 and report["numFailedTests"] == 0, record
            assert report["numPassedTests"] > 0, record
        return record
    finally:
        SOURCE.write_bytes(original)
        assert SOURCE.read_bytes() == original


if __name__ == "__main__":
    assert Path.cwd().resolve() == APP, "Run from the assigned nested openplan directory"
    assert APP == Path("/home/nathaniel/.t3/worktrees/openplan/t3-e444198e/openplan")
    EVIDENCE.mkdir(exist_ok=True)
    CACHE = Path(tempfile.mkdtemp(prefix="pr330-study-place-wording-", dir=Path.home() / ".local/state/openplan"))
    before = SOURCE.read_bytes()
    assert before.count(FIXED.encode()) == 1
    records = []
    try:
        direction = subprocess.run(["npm", "run", "product:direction:check"], cwd=APP,
                                   text=True, capture_output=True, timeout=45,
                                   env={**os.environ, "NODE_OPTIONS": "--max-old-space-size=1024"})
        (EVIDENCE / "direction-check.log").write_text(direction.stdout + direction.stderr)
        print(f"direction-check exit={direction.returncode}", flush=True)
        records.append(run_case("baseline", before))
        records.append(run_case("harmless-comment", b"// Harmless report wording control.\n" + before))
        records.append(run_case("old-inference", before.replace(FIXED.encode(), OLD.encode())))
        records.append(run_case("restored", before))
    finally:
        SOURCE.write_bytes(before)
        assert SOURCE.read_bytes() == before
        (EVIDENCE / "controls.json").write_text(json.dumps({
            "cwd": str(APP), "cacheRoot": str(CACHE),
            "heapMiB": 1024, "maxWorkers": 1,
            "directionExitCode": direction.returncode,
            "sourceRestoredExactly": SOURCE.read_bytes() == before,
            "sourceSha256": digest(before), "cases": records,
        }, indent=2) + "\n")
