"""Fault the application loader and extracted history verifier, restoring every file."""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import subprocess
import tempfile

review = Path(__file__).resolve().parent
root = review.parents[2]
app = root / "openplan"
loader = app / "src/lib/engagement/synthesis-response-links-server.ts"
history = app / "src/lib/engagement/response-history-server.ts"
approval = app / "src/lib/engagement/synthesis-approval-server.ts"
original = {p: p.read_text() for p in [loader, history, approval]}
tests = ["src/test/engagement-synthesis-response-loader.test.ts", "src/test/engagement-response-history.test.ts"]
cases = [
    ("baseline", loader, "", "", None),
    ("harmless-comment", loader, "const uuid =", "// Harmless loader control.\nconst uuid =", None),
    ("invalid-address", loader, "if (!parsed.success)", "if (false)", "refuses malformed or expanded addresses"),
    ("missing-review", loader, 'if (!state) throw new SynthesisResponseLinkError("conflict", "The saved review is unavailable");', "", "refuses missing reviews"),
    ("approval-absence", loader, "!approval ||", "false ||", "refuses absent approval"),
    ("approval-withdrawn", loader, 'approval.intent.operation !== "approve"', "false", "refuses withdrawn approval"),
    ("approval-current", loader, "approval.intent.revisionId !== current.revisionId", "false", "verifies corrected review lineage"),
    ("observed-review-head", loader, "review.currentRevisionId !== review.revision.requestId", "false", "refuses an inconsistent observed current revision"),
    ("selected-group", loader, 'if (!review.content.groups.some(group => group.id === groupId)) throw new SynthesisResponseLinkError("conflict", "The selected review group is unavailable");', "", "refuses missing reviews, groups"),
    ("response-read-error", loader, "if (result.error)", "if (false)", "refuses a failed response read even when it carries a valid earlier payload"),
    ("response-history-completeness", loader, "readResponseHistorySnapshot(result.data, scope.campaignId)", "({ records: result.data.entries })", "rejects corrupt or incomplete history"),
    ("response-latest", loader, "responseHistory.records.findLast", "responseHistory.records.find", "selects the latest response version"),
    ("response-identity", loader, "row.response_id === scope.responseId", "true", "selects the latest response version"),
    ("response-removed", loader, 'latest.event === "removed"', "false", "selects the latest response version"),
    ("response-missing", loader, "!latest ||", "false ||", "refuses missing reviews, groups and response rows"),
    ("response-original-bytes", loader, "const { record_text: recordText, ...metadata } = latest;", "const { record_text: oldText, ...metadata } = latest;\n    const recordText = JSON.stringify(JSON.parse(oldText));", "uses one complete verified review read"),
    ("verified-review-reuse", approval, "return { current, history, packet, review };", "return { current, history, packet };", "uses one complete verified review read"),
    ("snapshot-envelope", history, "snapshot.campaignId !== campaignId", "false", "rejects all rows on foreign envelope"),
    ("snapshot-count", history, "snapshot.count !== snapshot.entries.length", "false", "rejects all rows on count mismatch"),
    ("history-campaign", history, "entry.campaign_id !== campaignId", "false", "rejects all rows on foreign row"),
    ("history-duplicate", history, "ids.has(entry.id)", "false", "rejects all rows on duplicate identity with valid revisions"),
    ("history-sequence", history, "entry.revision !== (revisions.get(entry.response_id) ?? 0) + 1", "false", "rejects all rows on revision gap"),
    ("history-terminal", history, "removed.has(entry.response_id)", "false", "rejects all rows on identity reused after removal"),
    ("history-digest", history, 'createHash("sha256").update(record_text, "utf8").digest("hex") !== entry.record_sha256', "false", "rejects all rows on checksum corruption"),
    ("history-record-response", history, "record.id !== entry.response_id", "false", "rejects all rows on foreign retained response"),
    ("history-record-campaign", history, "record.campaign_id !== campaignId", "false", "rejects all rows on foreign retained campaign"),
    ("history-baseline", history, 'entry.revision === 1 ? !["created", "legacy_baseline"].includes(entry.event) : ["created", "legacy_baseline"].includes(entry.event)', "false", "rejects all rows on wrong initial event"),
    ("history-stored-text", history, "records: snapshot.entries", "records: snapshot.entries.map(row => ({ ...row, record_text: JSON.stringify(JSON.parse(row.record_text)) }))", "preserves stored text for evidence"),
    ("history-existing-contract", history, "return { rows: readResponseHistorySnapshot(result.data, campaignId).rows, error: null };", "return { ...readResponseHistorySnapshot(result.data, campaignId), error: null };", "preserves stored text for evidence"),
    ("history-error-with-data", history, 'if (result.error) throw new Error("History read failed");', "", "refuses stale valid rows returned alongside a database error"),
]

results = []
try:
    with tempfile.TemporaryDirectory(prefix="openplan-synthesis-response-loader-") as tmp:
        for name, target, before, after, assertion in cases:
            for p, text in original.items():
                p.write_text(text)
            if before:
                assert original[target].count(before) == 1, (name, original[target].count(before))
                target.write_text(original[target].replace(before, after))
            output = Path(tmp) / "result.json"
            output.unlink(missing_ok=True)
            run = subprocess.run(["node_modules/.bin/vitest", "run", *tests, "--reporter=json", "--outputFile=" + str(output)],
                                 cwd=app, capture_output=True, text=True, timeout=60)
            data = json.loads(output.read_text())
            failures = [{"name": t["fullName"], "messages": t.get("failureMessages", [])}
                        for f in data["testResults"] for t in f["assertionResults"] if t["status"] == "failed"]
            expected = (run.returncode == 0 and data["numPassedTests"] > 0 and not failures) if assertion is None else (
                run.returncode != 0 and any(assertion in t["name"] for t in failures))
            results.append({"case": name, "exit": run.returncode, "passedTests": data["numPassedTests"],
                            "failures": [t["name"] for t in failures], "expectedOutcome": expected})
            print(name, expected, flush=True)
            assert expected, (name, failures, run.stdout[-500:], run.stderr[-500:])
finally:
    for p, text in original.items():
        p.write_text(text)
    (review / "loader-mutations.json").write_text(json.dumps({
        "recordedAt": datetime.now(timezone.utc).isoformat(), "cases": results,
        "sourcesRestored": all(p.read_text() == text for p, text in original.items()),
        "sources": {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in [*original, *(app / t for t in tests)]},
        "limits": "Application logic and preserved history contract only. Some nested scope checks overlap. Native access, transaction locks, races, HTTP authorization and browser behavior require separate checks.",
    }, indent=2) + "\n")
