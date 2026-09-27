"""Check browser recovery failures without changing the server or native suite under test."""
from pathlib import Path
import hashlib
import json
import subprocess
import tempfile
from datetime import datetime, timezone

review = Path(__file__).resolve().parent
repo = review.parents[2]
app = repo / "openplan"
source = app / "src/lib/engagement/synthesis-approval-recovery.ts"
original = source.read_bytes()
cases = [("baseline", "", "", None), ("harmless-comment", "/** Incomplete reason text", "/** Incomplete staff reason text", None)]
def fault(name, before, after, assertion):
    cases.append((name, before, after, assertion))

for field in ["userId", "workspaceId", "campaignId", "sourceId", "reviewId"]:
    fault("key-omits-" + field, ':${scope.' + field + '}', '', "keeps " + field + " recovery in a separate storage key")
for field in ["sourceSha256", "preparationSha256"]:
    fault("read-ignores-" + field,
          'value[field as keyof ApprovalClientScope] === scope[field as keyof ApprovalClientScope]',
          f'field === "{field}" || value[field as keyof ApprovalClientScope] === scope[field as keyof ApprovalClientScope]',
          "refuses a saved copy with changed " + field)
for field in ["actorId", "workspaceId", "campaignId", "sourceId", "reviewId", "sourceSha256", "preparationSha256"]:
    other = "userId" if field == "actorId" else field
    fault("command-omits-" + field, f"intent.{field} !== value.{other}", "false", "refuses a pending command that changes " + field)
for field in ["revisionId", "revisionNo", "revisionSha256", "operation", "reason"]:
    fault("draft-omits-" + field, f"intent.{field} !== draft.{field}", "false", "refuses a pending command that changes " + field)
fault("accept-future-copy", "version: z.literal(1)", "version: z.number()", "refuses malformed copies")
fault("overwrite-stale-tab", "!same(readApprovalWorkingCopy(storage, previous), previous)", "false", "refuses stale tab edits")
fault("cross-scope-write", "!matches(parsed, previous)", "false", "refuses stale tab edits")
fault("replace-pending", 'previous.pending && !(confirmed && next.pending === null) && !same(previous.pending, next.pending)', "false", "does not replace or clear an unconfirmed pending command")
fault("refreeze-pending", 'if (working.pending) throw new Error("An approval request is already pending");', "", "does not replace or clear an unconfirmed pending command")
fault("skip-write-readback", "storage.getItem(key(previous)) !== raw", "false", "requires working storage and exact readback")
fault("skip-retention-before-send", "const retained = writeApprovalWorkingCopy(storage, working, working), intent = retained.pending!;", "const retained = working, intent = retained.pending!;", "requires working storage and exact readback")
fault("send-without-command", '!working.pending || !same(readApprovalWorkingCopy(storage, working), working)', "false", "refuses transport when no command is pending")
fault("wrong-bound-header", '"x-openplan-expected-user": working.userId', '"x-openplan-expected-user": working.workspaceId', "sends exact bound bytes")
fault("rewrite-request", "body: JSON.stringify(intent)", "body: JSON.stringify({ ...intent, requestId: crypto.randomUUID() })", "sends exact bound bytes")
fault("allow-cache", 'cache: "no-store"', 'cache: "default"', "sends exact bound bytes")
fault("ignore-http-failure", "if (!response.ok)", "if (false)", "retains an unconfirmed command after HTTP 403")
fault("trust-unchecked-receipt", "const receipt = await readSynthesisApprovalReceipt(await response.json(), intent);", "const receipt = await response.json();", "rejects a forged or corrupt acknowledgement")
fault("never-clear-confirmed", 'next = writeCopy(storage, retained, { ...retained, draft: null, pending: null }, true);', 'next = retained;', "sends exact bound bytes")
fault("cleanup-undoes-confirmation", 'cleanupError = "Approval saved. Browser cleanup failed; retrying the retained request will recover the same save.";', 'throw new Error("Synthetic cleanup failure");', "keeps a confirmed save true when cleanup fails")
fault("lose-latest-unsaved-text", 'latest?.draft || latest?.pending ? JSON.stringify(latest) : null', 'null', "preserves unreadable bytes and newer unsaved text")
fault("archive-foreign-scope", 'latest && !matches(workingSchema.parse(latest), scope)', 'false', "refuses to archive the latest text from another account")
fault("archive-without-readback", 'storage.getItem(archive) !== copy', 'false', "does not discard active recovery when archiving")
fault("archive-ignores-new-tab", 'storage.getItem(currentKey) !== raw', 'false', "does not discard active recovery when archiving")
fault("ignore-failed-removal", 'storage.getItem(currentKey) !== null', 'false', "reports when the active copy could not be moved aside")
fault("list-other-account-copies", '!name?.startsWith(prefix)', '!name', "preserves unreadable bytes and newer unsaved text")

results = []
try:
    with tempfile.TemporaryDirectory(prefix="openplan-approval-recovery-proof-") as scratch:
        for name, before, after, assertion in cases:
            value = original.decode()
            if before:
                assert value.count(before) == 1, (name, value.count(before))
                value = value.replace(before, after, 1)
            source.write_text(value)
            output = Path(scratch) / "result.json"
            output.unlink(missing_ok=True)
            run = subprocess.run(["node_modules/.bin/vitest", "run", "src/test/engagement-synthesis-approval-recovery.test.ts", "--reporter=json", "--outputFile=" + str(output)], cwd=app, capture_output=True, text=True, timeout=60)
            report = json.loads(output.read_text())
            failures = [{"name": test["fullName"], "messages": test["failureMessages"]} for suite in report["testResults"] for test in suite["assertionResults"] if test["status"] == "failed"]
            expected = (run.returncode == 0 and report["numPassedTests"] == 37 and report["numFailedTests"] == 0) if assertion is None else (run.returncode != 0 and any(assertion in test["name"] for test in failures))
            results.append({"case": name, "expected": "survives" if assertion is None else "fails", "expectedOutcome": bool(expected), "exit": run.returncode,
                "passed": report["numPassedTests"], "failed": report["numFailedTests"], "failedAssertions": failures})
            print(name, "expected" if expected else "UNEXPECTED", flush=True)
            if not expected:
                raise AssertionError((name, failures, run.stdout[-1000:], run.stderr[-1000:]))
finally:
    source.write_bytes(original)
    (review / "recovery-mutations.json").write_text(json.dumps({"recordedAt": datetime.now(timezone.utc).isoformat(), "cases": results,
        "sourceRestored": source.read_bytes() == original, "sourceSha256": hashlib.sha256(original).hexdigest(),
        "blindCategories": ["In-memory storage and mocked fetch do not prove browser persistence, HTTP authentication or native custody.",
            "Browser storage comparisons are not a cross-tab transaction; the server still fences request identity and both retained heads.",
            "No UI reachability, focus revalidation, keyboard use or screen layout is established."]}, indent=2) + "\n")
