"""Check helper failures against selected behavior, then restore exact bytes."""
import argparse
import hashlib
import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / "openplan"
SOURCE = APP / "src/lib/aerial/original-dispatch.ts"
TEST = "src/test/aerial-original-dispatch.test.ts"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(mode=0o700, parents=True, exist_ok=False)
    original = SOURCE.read_bytes()
    text = original.decode()
    rows = []

    def run(name, altered, selection=None, expected_failures=0, category="behavior"):
        SOURCE.write_text(altered)
        number = len(rows)
        report = out / f"{number:02d}.json"
        command = ["node", "--max-old-space-size=512", "node_modules/vitest/vitest.mjs", "run", TEST,
                   "--maxWorkers=1", "--no-file-parallelism", "--reporter=json", "--outputFile=" + str(report)]
        if selection:
            command.extend(["-t", selection])
        result = subprocess.run(command, cwd=APP, capture_output=True, timeout=90)
        (out / f"{number:02d}.stdout.log").write_bytes(result.stdout)
        (out / f"{number:02d}.stderr.log").write_bytes(result.stderr)
        data = json.loads(report.read_text())
        failed = [test for suite in data["testResults"] for test in suite["assertionResults"] if test["status"] == "failed"]
        if expected_failures:
            assert result.returncode == 1 and data["numFailedTests"] == expected_failures, (name, result.returncode, data["numFailedTests"])
            assert len(failed) == expected_failures and all(selection in item["fullName"] for item in failed), name
            assert all(any(marker in "\n".join(item["failureMessages"]) for marker in ["AssertionError", "Error: expected", "promise resolved"]) for item in failed), name
        else:
            assert result.returncode == 0 and data["numPassedTests"] >= 30 and not failed, name
        rows.append({"name": name, "category": category, "result": "intended assertion failure" if expected_failures else "survived",
                     "failedTests": [item["fullName"] for item in failed], "passedTests": data["numPassedTests"]})
        print(name + ": " + rows[-1]["result"], flush=True)

    def change(name, old, new, selected, failures=1, category="behavior"):
        assert text.count(old) == 1, (name, "unique mutation target", text.count(old))
        run(name, text.replace(old, new), selected, failures, category)

    try:
        run("baseline", text)
        run("harmless comment", "// Harmless custody control.\n" + text)
        change("enable by default", 'if (!flag || flag === "0") return null;', 'if (!flag) return { installationId: "installation-local-1", targetId: "database-local-1" }; if (flag === "0") return null;', "defaults to disabled")
        change("accept unknown enable flag", 'if (flag !== "1") throw new Error("Aerial dispatch custody setting is invalid");', '// Deliberately allow an unknown flag.', "defaults to disabled")
        change("substitute missing installation", 'environment.OPENPLAN_AERIAL_DISPATCH_INSTALLATION_ID?.trim()', 'environment.OPENPLAN_AERIAL_DISPATCH_INSTALLATION_ID?.trim() ?? "installation-local-1"', "defaults to disabled")
        change("substitute missing target", 'environment.OPENPLAN_AERIAL_DISPATCH_TARGET_ID?.trim()', 'environment.OPENPLAN_AERIAL_DISPATCH_TARGET_ID?.trim() ?? "database-local-1"', "defaults to disabled")
        change("omit byte bound", 'if (bytes < 1 || bytes > MAX_PAYLOAD_BYTES)', 'if (false)', "refuses unbounded text")
        change("forward wrong actor", 'p_actor: job.created_by', 'p_actor: job.workspace_id', "records exact UTF-8")
        change("forward altered wire text", 'p_payload_text: payloadText', 'p_payload_text: payloadText.trim()', "records exact UTF-8")
        change("wrong record RPC", 'client.rpc("record_aerial_original_dispatch"', 'client.rpc("different_record"', "records exact UTF-8")
        change("wrong read RPC", 'client.rpc("read_aerial_original_dispatch"', 'client.rpc("different_read"', "returns current scope observation", 2)
        for field, expression in [
            ("requestId", "value.requestId !== job.request_id"), ("system", 'value.externalRef.system !== "openplan"'),
            ("workspaceId", "value.externalRef.workspaceId !== job.workspace_id"),
            ("missionId", "value.externalRef.missionId !== job.mission_id"),
            ("projectId", "(value.externalRef.projectId ?? null) !== job.project_id"),
            ("presetId", '(value.presetId ?? "balanced") !== job.preset_id'),
        ]:
            change("omit payload " + field, expression, "false", "refuses a changed payload " + field)
        for field in ["id", "request_id", "workspace_id", "project_id", "mission_id", "created_by", "preset_id", "imagery_type"]:
            change("omit receipt job " + field, "Object.keys(job).some(", f'Object.keys(job).filter((key) => key !== "{field}").some(', "refuses changed receipt job field " + field)
        change("omit payload imagery kind", "value.imagery.type !== job.imagery_type", "false", "refuses a valid manifest under an original ZIP job")
        change("rewrite manifest receipt", "return receipt;", "return { ...receipt, payloadText: payloadText.trim() };", "preserves a complete v1.1 photo manifest")
        change("replace nullable project", "return receipt;", 'return { ...receipt, applicationJob: { ...receipt.applicationJob, project_id: "ffffffff-ffff-4fff-8fff-ffffffffffff" } };', "preserves an explicitly nullable project")
        for field, expression in [("installationId", "receipt.installationId !== scope.installationId"),
                                  ("targetId", "receipt.targetId !== scope.targetId")]:
            change("omit receipt " + field, expression, "false", "refuses changed receipt " + field)
        for field, expression in [("payloadText", "receipt.payloadText !== payloadText"),
                                  ("payloadBytes", 'receipt.payloadBytes !== Buffer.byteLength(payloadText, "utf8")'),
                                  ("payloadSha256", 'receipt.payloadSha256 !== createHash("sha256").update(payloadText, "utf8").digest("hex")')]:
            change("omit receipt " + field, expression, "false", "refuses changed receipt " + field)
        change("promote transport permission", "engineTransportPermission: z.literal(false)", "engineTransportPermission: z.boolean()", "refuses absent, oversized")
        change("accept unknown receipt fields", 'engineTransportPermission: z.literal(false),\n}).strict();', 'engineTransportPermission: z.literal(false),\n});', "refuses absent, oversized")
        change("omit contract check", 'if (!request.success) throw new Error("Original aerial dispatch contract differs");', '// Deliberately ignore failed validation.', "refuses malformed and wrong-version", category="diagnostic refusal with independent backstop")
        change("lose static provider refusal", 'if (error) throw new Error("Original aerial dispatch custody is unavailable");\n  return validateReceipt', '// Deliberately infer success from a missing reply.\n  return validateReceipt', "keeps provider diagnostics", category="diagnostic refusal with independent backstop")
        change("lose static read refusal", 'if (error) throw new Error("Original aerial dispatch custody is unavailable");\n  const observed', '// Deliberately infer a current read.\n  const observed', "keeps provider diagnostics", category="diagnostic refusal with independent backstop")
        for operation in ["record", "read"]:
            start = text.index('client.rpc("' + operation + '_aerial_original_dispatch"')
            end = text.index(";", start) + 1
            block = text[start:end]
            catch = ".catch(() => ({ data: null, error: true }))"
            assert block.count(catch) == 1
            change("lose " + operation + " transport refusal", block, block.replace(catch, ""), "keeps thrown transport diagnostics private")
        change("fabricate authorized observation", 'authorizedNow: z.boolean()', 'authorizedNow: z.coerce.boolean()', "requires a typed current observation")
        change("substitute receipt for current observation", 'authorityObservedAt: z.string().datetime({ offset: true })', 'authorityObservedAt: z.string()', "requires a typed current observation")
        run("restored", text)
    finally:
        SOURCE.write_bytes(original)
        assert SOURCE.read_bytes() == original, "Exact helper restoration"
        (out / "controls.json").write_text(json.dumps({"sourceSha256": hashlib.sha256(original).hexdigest(), "controls": rows,
            "scope": "Focused TypeScript helper and simulated RPC replies. No database, live transport, route, caller authorship or engine authorization proof."}, indent=2) + "\n")


if __name__ == "__main__":
    main()
