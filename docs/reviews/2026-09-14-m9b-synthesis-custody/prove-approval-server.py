"""Exercise approval server boundaries with actual loaders, restoring exact source bytes."""
from pathlib import Path
import hashlib
import json
import subprocess
import tempfile

review = Path(__file__).resolve().parent
repo = review.parents[2]
app = repo / "openplan"
server = app / "src/lib/engagement/synthesis-approval-server.ts"
protocol = app / "src/lib/engagement/synthesis-approval.ts"
loader = app / "src/lib/engagement/synthesis-review-server.ts"
originals = {path: path.read_bytes() for path in [server, protocol, loader]}
tests = ["src/test/engagement-synthesis-approval-server.test.ts", "src/test/engagement-synthesis-approval.test.ts", "src/test/engagement-synthesis-review-server.test.ts"]
cases = [("baseline", server, "", "", None), ("harmless-comment", server, "/** Verify the current review once", "/** Confirm the current review once", None)]

def fault(name, before, after, assertion, path=server):
    cases.append((name, path, before, after, assertion))

for field in ["actorId", "workspaceId", "campaignId"]:
    fault("unbound-" + field, f"intent.{field} !== actor.{field}", "false", "binds authenticated " + field)
fault("unvalidated-command", "synthesisApprovalIntentSchema.safeParse(raw)", "({ success: true, data: raw as SynthesisApprovalIntent })", "rejects invalid commands before a database call")
fault("unbound-historical-revision-id", "revisions.get(event.intent.revisionId)", "[...revisions.values()].find(row => row.revisionNo === event.intent.revisionNo)", "refuses rehashed historical revisionId")
fault("unbound-historical-revision-number", "revision.revisionNo !== event.intent.revisionNo", "false", "refuses rehashed historical revisionNo")
fault("unbound-historical-revision-sha", "revision.contentSha256 !== event.intent.revisionSha256", "false", "refuses rehashed historical revisionSha256")
fault("no-exact-recovery-first", "const existing = await recover();\n  if (existing) return existing;", "// Synthetic missing initial recovery.", "recovers an exact old acknowledgement")
fault("no-recovery-after-history-race", 'error instanceof SynthesisApprovalError && error.kind === "conflict"', "false", "recovers the exact event when newer approval history")
fault("no-recovery-after-head-race", '  } catch {\n    const raced = await recover();\n    if (raced) return raced;', '  } catch {\n    // Synthetic missing head-race recovery.', "recovers when a peer commits the same request")
fault("no-native-503-recovery", 'result.error.code === "PT409" || result.error.code === "PT503"', 'result.error.code === "PT409"', "recovers an exact committed request after native PT503")
fault("no-native-409-recovery", 'result.error.code === "PT409" || result.error.code === "PT503"', 'result.error.code === "PT503"', "recovers an exact committed request after native PT409")
fault("failed-lookup-means-absence", 'if (result.error) throw databaseError(result.error.code);\n  if (result.data === null) return null;', 'if (result.error) return null;\n  if (result.data === null) return null;', "refuses failed request lookup 42501")
fault("missing-history-means-absence", 'if (result.data === null) throw new SynthesisApprovalError("conflict", "Saved approval history is unavailable");', 'if (result.data === null) return null;', "does not turn missing or failed history into an empty approval state")
fault("unbound-request-id", "event.intent.requestId !== request", "false", "rejects a different returned request")
fault("unchecked-sequence", 'receipt.event.eventNo !== (state!.history.head?.eventNo ?? 0) + 1', "false", "rejects a different returned request")
fault("unchecked-native-receipt-intent", 'readSynthesisApprovalReceipt(result.data, intent)', 'readSynthesisApprovalReceipt(result.data, JSON.parse(result.data.event.eventText).intent)', "rejects a different returned request")
fault("wrong-writer-actor", 'p_campaign: actor.campaignId, p_actor: actor.actorId, p_workspace:', 'p_campaign: actor.campaignId, p_actor: actor.workspaceId, p_workspace:', "sends only the exact bound command")
fault("unchecked-stale-head", "checkSynthesisApprovalIntent(intent, state.current, state.history.head);", "// Synthetic missing current-state check.", "refuses stale revision or history heads")
fault("forbidden-becomes-unavailable", 'code === "42501" ? "forbidden"', 'code === "42501" ? "unavailable"', "preserves native writer failure 42501")
fault("conflict-becomes-unavailable", 'code === "PT409" ? "conflict"', 'code === "PT409" ? "unavailable"', "preserves native writer failure PT409")
fault("invalid-becomes-unavailable", 'code === "22023" ? "invalid"', 'code === "22023" ? "unavailable"', "preserves native writer failure 22023")
fault("absent-verified-revision-callback", 'onVerifiedRevision?.({ requestId: record.revision.requestId, revisionNo: record.revision.revisionNo, contentSha256: record.revision.contentSha256 });', '// Synthetic absent verified-revision callback.', "verifies every historical approval", loader)
fault("unchecked-review-command-content", '!isDeepStrictEqual(retained, content)', 'false', "never approves a corrupted review", loader)
fault("scope-conflict-loses-type", 'new SynthesisApprovalConflictError("Approval source or review scope differs")', 'new Error("Approval source or review scope differs")', "refuses changed retries as conflicts", protocol)
fault("receipt-conflict-loses-type", 'new SynthesisApprovalConflictError("Approval receipt does not match the exact request")', 'new Error("Approval receipt does not match the exact request")', "refuses changed retries as conflicts", protocol)

results = []
try:
    with tempfile.TemporaryDirectory(prefix="openplan-approval-server-proof-") as scratch:
        for name, path, before, after, assertion in cases:
            for file, raw in originals.items():
                file.write_bytes(raw)
            value = path.read_text()
            if before:
                assert value.count(before) == 1, (name, value.count(before))
                path.write_text(value.replace(before, after, 1))
            output = Path(scratch) / "result.json"
            output.unlink(missing_ok=True)
            run = subprocess.run(["node_modules/.bin/vitest", "run", *tests, "--reporter=json", "--outputFile=" + str(output)], cwd=app, capture_output=True, text=True, timeout=60)
            report = json.loads(output.read_text())
            failures = [{"name": test["fullName"], "messages": test["failureMessages"]} for suite in report["testResults"] for test in suite["assertionResults"] if test["status"] == "failed"]
            expected = (run.returncode == 0 and report["numPassedTests"] == 65 and report["numFailedTests"] == 0) if assertion is None else (run.returncode != 0 and any(assertion in test["name"] for test in failures))
            results.append({"case": name, "expected": "survives" if assertion is None else "fails", "exit": run.returncode,
                "passed": report["numPassedTests"], "failed": report["numFailedTests"], "failedAssertions": failures, "expectedOutcome": bool(expected)})
            print(name, "expected" if expected else "UNEXPECTED", flush=True)
            if not expected:
                raise AssertionError((name, failures, run.stdout[-1500:], run.stderr[-1500:]))
finally:
    for path, raw in originals.items():
        path.write_bytes(raw)
    (review / "approval-server-mutations.json").write_text(json.dumps({"cases": results,
        "sourcesRestored": all(path.read_bytes() == raw for path, raw in originals.items()),
        "sourceSha256": {str(path.relative_to(repo)): hashlib.sha256(raw).hexdigest() for path, raw in originals.items()},
        "blindCategories": [
            "RPC transport is mocked; these cases cannot establish native permissions, locking, durable writes or HTTP routes.",
            "The real TypeScript review and source loaders run, but a coherently forged authoritative database can evade client checks.",
            "No browser control, storage recovery, keyboard access or human usefulness is established."
        ]}, indent=2) + "\n")
