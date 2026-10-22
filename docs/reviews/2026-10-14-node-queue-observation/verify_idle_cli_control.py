"""Keep the changed idle-request census sensitive to unexpected diagnostic traffic."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700, parents=True)
    spec = importlib.util.spec_from_file_location("node_source_controls", Path(__file__).with_name("verify_source_controls.py"))
    shared = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(shared)
    shared.oracle_controls(out)
    app = repo / "openplan"
    subject = app / "src/lib/ops/node-queue-observation.ts"
    original = subject.read_bytes()
    title = "stops the continuous worker during its idle delay"
    reason = "Idle shutdown cannot repeat a business pass"
    records = []

    def execute(label, broken=False):
        result_path = out / (label + ".json")
        result = subprocess.run(["npm", "exec", "--", "vitest", "run",
            "src/test/engagement-synthesis-preparation-cli-process.test.ts", "--maxWorkers=1",
            "--no-file-parallelism", "--testNamePattern", re.escape(title),
            "--reporter=json", "--outputFile=" + str(result_path)], cwd=app,
            env={**os.environ, "NODE_OPTIONS": "--max-old-space-size=640"},
            capture_output=True, text=True, timeout=30)
        (out / (label + ".log")).write_text(result.stdout + result.stderr)
        data = json.loads(result_path.read_text())
        failed = [row for suite in data["testResults"] for row in suite["assertionResults"] if row["status"] == "failed"]
        if broken:
            assert shared.intended_failure(result.returncode, data, failed, title, reason)
        else:
            assert result.returncode == 0 and data["success"] and data["numPassedTests"] == 1 and not failed
        records.append({"control": label, "outcome": "intended_failure" if broken else "survived", "test": title})

    try:
        execute("baseline")
        subject.write_bytes(original + b"\n// Harmless idle observation note.\n")
        execute("harmless")
        subject.write_bytes(original)
        execute("restored-after-harmless")
        text = original.decode()
        before = 'client.rpc("record_node_queue_process_observation"'
        assert text.count(before) == 1
        subject.write_text(text.replace(before, 'client.rpc("unexpected_node_observation"', 1))
        execute("unexpected-diagnostic-target", True)
        subject.write_bytes(original)
        execute("restored-final")
        (out / "controls.json").write_text(json.dumps(records, indent=2) + "\n")
    finally:
        subject.write_bytes(original)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve())
