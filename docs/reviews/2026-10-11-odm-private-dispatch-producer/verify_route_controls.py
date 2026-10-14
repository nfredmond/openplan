"""Probe the opt-in route ordering and its unchanged default, restoring bytes."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / "openplan"
SOURCE = APP / "src/app/api/aerial/missions/[missionId]/process/route.ts"
TEST = "src/test/aerial-process-dispatch-route.test.ts"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    out = parser.parse_args().output.resolve()
    out.mkdir(mode=0o700, parents=True, exist_ok=False)
    original = SOURCE.read_bytes()
    text = original.decode()
    rows = []

    def run(name, altered, selected=None):
        SOURCE.write_text(altered)
        report = out / (str(len(rows)) + ".json")
        command = ["node", "--max-old-space-size=512", "node_modules/vitest/vitest.mjs", "run", TEST,
                   "--maxWorkers=1", "--no-file-parallelism", "--reporter=json", "--outputFile=" + str(report)]
        if selected:
            command.extend(["-t", selected])
        result = subprocess.run(command, cwd=APP, capture_output=True, timeout=90)
        (out / (str(len(rows)) + "-private.log")).write_bytes(result.stdout + result.stderr)
        data = json.loads(report.read_text())
        failed = [test for suite in data["testResults"] for test in suite["assertionResults"] if test["status"] == "failed"]
        if selected:
            assert result.returncode == 1 and data["numFailedTests"] == 1 and len(failed) == 1, name
            assert selected in failed[0]["fullName"] and any(marker in "\n".join(failed[0]["failureMessages"]) for marker in ["AssertionError", "Error: expected", "promise resolved"]), name
        else:
            assert result.returncode == 0 and data["numPassedTests"] == 25 and not failed, name
        rows.append({"name": name, "result": "intended assertion failure" if selected else "survived", "failedTests": [test["fullName"] for test in failed]})
        print(name + ": " + rows[-1]["result"], flush=True)

    def change(name, old, new, selected):
        assert text.count(old) == 1, (name, "Unique mutation target", text.count(old))
        run(name, text.replace(old, new), selected)

    positive = "stores and reads exact original bytes before sending the same worker body"
    try:
        run("baseline", text)
        run("harmless comment", "// Harmless route control.\n" + text)
        change("omit original save", "await recordOriginalDispatch(jobsWriter, custodyScope, originalJob, dispatchText);", "// Deliberately omit original save.", positive)
        change("omit current read", "const current = await readOriginalDispatch(jobsWriter, custodyScope, originalJob, dispatchText);", "const current = { authorizedNow: true };", "refuses an uncertain current read")
        change("ignore revoked scope", "if (!current.authorizedNow)", "if (false)", "refuses a revoked current scope")
        change("stop waiting for custody", "await recordOriginalDispatch(jobsWriter, custodyScope, originalJob, dispatchText);", "void recordOriginalDispatch(jobsWriter, custodyScope, originalJob, dispatchText);", "waits for the storage receipt")
        change("rewrite worker body", "body: dispatchText,", 'body: JSON.stringify({ ...processingRequest, missionTitle: "changed after storage" }),', positive)
        change("omit manifest original save", "await recordOriginalDispatch(jobsWriter, custodyScope, originalJob, dispatchText);", "// Deliberately omit manifest save.", "saves original signed photo URLs privately")
        change("enable default custody", "if (custodyScope) {", 'if (custodyScope || (custodyScope = { installationId: "installation-local-1", targetId: "database-local-1" })) {', "keeps the default external dispatch independent")
        change("ignore incomplete configuration", "custodyScope = resolveDispatchCustodyScope();", "custodyScope = null;", "refuses incomplete settings before inserting")
        change("lose failure writeback", 'audit.error("original_dispatch_custody_unavailable", { requestId, missionId: mission.id });\n        await markDispatchFailed(detail);', 'audit.error("original_dispatch_custody_unavailable", { requestId, missionId: mission.id });', "records a dispatch failure and refuses external work")
        change("forward another actor", "mission_id: mission.id, created_by: user.id,", "mission_id: mission.id, created_by: mission.workspace_id,", positive)
        for label, old, new in [
            ("mission projection", '.select("id, workspace_id, project_id, title")', '.select("id")'),
            ("insert projection", '.select("id")\n      .single();', '.select("request_id")\n      .single();'),
        ]:
            change(label, old, new, positive)
        assert text.count('.select("role")') == 2
        prefix, post = text.split("export async function POST", 1)
        assert post.count('.select("role")') == 1
        run("POST membership projection", prefix + "export async function POST" + post.replace('.select("role")', '.select("user_id")'), positive)
        run("restored", text)
    finally:
        SOURCE.write_bytes(original)
        assert SOURCE.read_bytes() == original
        (out / "controls.json").write_text(json.dumps({"sourceSha256": hashlib.sha256(original).hexdigest(), "controls": rows,
            "scope": "Real route and helper with simulated database and worker replies. No live authentication, SQL, worker transport, browser or atomic external revocation acceptance."}, indent=2) + "\n")


if __name__ == "__main__":
    main()
