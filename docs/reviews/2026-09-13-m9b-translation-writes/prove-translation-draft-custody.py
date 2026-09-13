"""Mutate draft storage and acknowledgement behavior in this owned checkout.

Do not run during browser acceptance or another source-changing task. Each case
restores its source; named JSON assertions distinguish expected kills from runner
errors. The controls cover draft custody, not all editor guards or release gates.
"""
from pathlib import Path
import hashlib
import json
import subprocess
import time

review = Path(__file__).resolve().parent
app = review.parents[2] / "openplan"
run_id = time.strftime("%Y%m%dT%H%M%S")
private = Path("/home/nathaniel/.local/state/openplan/response-write-probe-20260913/translation-draft-controls") / run_id
private.mkdir(parents=True, exist_ok=False)
paths = {"storage": app / "src/lib/engagement/translation-drafts.ts", "hook": app / "src/components/engagement/translation-draft-recovery.tsx",
    "panel": app / "src/components/engagement/campaign-translations-panel.tsx"}
originals = {key: path.read_text() for key, path in paths.items()}
cases = [("baseline", "storage", originals["storage"], None)]
for key in paths:
    cases.append(("harmless-" + key, key, originals[key] + "\n// Harmless draft custody control.\n", None))
def mutation(name, key, old, new, test):
    assert originals[key].count(old) == 1, (name, old, originals[key].count(old))
    cases.append((name, key, originals[key].replace(old, new, 1), test))

mutation("trim-draft-words", "storage", "text: z.string(), source:", "text: z.string().trim(), source:", "keeps raw words")
mutation("replace-damaged-copy", "storage", "if (raw === null) return {", "if (true) return {", "treats only an absent record")
for field in ["userId", "workspaceId", "campaignId"]:
    mutation("ignore-" + field, "storage", f"record.{field} !== scope.{field}", "false", "another " + field)
for field, term in [("campaign_id", "row.campaign_id !== record.campaignId"), ("workspace_id", "row.workspace_id !== record.workspaceId"),
                    ("locale", "row.locale !== draft.locale"), ("entity_type", "row.entity_type !== draft.entityType"),
                    ("entity_id", "row.entity_id !== draft.entityId"), ("field", "row.field !== draft.field")]:
    mutation("ignore-original-" + field, "storage", term, "false", "different " + field)
mutation("duplicate-draft", "storage", "keys.has(key)", "false", "refuses duplicate draft addresses")
mutation("ignore-write-failure", "storage", "storage.getItem(key) !== raw) throw new Error(\"Draft was not retained\")", "false) throw new Error(\"Draft was not retained\")", "storage write that returned")
mutation("lossy-archive", "storage", "storage.setItem(archive, raw);", "storage.setItem(archive, raw.trim());", "archives exact damaged bytes")
mutation("ignore-archive-failure", "storage", "storage.getItem(archive) !== raw", "false", "writing its archive fails")
mutation("discard-newer-active", "storage", "storage.getItem(key) !== raw) throw new Error(\"Draft archive failed or active copy changed\")", "false) throw new Error(\"Draft archive failed or active copy changed\")", "changes during archiving")
mutation("ignore-remove-failure", "storage", "storage.getItem(key) !== null", "false", "failed active removal")
mutation("forget-before-remount", "hook", "retainTranslationDrafts(window.sessionStorage, next);", "void next;", "preserves an unsent draft")
mutation("rebase-while-typing", "hook", "old ? { ...old, text } : observed(snapshot, address, locale, text)", "observed(snapshot, address, locale, text)", "does not rebase a typed draft")
mutation("erase-draft-on-decision", "hook", ' || pending.intent.operation !== "save"', "", "keeps an unsaved draft when the saved copy")
mutation("erase-other-address", "hook", 'if (!requested || pending.intent.operation !== "save") return true;', 'if (!requested) return false; if (pending.intent.operation !== "save") return true;', "leaves other drafts alone")
mutation("erase-newer-words", "hook", 'if ("text" in requested && draft.text !== requested.text) return true;', "", "changed words after a delayed")
mutation("erase-newer-source", "hook", "JSON.stringify(draft.source) !== JSON.stringify(requested.expectedSource)", "false", "changed source after a delayed")
mutation("erase-newer-identity", "hook", "(draft.before?.entry.id ?? null) !== (requested.expectedTranslation?.id ?? null)", "false", "changed identity after a delayed")
mutation("erase-newer-revision", "hook", "(draft.before?.revision ?? null) !== (requested.expectedTranslation?.revision ?? null)", "false", "changed revision after a delayed")
mutation("erase-newer-reason", "hook", 'value.reason === (pending.intent.reason ?? "") ? "" : value.reason', '""', "preserves a newer reason")
mutation("ignore-draft-source", "panel", "draft?.source ?? translationSnapshotSource", "translationSnapshotSource", "preserves an unsent draft")
mutation("ignore-draft-version", "panel", "if (draft) return draft.before;", "", "preserves an unsent draft")

results = []
report = review / "translation-draft-custody-results.json"
try:
    for name, key, body, failure in cases:
        path = paths[key]
        assert path.read_text() == originals[key], (name, "Source changed outside runner")
        output_file = private / (name + ".json")
        path.write_text(body)
        try:
            command = ["npm", "exec", "--", "vitest", "run", "src/test/engagement-translation-drafts.test.ts",
                "src/test/engagement-translation-draft-recovery.test.tsx", "src/test/engagement-translation-editor-recovery.test.tsx",
                "--reporter=json", "--outputFile=" + str(output_file)]
            if failure: command += ["-t", failure]
            run = subprocess.run(command, cwd=app, capture_output=True, text=True, timeout=60)
        finally:
            path.write_text(originals[key])
        (private / (name + ".log")).write_text(run.stdout + run.stderr)
        data = json.loads(output_file.read_text())
        failed = [a["fullName"] for suite in data["testResults"] for a in suite["assertionResults"] if a["status"] == "failed"]
        expected = run.returncode == 0 and data["numPassedTests"] == 36 if failure is None else run.returncode != 0 and any(failure in title for title in failed)
        results.append({"case": name, "outcome": "survived" if run.returncode == 0 else "killed", "expectedFailure": failure,
            "failedAssertions": failed, "expectedOutcome": expected})
        report.write_text(json.dumps({"runId": run_id, "sourceSha256": {key: hashlib.sha256(value.encode()).hexdigest() for key,value in originals.items()},
            "results": results, "limits": "Draft storage and acknowledgement assertions in jsdom; editor HTTP is mocked. Does not establish installed permissions, live browser persistence, geometry, all write-recovery guards, generation or release readiness."}, indent=2) + "\n")
        print(name, results[-1]["outcome"], "expected" if expected else "UNEXPECTED", flush=True)
        assert expected, (name, failed, run.stdout, run.stderr)
finally:
    for key, path in paths.items(): path.write_text(originals[key])
