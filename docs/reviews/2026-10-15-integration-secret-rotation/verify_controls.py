"""Exercise real local crypto and a retained envelope, with strict fault classification."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess


def intended(code, report, title, reason):
    failed = [row for suite in report.get("testResults", [])
              for row in suite.get("assertionResults", []) if row.get("status") == "failed"]
    return (code == 1 and report.get("success") is False and report.get("numTotalTests") == 13
            and report.get("numFailedTests") == 1 and len(failed) == 1
            and failed[0].get("title") == title
            and any(reason in message for message in failed[0].get("failureMessages", [])))


def oracle(out):
    row = {"title": "Required rotation case", "status": "failed", "failureMessages": ["Required rotation assertion"]}
    report = {"success": False, "numTotalTests": 13, "numFailedTests": 1,
              "testResults": [{"assertionResults": [row]}]}
    for value in (report, copy.deepcopy(report)):
        assert intended(1, value, row["title"], row["failureMessages"][0])
    faults = [("runner-error", 2, report), ("false-success", 1, {**report, "success": True}),
              ("wrong-census", 1, {**report, "numTotalTests": 0}),
              ("extra-failure", 1, {**report, "numFailedTests": 2}),
              ("missing-case", 1, {**report, "testResults": []})]
    wrong = copy.deepcopy(report)
    wrong["testResults"][0]["assertionResults"][0]["title"] = "Unrelated case"
    faults.append(("wrong-case", 1, wrong))
    wrong = copy.deepcopy(report)
    wrong["testResults"][0]["assertionResults"][0]["failureMessages"] = ["Unrelated exception"]
    faults.append(("wrong-diagnostic", 1, wrong))
    for label, code, value in faults:
        assert not intended(code, value, row["title"], row["failureMessages"][0]), label
    (out / "oracle-controls.json").write_text(json.dumps({"positiveControls": 2,
        "refusedFaults": [item[0] for item in faults]}, indent=2) + "\n")


def run(repo, out):
    os.umask(0o077)
    out.mkdir(parents=True, mode=0o700)
    app = repo / "openplan"
    source = app / "src/lib/integrations/key-crypto.ts"
    consumer = app / "src/lib/integrations/translation-credentials.ts"
    api_consumer = app / "src/lib/integrations/provider-api-credentials.ts"
    test = app / "src/test/integration-key-rotation.test.ts"
    original = {path: path.read_bytes() for path in (source, consumer, api_consumer, test)}
    oracle(out)

    def restore():
        for path, data in original.items():
            path.write_bytes(data)

    def swap(before, after):
        def edit(text):
            assert text.count(before) == 1, "Mutation anchor differs: " + before
            return text.replace(before, after, 1)
        return edit

    cases = []
    for version in ("v1", "v2", "v3"):
        cases.append(("remove-second-" + version, source,
            "reads retained " + version + " bytes under the previous secret",
            "Retained ciphertext needs the configured second secret",
            swap("return decryptWithSecret(stored, previous, binding);", "return null;")))
    cases.extend([
        ("unprepared-rolling-read", source, "lets prepared old-primary and new-primary processes read each other's writes",
         "Prepared old-primary readers must accept new-primary writes", swap(
             "  return decryptWithSecret(stored, previous, binding);",
             '  return previous.startsWith("SYNTHETIC-NEW-") ? null : decryptWithSecret(stored, previous, binding);')),
        ("write-with-old", source, "writes only with the primary secret while both secrets are configured",
         "New ciphertext needs the primary secret", swap(
             "export function encryptIntegrationKey(plaintext: string, binding?: IntegrationKeyBinding): string {\n  const secret = configuredSecret();",
             "export function encryptIntegrationKey(plaintext: string, binding?: IntegrationKeyBinding): string {\n  const secret = configuredSecret(process.env.OPENPLAN_INTEGRATION_KEY_PREVIOUS_SECRET);")),
        ("skip-primary-read", source, "reads the primary without depending on a valid previous secret",
         "Primary ciphertext must remain readable", swap(
             "const current = decryptWithSecret(stored, secret, binding);", "const current = null;")),
        ("second-without-primary", source, "requires a usable primary even when the previous secret matches",
         "A missing or short primary must refuse decryption", swap(
             "  const secret = configuredSecret();\n  if (!secret) return null;",
             "  const secret = configuredSecret() ?? configuredSecret(process.env.OPENPLAN_INTEGRATION_KEY_PREVIOUS_SECRET);\n  if (!secret) return null;")),
        ("short-second", source, "ignores an absent or invalid previous secret and trims a usable one",
         "Short second secrets cannot authenticate", swap(
             'const previous = configuredSecret(process.env.OPENPLAN_INTEGRATION_KEY_PREVIOUS_SECRET ?? "");',
             'const previous = process.env.OPENPLAN_INTEGRATION_KEY_PREVIOUS_SECRET?.trim();')),
        ("untrimmed-second", source, "ignores an absent or invalid previous secret and trims a usable one",
         "A usable second secret follows existing trim semantics", swap("const secret = value?.trim();", "const secret = value;")),
        ("foreign-workspace", source, "authenticates workspace under the previous secret",
         "A second secret cannot change workspace binding", swap(
             "aad = workspaceAad(binding);", 'aad = workspaceAad({ workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });')),
        ("skip-authentication", source, "rejects a changed tag under the previous secret",
         "Second-secret authentication must reject a changed tag", swap(
             "Buffer.concat([decipher.update(ciphertext), decipher.final()])", "Buffer.concat([decipher.update(ciphertext)])")),
        ("empty-value-lost", source, "does not return partial plaintext when neither secret authenticates",
         "Authenticated empty plaintext remains a value", swap("if (current !== null) return current;", "if (current) return current;")),
        ("foreign-envelope", consumer, "opens the exact queued translation envelope after rotation and retains its identity checks",
         "Queued credentials retain their original workspace", swap("value.workspaceId !== stored.workspaceId || ", "")),
        ("foreign-api-revision", api_consumer, "opens an existing API connection revision without changing its destination or identity",
         "An API revision cannot change its original workspace", swap("envelope.workspaceId !== stored.workspaceId || ", "")),
    ])

    def execute(label, title=None):
        result_path = out / (label + ".json")
        args = ["npm", "exec", "--", "vitest", "run", str(test.relative_to(app)), "--maxWorkers=1",
                "--no-file-parallelism", "--reporter=json", "--outputFile=" + str(result_path)]
        if title:
            args.extend(["--testNamePattern", re.escape(title)])
        result = subprocess.run(args, cwd=app, capture_output=True, text=True, timeout=60,
                                env={**os.environ, "NODE_OPTIONS": "--max-old-space-size=640"})
        (out / (label + ".log")).write_text(result.stdout + result.stderr)
        assert not re.search(r"Unhandled (?:Errors?|Rejections?)|Uncaught Exception", result.stdout + result.stderr, re.I)
        return result.returncode, json.loads(result_path.read_text())

    records = []

    def positive(label):
        code, data = execute(label)
        assert code == 0 and data["success"] and data["numPassedTests"] == 13 and data["numFailedTests"] == 0, label
        records.append({"control": label, "outcome": "survived", "cases": 13})
        print(label + " survived", flush=True)

    try:
        positive("baseline")
        source.write_bytes(original[source] + b"\n// Harmless rotation observation note.\n")
        positive("harmless")
        restore()
        positive("restored-after-harmless")
        for label, path, title, reason, edit in cases:
            restore()
            path.write_text(edit(original[path].decode()))
            code, report = execute(label, title)
            assert intended(code, report, title, reason), label + " did not fail at its intended assertion"
            records.append({"control": label, "outcome": "intended_failure", "test": title, "reason": reason})
            print(label + " intended failure", flush=True)
        restore()
        positive("restored-final")
        (out / "controls.json").write_text(json.dumps(records, indent=2) + "\n")
        (out / "source-bindings.json").write_text(json.dumps({str(path.relative_to(repo)):
            hashlib.sha256(raw).hexdigest() for path, raw in original.items()}, indent=2) + "\n")
    finally:
        restore()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve())
