"""Exercise history receipt boundaries with harmless and targeted changes.

SQL fixtures and candidate definitions always run in a rolled-back transaction on
the explicitly named disposable stack. JS source is restored after each case.
Do not run while a browser journey or another source editor owns this checkout.
"""
from pathlib import Path
import hashlib
import json
import subprocess
import time

review = Path(__file__).resolve().parent
root = review.parents[2]
app = root / "openplan"
private = Path("/home/nathaniel/.local/state/openplan/response-write-probe-20260913/history-receipt-controls") / time.strftime("%Y%m%dT%H%M%S")
private.mkdir(parents=True, exist_ok=False)
container = "supabase_db_openplan-restore-target-2026091050"
migration = (app / "supabase/migrations/20261014000012_engagement_translation_history_receipts.sql").read_text()
fixture = (app / "src/test/fixtures/engagement/translation-history-receipts.sql").read_text()
paths = {"pending": app / "src/lib/engagement/pending-translation.ts", "reader": app / "src/lib/engagement/translation-history-server.ts", "schema": app / "src/lib/engagement/translation-history.ts", "ui": app / "src/components/engagement/translation-history.tsx"}
original = {key: path.read_text() for key, path in paths.items()}
results = []
report = review / "translation-history-receipt-controls.json"
def save():
    report.write_text(json.dumps({"sourceSha256": {key: hashlib.sha256(value.encode()).hexdigest() for key,value in original.items()},
        "migrationSha256": hashlib.sha256(migration.encode()).hexdigest(), "results": results,
        "limits": "Rolled-back SQL and selected reader/UI guards. Not browser evidence, installed upgrade, all changed guards, full RLS or release checks."}, indent=2) + "\n")

def changed(text, old, new):
    assert text.count(old) == 1, (old, text.count(old))
    return text.replace(old, new, 1)
sql_cases = [("sql-baseline", migration, None), ("sql-harmless", migration + "\n-- Harmless history control.\n", None),
    ("sql-bypass-rls", changed(migration, "SECURITY INVOKER", "SECURITY DEFINER"), "Viewer received private history or receipts"),
    ("sql-missing-history-link", changed(migration, "'write_request_id',h.write_request_id", "'write_request_id',NULL"), "History command links were missing"),
    ("sql-trim-source-bytes", changed(migration, "r.payload::text", "replace(r.payload::text,chr(160),'')"), "Exact command bytes or checksums were lost"),
    ("sql-limit-history", changed(migration, "WHERE campaign_id=p_campaign\n", "WHERE campaign_id=p_campaign LIMIT 1\n"), "History did not return one complete batch receipt"),
    ("sql-anonymous-execute", migration + "\nGRANT EXECUTE ON FUNCTION public.read_engagement_translation_history(uuid) TO anon;", "Anonymous execute privilege survived")]
for name, sql, failure in sql_cases:
    body = "BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='3s';\n" + sql + "\nGRANT EXECUTE ON FUNCTION public.write_engagement_translations(uuid,uuid,text,text,text,jsonb) TO authenticated;\n" + fixture + "\nROLLBACK;\n"
    run = subprocess.run(["docker", "exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], input=body, capture_output=True, text=True, timeout=45)
    (private / (name + ".log")).write_text(run.stdout + run.stderr)
    expected = run.returncode == 0 and run.stdout.strip() == "translation-history-receipts-verified" if failure is None else run.returncode != 0 and failure in run.stderr
    results.append({"case": name, "outcome": "survived" if run.returncode == 0 else "killed", "expectedFailure": failure, "expectedOutcome": expected}); save()
    print(name, results[-1]["outcome"], "expected" if expected else "UNEXPECTED", flush=True)
    assert expected

cases = [("reader-baseline", "reader", original["reader"], None)]
for key in paths: cases.append(("harmless-" + key, key, original[key] + "\n// Harmless history receipt control.\n", None))
def mutation(name, key, old, new, test): cases.append((name, key, changed(original[key], old, new), test))
for name, term, test in [
    ("payload-checksum", 'createHash("sha256").update(raw.payload_text, "utf8").digest("hex") !== raw.payload_sha256', "on payload checksum"),
    ("result-checksum", 'createHash("sha256").update(raw.result_text, "utf8").digest("hex") !== raw.result_sha256', "on result checksum"),
    ("receipt-count", "snapshot.receiptCount !== snapshot.receipts.length", "on receipt count"),
    ("duplicate-receipt", "receipts.has(raw.request_id)", "on duplicate receipt"),
    ("receipt-campaign", "recordedCampaign !== campaignId", "on foreign campaign"),
    ("receipt-actor", "actorId !== raw.actor_id", "on foreign actor metadata"),
    ("receipt-request", "intent.requestId !== raw.request_id", "on foreign request metadata"),
    ("history-actor", "receipt.actorId !== row.actor_id", "on foreign history actor"),
    ("original-result", "result.replayed", "on replayed stored result"),
    ("retained-result", "!isDeepStrictEqual(retainedTranslationSchema.parse(result.entry), row.record)", "on receipt wording differs"),
    ("history-event", "row.event !== event", "on wrong history event"),
    ("unrelated-receipt", "used.size !== receipts.size", "on unrelated receipt"),
    ("source-hash", 'row.record.source_text_hash !== createHash("sha256").update(requested.expectedSource.text!.trim(), "utf8").digest("hex")', "on source words differ"),
]: mutation(name, "reader", term, "false", test)
mutation("shared-starting-version", "pending", "baseline?.revision !== expected.revision", "false", "on other starting version")
mutation("missing-ui-evidence", "schema", "row.write_request_id !== (row.change?.requestId ?? null)", "false", "refuses a linked history entry")
mutation("trim-ui-source", "ui", 'row.change.source.text ?? "No source words recorded"', 'row.change.source.text?.trim() ?? "No source words recorded"', "shows the verified reason")
try:
    for name, key, body, failure in cases:
        path = paths[key]; assert path.read_text() == original[key]
        output = private / (name + ".json"); path.write_text(body)
        try:
            command = ["npm", "exec", "--", "vitest", "run", "src/test/engagement-translation-history-receipts.test.ts", "src/test/engagement-translation-history.test.ts", "src/test/engagement-translation-history-ui.test.tsx", "src/test/engagement-translation-history-route.test.ts", "--reporter=json", "--outputFile=" + str(output)]
            if failure: command += ["-t", failure]
            run = subprocess.run(command, cwd=app, capture_output=True, text=True, timeout=60)
        finally: path.write_text(original[key])
        (private / (name + ".log")).write_text(run.stdout + run.stderr)
        data = json.loads(output.read_text())
        failed = [a["fullName"] for suite in data["testResults"] for a in suite["assertionResults"] if a["status"] == "failed"]
        expected = run.returncode == 0 and data["numPassedTests"] == 60 if failure is None else run.returncode != 0 and any(failure in title for title in failed)
        results.append({"case": name, "outcome": "survived" if run.returncode == 0 else "killed", "expectedFailure": failure, "failedAssertions": failed, "expectedOutcome": expected}); save()
        print(name, results[-1]["outcome"], "expected" if expected else "UNEXPECTED", flush=True)
        assert expected, (name, failed)
finally:
    for key, path in paths.items(): path.write_text(original[key])
