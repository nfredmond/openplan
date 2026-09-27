"""Challenge retained-context checks. This does not exercise a writer or database."""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import subprocess
import tempfile

review = Path(__file__).resolve().parent
root = review.parents[2]
app = root / "openplan"
source = app / "src/lib/engagement/synthesis-response-context-server.ts"
tests = app / "src/test/engagement-synthesis-response-context.test.ts"
original = source.read_text()
cases = [
    ("baseline", "", "", None),
    ("harmless-comment", "const uuid =", "// Harmless context-reader control.\nconst uuid =", None),
    ("invalid-text", 'if (!text.isWellFormed() || text.includes("\\0"))', "if (false)", "rejects changed outer bytes"),
    ("context-digest", 'checkHash(packet.contextText, packet.contextSha256, "Synthesis response context");', "", "rejects changed outer bytes"),
    ("source-text", 'checkHash(source.snapshotText, source.snapshotSha256, "Retained source");', "", "rejects invalid Unicode in retained source bytes"),
    ("source-binding", "source.snapshotSha256 !== context.sourceSha256", "false", "rejects source binding"),
    ("preparation-digest", 'checkHash(context.preparationText, context.preparationSha256, "Retained preparation");', "", "rejects preparation bytes"),
    ("preparation-derivation", "!isDeepStrictEqual(JSON.parse(context.preparationText), preparation)", "false", "rejects preparation derivation"),
    ("review-digest", 'checkHash(context.revision.contentText, context.revision.contentSha256, "Retained review");', "", "rejects review bytes"),
    ("review-coverage", "verifySynthesisReviewContent(JSON.parse(context.revision.contentText), source.snapshot, source.snapshotSha256)", "JSON.parse(context.revision.contentText)", "rejects a rehashed review that silently drops coverage"),
    ("approval-operation", 'approval.intent.operation !== "approve"', "false", "rejects withdrawal events"),
    ("group-selection", 'if (!group) throw new Error("Synthesis response group is unavailable");', "", "rejects group"),
    ("response-digest", 'checkHash(history.recordText, history.record_sha256, "Retained response");', "", "rejects response bytes"),
    ("removed-history", 'history.event === "removed"', "false", "rejects removed history"),
    ("private-purpose", 'purpose: z.literal("reviewed_synthesis_response")', 'purpose: z.string()', "rejects changed outer bytes"),
    ("private-visibility", 'visibility: z.literal("private")', 'visibility: z.string()', "rejects changed outer bytes"),
    ("context-version", 'schemaVersion: z.literal(1)', 'schemaVersion: z.number()', "rejects changed outer bytes"),
    ("complete-membership", "return { packet, context, source, preparation, content, approval, group, response };", "group.sourceIds = group.sourceIds.slice(0, 300);\n  return { packet, context, source, preparation, content, approval, group, response };", "retains all 301 comments"),
    ("answer-membership", "return { packet, context, source, preparation, content, approval, group, response };", 'group.sourceIds = group.sourceIds.filter(id => !id.startsWith("answer:"));\n  return { packet, context, source, preparation, content, approval, group, response };', "retains answer-only groups"),
    ("complete-wording", "return { packet, context, source, preparation, content, approval, group, response };", "group.summary = group.summary.slice(0, 1000);\n  return { packet, context, source, preparation, content, approval, group, response };", "preserves overlap, unassigned input and full Unicode"),
    ("source-verifier-call", """const source = verifySynthesisSource(context.source, {
    campaignId: scope.campaignId, workspaceId: scope.workspaceId, requestId: context.sourceId,
  });""", """const rawSource = context.source as { snapshotText: string; snapshotSha256: string };
  const source = { ...rawSource, snapshot: JSON.parse(rawSource.snapshotText) };""", "rejects rehashed source private metadata"),
    ("approval-verifier-call", """const approval = await readSynthesisApprovalEvent(context.approval, {
    campaignId: scope.campaignId, workspaceId: scope.workspaceId, reviewId: scope.reviewId,
    sourceId: context.sourceId, sourceSha256: context.sourceSha256, preparationSha256: context.preparationSha256,
  });""", "const approval = JSON.parse(context.approval.eventText);", "rejects approval bytes"),
]
for field in ["campaignId", "workspaceId", "reviewId", "responseId"]:
    cases.append((f"scope-{field}", f"context.{field} !== scope.{field}", "false", f"rejects different expected {field}"))
for field, compared in [("revisionId", "id"), ("revisionNo", "number"), ("revisionSha256", "contentSha256")]:
    cases.append((f"approval-{field}", f"approval.intent.{field} !== context.revision.{compared}", "false", f"rejects approval of different {field}"))
for field, compared in [("campaign_id", "campaignId"), ("response_id", "responseId")]:
    cases.append((f"history-{field}", f"history.{field} !== scope.{compared}", "false", "rejects history campaign" if field == "campaign_id" else "rejects history response"))
for field, compared in [("id", "responseId"), ("campaign_id", "campaignId")]:
    cases.append((f"record-{field}", f"response.{field} !== scope.{compared}", "false", f"rejects a rehashed response with foreign {field}"))

results = []
try:
    with tempfile.TemporaryDirectory(prefix="openplan-synthesis-response-context-") as tmp:
        for name, before, after, assertion in cases:
            source.write_text(original)
            if before:
                assert original.count(before) == 1, (name, original.count(before))
                source.write_text(original.replace(before, after))
            output = Path(tmp) / "results.json"
            output.unlink(missing_ok=True)
            run = subprocess.run(["node_modules/.bin/vitest", "run", str(tests.relative_to(app)),
                                  "--reporter=json", "--outputFile=" + str(output)], cwd=app,
                                 capture_output=True, text=True, timeout=60)
            data = json.loads(output.read_text())
            failures = [{"name": item["fullName"], "messages": item.get("failureMessages", [])}
                        for suite in data["testResults"] for item in suite["assertionResults"] if item["status"] == "failed"]
            expected = (run.returncode == 0 and data["numPassedTests"] > 0 and not failures) if assertion is None else (
                run.returncode != 0 and any(assertion in item["name"] for item in failures))
            results.append({"case": name, "exit": run.returncode, "passedTests": data["numPassedTests"],
                            "failures": [item["name"] for item in failures], "expectedOutcome": expected})
            print(name, expected, flush=True)
            assert expected, (name, failures, run.stdout[-1000:], run.stderr[-1000:])
finally:
    source.write_text(original)
    (review / "context-mutations.json").write_text(json.dumps({
        "recordedAt": datetime.now(timezone.utc).isoformat(), "cases": results,
        "sourcesRestored": source.read_text() == original,
        "sources": {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in [source, tests]},
        "limits": "Protocol byte, scope and coverage checks only. Some scope checks overlap. Does not prove authentication, saved review lineage, current approval, native locks, public withdrawal, browser behavior or report usability.",
    }, indent=2) + "\n")
