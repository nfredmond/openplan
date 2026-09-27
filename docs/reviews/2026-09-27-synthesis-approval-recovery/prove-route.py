"""Challenge route-local authorization and private HTTP receipts; lower server behavior has separate proof."""
from pathlib import Path
import hashlib
import json
import subprocess
import tempfile
from datetime import datetime, timezone
review = Path(__file__).resolve().parent
repo = review.parents[2]
app = repo / "openplan"
source = app / "src/app/api/engagement/campaigns/[campaignId]/synthesis/approvals/route.ts"
original = source.read_bytes()
cases = [("baseline", "", "", None), ("harmless-comment", "/** Staff approve or withdraw", "/** Campaign staff approve or withdraw", None)]
def fault(name, before, after, assertion):
    cases.append((name, before, after, assertion))

fault("missing-current-user", 'if (!user) return { response: failure("forbidden", 401) };', '', "denies missing or changed staff access")
fault("access-failure-as-denial", 'if (access.error) return { response: failure("unavailable") };', '', "denies missing or changed staff access")
fault("missing-campaign-check", '!access.campaign || !access.allowed', '!access.allowed', "denies missing or changed staff access")
fault("missing-staff-permission", '!access.campaign || !access.allowed', '!access.campaign', "denies missing or changed staff access")
for field in ["user", "workspace"]:
    fault("missing-expected-" + field, f'request.headers.has("x-openplan-expected-{field}")', 'false', "denies missing or changed staff access")
for field, other in [("actorId", "access.user.id"), ("workspaceId", "access.workspaceId"), ("campaignId", "params.data.campaignId")]:
    fault("missing-command-" + field, f'intent.data.{field} !== {other}', 'false', "binds command " + field)
for marker in ["execution-source", "input-hash", "approval-id"]:
    key = '"x-openplan-assistant-' + marker + '"'
    fault("assistant-marker-" + marker, key, '"x-synthetic-unused-marker"', "requires browser origin and refuses each unregistered assistant marker")
fault("no-origin-check", 'try { requireProviderBrowserOrigin(request); } catch { return failure("forbidden"); }', '', "requires browser origin and refuses each unregistered assistant marker")
fault("expanded-body-limit", 'request, 16_384', 'request, 65_536', "rejects oversized, malformed and extra command content")
fault("replace-invalid-utf8", '{ fatal: true }', '{ fatal: false }', "rejects oversized, malformed and extra command content")
fault("unchecked-command", 'synthesisApprovalIntentSchema.safeParse(raw)', '({ success: true, data: raw as typeof synthesisApprovalIntentSchema._output })', "rejects oversized, malformed and extra command content")
fault("extra-query-fields", 'z.object({ reviewId: uuid }).strict()', 'z.object({ reviewId: uuid }).passthrough()', "rejects invalid routes, duplicate query keys")
fault("duplicate-query-keys", 'new Set(entries.map(([key]) => key)).size !== entries.length', 'false', "rejects invalid routes, duplicate query keys")
fault("wrong-read-scope", 'workspaceId: access.workspaceId, reviewId: query.data.reviewId', 'workspaceId: access.user.id, reviewId: query.data.reviewId', "returns replay status and private complete history")
fault("wrong-writer-scope", 'workspaceId: access.workspaceId, actorId: access.user.id,', 'workspaceId: access.user.id, actorId: access.user.id,', "binds the writer identity")
fault("always-created-status", 'status: receipt.replayed ? 200 : 201', 'status: 201', "returns replay status and private complete history")
fault("cache-private-history", '"Cache-Control": "private, no-store"', '"Cache-Control": "public, max-age=600"', "binds the writer identity")
fault("enriched-receipt-exposed", 'NextResponse.json({ event: { eventText: receipt.event.eventText, eventSha256: receipt.event.eventSha256 }, replayed: receipt.replayed },', 'NextResponse.json(receipt,', "binds the writer identity")
fault("internal-history-exposed", 'history: state.packet', 'history: state.history', "returns replay status and private complete history")
fault("private-reason-in-audit", 'operation: receipt.event.intent.operation, replayed: receipt.replayed', 'reason: receipt.event.intent.reason, operation: receipt.event.intent.operation, replayed: receipt.replayed', "binds the writer identity")
fault("lost-review-error-kind", ' || error instanceof SynthesisReviewError', '', "preserves forbidden errors")
fault("unexpected-failure-is-invalid", 'error.kind : "unavailable"', 'error.kind : "invalid"', "returns unavailable rather than success")
fault("missing-review-is-success", 'if (!state) return failure("missing");', 'if (!state) return NextResponse.json({}, { headers });', "returns replay status and private complete history")

results = []
try:
    with tempfile.TemporaryDirectory(prefix="openplan-approval-route-proof-") as scratch:
        for name, before, after, assertion in cases:
            value = original.decode()
            if before:
                assert value.count(before) == 1, (name, value.count(before))
                value = value.replace(before, after, 1)
            source.write_text(value)
            output = Path(scratch) / "result.json"
            output.unlink(missing_ok=True)
            run = subprocess.run(["node_modules/.bin/vitest", "run", "src/test/engagement-synthesis-approval-route.test.ts", "--reporter=json", "--outputFile=" + str(output)], cwd=app, capture_output=True, text=True, timeout=60)
            report = json.loads(output.read_text())
            failures = [{"name": test["fullName"], "messages": test["failureMessages"]} for suite in report["testResults"] for test in suite["assertionResults"] if test["status"] == "failed"]
            expected = (run.returncode == 0 and report["numPassedTests"] == 14 and report["numFailedTests"] == 0) if assertion is None else (run.returncode != 0 and any(assertion in test["name"] for test in failures))
            results.append({"case": name, "expected": "survives" if assertion is None else "fails", "expectedOutcome": bool(expected), "exit": run.returncode,
                "passed": report["numPassedTests"], "failed": report["numFailedTests"], "failedAssertions": failures})
            print(name, "expected" if expected else "UNEXPECTED", flush=True)
            if not expected:
                raise AssertionError((name, failures, run.stdout[-1000:], run.stderr[-1000:]))
finally:
    source.write_bytes(original)
    (review / "route-mutations.json").write_text(json.dumps({"recordedAt": datetime.now(timezone.utc).isoformat(), "cases": results,
        "sourceRestored": source.read_bytes() == original, "sourceSha256": hashlib.sha256(original).hexdigest(),
        "blindCategories": ["Authentication, campaign access and application server results are mocked; native tests protect the underlying database boundary.",
            "The real HTTP handlers, origin guard, streaming limit, command schema and receipt parser run. No browser navigation or deployed HTTP server is exercised.",
            "Route errors must remain distinct even where another server guard would also reject the request."]}, indent=2) + "\n")
