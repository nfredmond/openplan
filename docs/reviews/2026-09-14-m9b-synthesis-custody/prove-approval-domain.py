"""Mutate only the new approval protocol, restore exact bytes, and require named assertion failures."""
from pathlib import Path
import hashlib
import json
import subprocess
import tempfile

review = Path(__file__).resolve().parent
repo = review.parents[2]
app = repo / "openplan"
source = app / "src/lib/engagement/synthesis-approval.ts"
original = source.read_bytes()
cases = [("baseline", "", "", None), ("harmless-comment", "/** Verify retained bytes", "/** Confirm retained bytes", None)]


def fault(name, before, after, assertion):
    cases.append((name, before, after, assertion))


fault("approval-carries-to-correction", "row.intent.revisionId === revision.revisionId", "true", "keeps later corrections unapproved")
fault("skip-current-version-check", "if (!sameRevision(intent, current))", "if (false)", "binds approval to the exact revision")
fault("skip-revision-id", "left.revisionId === right.revisionId && ", "", "rejects changed approval revisionId")
fault("skip-revision-sha", "left.revisionSha256 === right.revisionSha256 && ", "", "rejects changed approval revisionSha256")
fault("skip-revision-number", "&& left.revisionNo === right.revisionNo", "", "rejects changed approval revisionNo")
for field in ("campaignId", "workspaceId", "reviewId", "sourceId", "sourceSha256", "preparationSha256"):
    fault("skip-scope-" + field, f"value.{field} !== expected.{field}", "false", f"rejects cross-scope {field}")
fault("skip-predecessor-id", "intent.predecessorId !== (previous?.intent.requestId ?? null)", "false", "fences a stale or competing predecessorId")
fault("skip-predecessor-sha", "intent.predecessorSha256 !== (previous?.eventSha256 ?? null)", "false", "fences a stale or competing predecessorSha256")
fault("duplicate-approval", 'previous?.intent.operation === "approve" && sameRevision(previous.intent, intent)', "false", "same version only after explicit withdrawal")
fault("approve-old-version", 'previous && intent.revisionNo < previous.intent.revisionNo', "false", "retains original approval after approving a later correction")
fault("withdraw-other-version", '!sameRevision(intent, previous.intent)', "false", "rejects withdrawal of a different version")
fault("withdraw-twice", 'previous.intent.operation !== "approve"', "false", "rejects withdrawal of a different version")
fault("missing-checksum", "actual !== packet.eventSha256", "false", "rejects altered event bytes")
fault("broader-authority", 'purpose: z.literal("internal_staff_synthesis")', "purpose: z.string()", "rejects altered event bytes")
fault("future-schema", "schemaVersion: z.literal(1)", "schemaVersion: z.number()", "rejects altered event bytes")
fault("empty-reason", "value.trim().length > 0", "true", "refuses an invalid reason")
fault("nul-reason", '!value.includes("\\0")', "true", "refuses an invalid reason")
fault("malformed-unicode-reason", "value.isWellFormed()", "true", "refuses an invalid reason")
fault("too-long-reason", "[...value].length <= 2000", "true", "refuses an invalid reason")
fault("rewrite-reason", 'operation: z.enum(["approve", "withdraw"]), reason,', 'operation: z.enum(["approve", "withdraw"]), reason: reason.transform(value => value.slice(0, 10)),', "preserves full Unicode reasons")
fault("unpaired-predecessor", "(intent.predecessorId === null) !== (intent.predecessorSha256 === null)", "false", "preserves full Unicode reasons")
fault("self-predecessor", "intent.predecessorId === intent.requestId", "false", "preserves full Unicode reasons")
fault("withdraw-without-approval", '(intent.operation === "withdraw" && intent.predecessorId === null)', "false", "preserves full Unicode reasons")
fault("extra-command-fields", '}).strict().superRefine((intent, ctx)', '}).passthrough().superRefine((intent, ctx)', "preserves full Unicode reasons")
fault("altered-receipt", "!sameIntent(event.intent, intent)", "false", "recovers exact old receipts")
fault("incorrect-inventory", "history.eventCount !== history.entries.length", "false", "refuses incomplete, reordered, duplicated")
fault("wrong-sequence", "event.eventNo !== entries.length + 1", "false", "refuses incomplete, reordered, duplicated")
fault("reused-request", "ids.has(event.intent.requestId)", "false", "refuses incomplete, reordered, duplicated")
fault("wrong-head-id", "history.headId !== (previous?.intent.requestId ?? null)", "false", "refuses incomplete, reordered, duplicated")
fault("wrong-head-sha", "history.headSha256 !== (previous?.eventSha256 ?? null)", "false", "refuses incomplete, reordered, duplicated")
fault("reused-revision-id", "(byId && !sameRevision(byId, event.intent))", "false", "rejects reassignment of a retained revision ID")
fault("reused-revision-number", "(byNumber && !sameRevision(byNumber, event.intent))", "false", "rejects reassignment of a retained revision ID")
fault("historical-hash-corruption", "event && !sameRevision(event.intent, revision)", "false", "rejects historical revisionSha256 corruption")
fault("withdrawal-disappears", '"withdrawn" as const', '"unapproved" as const', "withdraws the exact prior approval after correction")
fault("approval-disappears", '"approved" as const', '"unapproved" as const', "binds approval to the exact revision")
fault("oldest-event-wins", "history.entries.findLast", "history.entries.find", "same version only after explicit withdrawal")

results = []
try:
    with tempfile.TemporaryDirectory(prefix="openplan-approval-domain-") as scratch:
        for name, before, after, assertion in cases:
            value = original.decode()
            if before:
                assert value.count(before) == 1, (name, value.count(before))
                value = value.replace(before, after, 1)
            source.write_text(value)
            output = Path(scratch) / "result.json"
            output.unlink(missing_ok=True)
            run = subprocess.run(["node_modules/.bin/vitest", "run", "src/test/engagement-synthesis-approval.test.ts", "--reporter=json", "--outputFile=" + str(output)], cwd=app, capture_output=True, text=True, timeout=60)
            report = json.loads(output.read_text())
            failures = [test["fullName"] for suite in report["testResults"] for test in suite["assertionResults"] if test["status"] == "failed"]
            expected = (run.returncode == 0 and report["numPassedTests"] == 29 and report["numFailedTests"] == 0) if assertion is None else (run.returncode != 0 and any(assertion in test for test in failures))
            results.append({"case": name, "expected": "survives" if assertion is None else "fails", "exit": run.returncode,
                "passed": report["numPassedTests"], "failed": report["numFailedTests"], "failedAssertions": failures, "expectedOutcome": bool(expected)})
            print(name, "expected" if expected else "UNEXPECTED", flush=True)
            if not expected:
                raise AssertionError((name, failures, run.stdout[-2000:], run.stderr[-2000:]))
finally:
    source.write_bytes(original)
    (review / "approval-domain-mutations.json").write_text(json.dumps({"cases": results, "sourceRestored": source.read_bytes() == original,
        "sourceSha256": hashlib.sha256(original).hexdigest(), "blindCategories": [
            "Pure protocol tests do not establish database locking, access control, membership revocation, or durable idempotency.",
            "A checksum establishes byte consistency, not who authorized the bytes; native access and authenticated route checks are still required.",
            "A self-consistent truncated history with a forged count and head requires comparison with authoritative database history.",
            "No browser reachability, usability, recovery, approval meaning, export, or public authority is established."
        ]}, indent=2) + "\n")
