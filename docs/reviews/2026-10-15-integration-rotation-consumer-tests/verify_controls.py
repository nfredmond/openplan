"""Run only the two combined consumer cases, restoring source after each fault."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess


TRANSLATION = "prepares then verifies the original workspace selection across rotation"
API = "rejects a substituted API destination with a recomputed outer hash after previous-secret decrypt"
TITLES = {TRANSLATION, API}


def intended(code, report, title, reason):
    suites = report.get("testResults", [])
    rows = [row for suite in suites for row in suite.get("assertionResults", [])]
    failed = [row for row in rows if row.get("status") == "failed"]
    passed = [row for row in rows if row.get("status") == "passed"]
    return (code == 1 and report.get("success") is False
            and report.get("numTotalTests") == 2 and report.get("numFailedTests") == 1
            and report.get("numPassedTests") == 1 and report.get("numPendingTests") == 0
            and report.get("numRuntimeErrorTestSuites", 0) == 0
            and len(suites) == 1 and len(rows) == 2 and len(failed) == len(passed) == 1
            and {row.get("title") for row in rows} == TITLES
            and failed[0].get("title") == title
            and any(reason in message and "AssertionError" in message
                    for message in failed[0].get("failureMessages", []))
            and not passed[0].get("failureMessages"))


def classifier_controls(classify):
    sample = {"success": False, "numTotalTests": 2, "numFailedTests": 1, "numPassedTests": 1,
              "numPendingTests": 0, "testResults": [{"assertionResults": [
                  {"title": API, "status": "failed", "failureMessages": ["AssertionError: exact diagnostic"]},
                  {"title": TRANSLATION, "status": "passed", "failureMessages": []}]}]}
    assert classify(1, sample, API, "exact diagnostic"), "Classifier must accept a named assertion failure"
    trials = [("runtime-exit", 2, sample), ("empty-selection", 1, {**sample, "numTotalTests": 0}),
              ("runtime-suite", 1, {**sample, "numRuntimeErrorTestSuites": 1}),
              ("extra-failure", 1, {**sample, "numFailedTests": 2}),
              ("false-success", 1, {**sample, "success": True}),
              ("skipped-peer", 1, {**sample, "numPendingTests": 1}),
              ("no-suite", 1, {**sample, "testResults": []})]
    for label, field, value in [("wrong-title", "title", "unrelated case"),
                                ("wrong-diagnostic", "failureMessages", ["AssertionError: unrelated"]),
                                ("import-error", "failureMessages", ["Error: Cannot find module exact diagnostic"])]:
        altered = copy.deepcopy(sample)
        altered["testResults"][0]["assertionResults"][0][field] = value
        trials.append((label, 1, altered))
    for label, code, report in trials:
        assert not classify(code, report, API, "exact diagnostic"), "Classifier must refuse " + label
    return [label for label, _, _ in trials]


def run(repo, out):
    out.mkdir(parents=True, exist_ok=False)  # Retain failed attempts; never overwrite a prior trial.
    app = repo / "openplan"
    test = app / "src/test/integration-rotation-consumer-chain.test.ts"
    workspace = app / "src/lib/integrations/workspace-keys.ts"
    crypto = app / "src/lib/integrations/key-crypto.ts"
    api = app / "src/lib/integrations/provider-api-credentials.ts"
    originals = {path: path.read_bytes() for path in (test, workspace, crypto, api)}
    cgroup = Path("/sys/fs/cgroup" + Path("/proc/self/cgroup").read_text().strip().split("::")[1])
    assert (cgroup / "memory.max").read_text().strip() == "1073741824", "Require 1 GiB cgroup"
    assert (cgroup / "memory.swap.max").read_text().strip() == "0", "Require no swap"
    cache = out / "cache"
    cache.mkdir()
    config = out / "vitest.config.mjs"
    config.write_text("import { defineConfig } from " + json.dumps(str(app / "node_modules/vitest/dist/config.js"))
        + ";\nexport default defineConfig(" + json.dumps({"root": str(app), "cacheDir": str(cache / "vite"),
            "resolve": {"alias": {"@": str(app / "src")}}, "test": {"environment": "node",
                "include": [str(test.relative_to(app))], "maxWorkers": 1, "fileParallelism": False,
                "unstubEnvs": True, "clearMocks": True, "testTimeout": 20000}}) + ");\n")
    refused = classifier_controls(intended)
    classifier_controls(lambda *args: intended(*args))  # Harmless wrapper survives.
    try:
        classifier_controls(lambda *_: True)
    except AssertionError as error:
        assert str(error) == "Classifier must refuse runtime-exit"
    else:
        raise AssertionError("Permissive classifier mutation survived")
    (out / "classifier-controls.json").write_text(json.dumps({"refused": refused,
        "harmlessWrapper": "survived", "permissiveFault": "Classifier must refuse runtime-exit"}, indent=2) + "\n")

    def restore():
        for path, raw in originals.items():
            if path.read_bytes() != raw:
                path.write_bytes(raw)

    def execute(label):
        report_path = out / (label + ".json")
        result = subprocess.run(["npm", "exec", "--", "vitest", "run", "--config", str(config),
            "--maxWorkers=1", "--no-file-parallelism", "--reporter=json", "--outputFile=" + str(report_path)],
            cwd=app, capture_output=True, text=True, timeout=60,
            env={**os.environ, "NODE_OPTIONS": "--max-old-space-size=640", "npm_config_cache": str(cache / "npm"),
                 "XDG_CACHE_HOME": str(cache), "TMPDIR": str(cache)})
        log = result.stdout + result.stderr
        (out / (label + ".log")).write_text(log)
        assert not re.search(r"Unhandled (?:Errors?|Rejections?)|Uncaught Exception|Cannot find module|Failed to (?:load|resolve)", log, re.I), label + " runtime/import failure"
        report = json.loads(report_path.read_text())
        return result.returncode, report

    records = []

    def positive(label):
        code, report = execute(label)
        rows = [row for suite in report.get("testResults", []) for row in suite.get("assertionResults", [])]
        assert code == 0 and report.get("success") is True and report.get("numTotalTests") == 2, label
        assert report.get("numPassedTests") == 2 and report.get("numFailedTests") == report.get("numPendingTests") == 0, label
        assert len(rows) == 2 and {row["title"] for row in rows} == TITLES and all(row["status"] == "passed" for row in rows), label
        records.append({"trial": label, "outcome": "survived", "passed": 2})
        print(label + " survived", flush=True)

    faults = [
        ("no-previous-secret-read", crypto, TRANSLATION,
         "Prepared selection must verify through the previous secret after rotation",
         "return decryptWithSecret(stored, previous, binding);", "return binding ? null : decryptWithSecret(stored, previous, binding);"),
        ("plaintext-instead-of-stored-digest", workspace, TRANSLATION,
         "Selection fingerprints the exact original stored ciphertext",
         '.update(row.key_ciphertext).digest("hex")', '.update(apiKey ?? "").digest("hex")'),
        ("omit-selected-workspace-column", workspace, TRANSLATION,
         "Every selection read keeps the exact projection and workspace/provider filters",
         '.select("workspace_id, provider, key_ciphertext")', '.select("provider, key_ciphertext")'),
        ("ignore-retained-ciphertext-digest", workspace, TRANSLATION,
         "Same plaintext with replacement ciphertext must refuse the retained digest",
         "selection.selectedKeyCiphertextHash !== selectedKeyCiphertextHash ||", "false ||"),
        ("fallback-payer-after-row-decrypt-fails", workspace, TRANSLATION,
         "Removing the needed secret must refuse the stored row despite an available environment payer",
         "apiKey = decryptIntegrationKey(row.key_ciphertext, { workspaceId });",
         "apiKey = decryptIntegrationKey(row.key_ciphertext, { workspaceId }) ?? sharedAnthropicApiKey();"),
        ("ignore-encrypted-api-configuration-hash", api, API,
         "Encrypted configuration hash must refuse the recomputed destination substitution",
         "envelope.configurationHash !== stored.configurationHash", "false"),
        ("ignore-outer-api-configuration-hash", api, API,
         "Stale outer hash refuses before envelope decryption",
         "if (configurationHash(stored.configuration) !== stored.configurationHash) throw new Error();", "// Outer comparison removed for diagnostic trial."),
    ]
    try:
        positive("baseline")
        # Each changed test executes under harmless source comments first.
        for path in (workspace, api):
            path.write_bytes(originals[path] + b"\n// Harmless consumer observation note.\n")
        positive("harmless")
        restore()
        positive("restored-after-harmless")
        for label, path, title, reason, before, after in faults:
            restore()
            raw = originals[path].decode()
            assert raw.count(before) == 1, "Mutation anchor differs: " + label
            path.write_text(raw.replace(before, after, 1))
            code, report = execute(label)
            accepted = intended(code, report, title, reason)
            records.append({"trial": label, "outcome": "intended_failure" if accepted else "REJECTED",
                            "test": title, "diagnostic": reason, "exit": code})
            (out / "controls.json").write_text(json.dumps(records, indent=2) + "\n")
            assert accepted, label + " did not fail at its intended assertion"
            print(label + " intended failure", flush=True)
        restore()
        positive("restored-final")
    finally:
        restore()
        (out / "controls.json").write_text(json.dumps(records, indent=2) + "\n")
        (out / "source-bindings.json").write_text(json.dumps({str(path.relative_to(repo)):
            hashlib.sha256(raw).hexdigest() for path, raw in originals.items()}, indent=2) + "\n")
        assert all(path.read_bytes() == raw for path, raw in originals.items()), "Exact source restoration failed"
        (out / "resources.json").write_text(json.dumps({name: (cgroup / name).read_text().strip()
            for name in ("memory.max", "memory.swap.max", "memory.peak", "memory.events", "memory.swap.current")}, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve())
