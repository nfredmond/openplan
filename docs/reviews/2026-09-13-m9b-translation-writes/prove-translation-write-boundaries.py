"""Exercise real route/helper assertions with harmless and targeted mutations.

Only run in the owned translation checkout, with no other editor/test process.
Every source is restored in finally. JSON assertion results distinguish an
intended failure from a build/runner error or a different broken test.
"""
from pathlib import Path
import hashlib
import json
import subprocess
import time

review = Path(__file__).resolve().parent
root = review.parents[2]
app = root / "openplan"
run_id = time.strftime("%Y%m%dT%H%M%S")
private = Path("/home/nathaniel/.local/state/openplan/response-write-probe-20260913/translation-write-controls") / run_id
private.mkdir(parents=True, exist_ok=False)
paths = {
    "write": app / "src/lib/engagement/translation-write.ts",
    "pending": app / "src/lib/engagement/pending-translation.ts",
    "post": app / "src/app/api/engagement/campaigns/[campaignId]/translations/commands/route.ts",
    "get": app / "src/app/api/engagement/campaigns/[campaignId]/translations/snapshot/route.ts",
}
originals = {key: path.read_text() for key, path in paths.items()}
cases = []

def mutation(name, key, old, new, test):
    assert originals[key].count(old) == 1, (name, old, originals[key].count(old))
    cases.append((name, key, originals[key].replace(old, new, 1), test))

cases.append(("baseline", "write", originals["write"], None))
for key in paths:
    cases.append(("harmless-" + key, key, originals[key] + "\n// Harmless boundary control.\n", None))

for key, title in [("post", "write"), ("get", "snapshot")]:
    mutation(key + "-ignore-invalid-campaign", key, "if (!params.success)", "if (false)", title + " translation access validates campaign identity")
    mutation(key + "-allow-anonymous", key, "if (!user)", "if (false)", title + " translation access refuses unauthenticated")
    mutation(key + "-allow-denied", key, "if (!access.allowed)", "if (false)", title + " translation access refuses denied")
    mutation(key + "-ignore-access-error", key, "if (access.error)", "if (false)", title + " translation access refuses unreadable")
    mutation(key + "-cache-private-response", key, '"private, no-store"', '"public, max-age=300"', "sends the exact save" if key == "post" else "returns the complete raw snapshot")

mutation("post-wrong-permission", "post", '"engagement.write"', '"engagement.read"', "sends the exact save")
mutation("get-wrong-permission", "get", '"engagement.read"', '"engagement.write"', "returns the complete raw snapshot")
mutation("post-buffer-whole-upload", "post", "readBytesWithLimitStreaming(request, TRANSLATION_WRITE_BODY_LIMIT)", "readBytesWithLimitStreaming({ arrayBuffer: () => request.arrayBuffer() } as Request, TRANSLATION_WRITE_BODY_LIMIT)", "cancels an oversize streamed body")
mutation("post-lossy-utf8", "post", '{ fatal: true }', '{ fatal: false }', "rejects malformed utf8")
mutation("post-ignore-invalid-intent", "post", "if (!parsed.success)", "if (false)", "rejects malformed intent")
mutation("post-ignore-write-refusal", "post", "if (written.error)", "if (false)", "preserves PT409 refusal")
mutation("get-ignore-read-refusal", "get", "if (result.error)", "if (false)", "withholds a partial snapshot")
mutation("undersized-transport", "write", "8 * 1024 * 1024", "256 * 1024", "accepts a valid Unicode batch")
mutation("replace-request-id", "write", "p_request: body.requestId", "p_request: crypto.randomUUID()", "sends raw words, null source locale")
mutation("trim-command-words", "write", "text: translationWords", "text: translationWords.transform(text => text.trim())", "sends raw words, null source locale")
mutation("ignore-input-validation", "write", "if (!parsed.success)", "if (false)", "refuses missing request")
mutation("allow-duplicate-input-address", "write", "!fields[entry.entityType].includes(entry.field) || seen.has(key)", "!fields[entry.entityType].includes(entry.field) || false", "refuses duplicate address without calling")
mutation("allow-unsupported-field", "write", "!fields[entry.entityType].includes(entry.field)", "false", "refuses unsupported source field")
mutation("ignore-correction-reason", "write", "&& !intent.reason?.trim()", "&& false", "requires a reason for corrections")
mutation("allow-unavailable-source", "write", 'intent.operation !== "withdraw" && (!entry.expectedSource.available || !entry.expectedSource.text?.trim())', 'false', "allows withdrawal of unpublished words")
mutation("ignore-rpc-refusal", "write", "if (reply.error)", "if (false)", "keeps a PT409 response distinct")

for term, name, test in [
    ("result.campaignId !== scope.campaignId", "campaign", "mismatched campaign"),
    ("result.requestId !== intent.requestId", "request", "mismatched request"),
    ("result.operation !== intent.operation", "operation", "mismatched operation"),
    ("result.locale !== intent.locale", "locale", "mismatched locale"),
    ("result.entries.length !== intent.entries.length", "count", "mismatched partial batch"),
    ("seen.has(key)", "duplicate-address", "batch receipt with duplicate address"),
    ("seenIds.has(row.id)", "duplicate-id", "batch receipt with duplicate row identity"),
    ("row.campaign_id !== scope.campaignId", "row-campaign", "correction receipt with changed campaign"),
    ("row.workspace_id !== scope.workspaceId", "workspace", "mismatched workspace"),
    ("row.locale !== intent.locale", "row-locale", "correction receipt with changed locale"),
    ('saved.removed !== (intent.operation === "withdraw")', "removal", "mismatched removal"),
    ("row.id !== before.id", "version-id", "correction receipt with changed id"),
    ("saved.revision < before.revision", "older-revision", "correction receipt with changed older revision"),
    ("saved.revision > before.revision + 1", "skipped-revision", "correction receipt with changed skipped revision"),
    ("saved.revision !== 1", "new-revision", "mismatched new version"),
    ('row.source !== "operator"', "source", "mismatched changed authorship"),
    ("row.machine_model !== null", "model", "correction receipt with changed model"),
    ("row.translated_text !== expected.text", "words", "mismatched changed words"),
]:
    # The input and result each check duplicate addresses; mutate only the result.
    old = "!expected || seen.has(key)" if name == "duplicate-address" else term
    new = "!expected || false" if name == "duplicate-address" else "false"
    mutation("receipt-" + name, "write", old, new, test)
mutation("allow-unretained-acceptance", "write", 'intent.operation !== "save" && before && saved.revision !== before.revision + 1', "false", "incremented revision and original authorship for accept")

for name, old, new, test in [
    ("allow-before-length-mismatch", "pending.before.length !== pending.intent.entries.length", "false", "refuses a mismatched before-copy"),
    ("allow-before-revision-mismatch", "baseline?.revision !== expected.revision", "false", "refuses a mismatched before-copy"),
    ("accept-operator-origin", 'pending.intent.operation === "accept" && row?.source !== "machine"', "false", "requires a reason for corrections"),
    ("overwrite-retained-request", "old !== null && identity(pendingTranslationSchema.parse(JSON.parse(old))) !== identity(pending)", "false", "never replaces different words"),
    ("ignore-failed-storage-write", "storage.getItem(key) !== serialized", "false", "storage write that did not retain"),
    ("discard-malformed-record", "unreadableKeys.push(key)", "void key", "preserves unreadable bytes"),
    ("clear-other-payload", "raw !== null && identity(pendingTranslationSchema.parse(JSON.parse(raw))) !== identity(pending)", "false", "never replaces different words"),
    ("ignore-failed-clear", 'if (storage.getItem(key) !== null) throw new Error("Translation recovery record was not cleared");', "", "failed active-record removal"),
    ("archive-other-scope", "!key.startsWith(prefix(userId, campaignId))", "false", "archive access to a different campaign"),
    ("discard-without-archive", "storage.getItem(archiveKey) !== raw", "false", "archiving failed or another writer"),
    ("archive-stale-bytes", "storage.getItem(key) !== raw", "false", "archiving failed or another writer"),
    ("ignore-failed-archive-clear", 'if (storage.getItem(key) !== null) throw new Error("Translation recovery record was not cleared after archiving");', "", "failed active-record removal"),
    ("confirm-other-actor", "saved.entry.created_by !== pending.userId", "false", "save attributed to another actor"),
    ("confirm-changed-words-without-revision", "before && saved.revision === before.revision", "false", "unchanged-content saves but requires a new revision"),
    ("confirm-altered-baseline", "saved.entry.translated_text !== before.entry.translated_text", "false", "preserves the original model words"),
    ("confirm-changed-original-actor", "saved.entry.created_by !== before.entry.created_by", "false", "incremented revision and original authorship for accept"),
    ("confirm-changed-withdrawal-origin", 'pending.intent.operation === "withdraw" && (saved.entry.source !== before.entry.source || saved.entry.machine_model !== before.entry.machine_model)', "false", "withdrawal with a different original source"),
]:
    mutation(name, "pending", old, new, test)
for term in ["value.workspaceId !== workspaceId", "pendingTranslationKey(value) !== key"]:
    mutation("recovery-scope-" + term.split()[0], "pending", term, "false", "mismatched scope or request identities")
for term, label in [("row.id !== expected.id", "id"), ("row.campaign_id !== pending.campaignId", "campaign_id"),
    ("row.workspace_id !== pending.workspaceId", "workspace_id"), ("row.locale !== pending.intent.locale", "locale"),
    ("row.entity_type !== requested.entityType", "entity_type"), ("row.entity_id !== requested.entityId", "entity_id"),
    ("row.field !== requested.field", "field")]:
    mutation("before-" + label, "pending", term, "false", "before-copy with mismatched " + label)
mutation("invent-absent-baseline", "pending", "baseline !== null", "false", "explicit absent before-copy")

results = []
report = review / "translation-write-boundary-results.json"
try:
    for name, key, body, failure in cases:
        path = paths[key]
        assert path.read_text() == originals[key], (name, "Source changed outside runner")
        path.write_text(body)
        output_file = private / (name + ".json")
        try:
            run = subprocess.run(["npm", "exec", "--", "vitest", "run", "src/test/engagement-translation-write.test.ts",
                "src/test/engagement-translation-command-routes.test.ts", "--reporter=json", "--outputFile=" + str(output_file)],
                cwd=app, capture_output=True, text=True, timeout=60)
        finally:
            path.write_text(originals[key])
        (private / (name + ".log")).write_text(run.stdout + run.stderr)
        data = json.loads(output_file.read_text())
        failed = [a["fullName"] for suite in data["testResults"] for a in suite["assertionResults"] if a["status"] == "failed"]
        expected = run.returncode == 0 and data["numPassedTests"] == 89 if failure is None else run.returncode != 0 and any(failure in name for name in failed)
        results.append({"case": name, "outcome": "survived" if run.returncode == 0 else "killed", "expectedFailure": failure,
            "failedAssertions": failed, "expectedOutcome": expected})
        report.write_text(json.dumps({"runId": run_id, "sourceSha256": {k: hashlib.sha256(v.encode()).hexdigest() for k,v in originals.items()}, "results": results,
            "limits": "Route and client contracts with a mocked database transport. Does not prove installed permissions, SQL atomicity, real HTTP uploads, browser localStorage or navigation, generation or release readiness."}, indent=2) + "\n")
        print(name, results[-1]["outcome"], "expected" if expected else "UNEXPECTED", flush=True)
        assert expected, (name, failed, run.stdout, run.stderr)
finally:
    for key, path in paths.items():
        path.write_text(originals[key])
