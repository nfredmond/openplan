"""Prove selected browser-draft storage guards with real assertions in jsdom.

Use only in the owned checkout without an active browser/source editor. Every
mutation restores the exact original before the next case. Browser storage,
geometry and real downloads require the separate identified browser journey.
"""
from pathlib import Path
import hashlib
import json
import subprocess
import time

review = Path(__file__).resolve().parent
app = review.parents[2] / "openplan"
private = Path("/home/nathaniel/.local/state/openplan/response-write-probe-20260913/storage-recovery-controls") / time.strftime("%Y%m%dT%H%M%S")
private.mkdir(parents=True, exist_ok=False)
paths = {"storage": app / "src/lib/engagement/translation-drafts.ts", "hook": app / "src/components/engagement/translation-draft-recovery.tsx"}
originals = {key: path.read_text() for key, path in paths.items()}
cases = [("baseline", "storage", originals["storage"], None)]
for key in paths: cases.append(("harmless-" + key, key, originals[key] + "\n// Harmless storage-recovery control.\n", None))
def mutation(name, key, old, new, test):
    assert originals[key].count(old) == 1, (name, old, originals[key].count(old))
    cases.append((name, key, originals[key].replace(old, new, 1), test))
mutation("forget-observed-bytes", "storage", "return { record, raw };", "return { record, raw: null };", "exact observed bytes from a single storage read")
mutation("overwrite-changed-copy", "storage", "before !== expectedRaw", "false", "refuses to replace an active copy")
mutation("repeat-confirmed-write", "storage", "if (before === raw) return parsed;", "", "recognizes an identical retained result")
mutation("forget-written-copy", "hook", "storedRaw.current = JSON.stringify(retained);", "", "keeps page words through a quota failure")
mutation("omit-stored-archive", "storage", "if (raw !== null) copies.add(raw);", "", "archives both the page draft and changed stored bytes")
mutation("omit-page-archive", "storage", "copies.add(JSON.stringify(parsed));", "", "archives page-only drafts")
mutation("foreign-page-archive", "storage", "translationDraftStorageKey(parsed) !== key", "false", "different editor scope")
mutation("ignore-incomplete-archive", "storage", "archived.some(copy => storage.getItem(copy.key) !== copy.raw)", "false", "second archive cannot be retained")
mutation("ignore-first-archive", "storage", "archived.some(copy => storage.getItem(copy.key) !== copy.raw)", "archived.slice(-1).some(copy => storage.getItem(copy.key) !== copy.raw)", "verifies the first archive again")
mutation("discard-newer-active", "storage", "storage.getItem(key) !== raw) throw new Error(\"Draft active copy changed during archiving\")", "false) throw new Error(\"Draft active copy changed during archiving\")", "does not remove a newer active copy")
mutation("ignore-failed-clear", "storage", "storage.getItem(key) !== null", "false", "failed active removal")
mutation("ignore-failed-retention", "storage", "storage.getItem(key) !== raw) throw new Error(\"Draft was not retained\")", "false) throw new Error(\"Draft was not retained\")", "storage write that returned")
mutation("omit-page-at-archive-call", "hook", "archiveTranslationDrafts(window.sessionStorage, scope, current.current)", "archiveTranslationDrafts(window.sessionStorage, scope)", "archives both the page draft and changed stored bytes")
mutation("overwrite-before-archive", "hook", "archiveTranslationDrafts(window.sessionStorage, scope, current.current);", "if (current.current) retainTranslationDrafts(window.sessionStorage, current.current, sessionStorage.getItem(key)); archiveTranslationDrafts(window.sessionStorage, scope);", "archives both the page draft and changed stored bytes")
mutation("retry-by-reloading-old-words", "hook", "onClick={() => { if (current.current) remember(current.current); }}", "onClick={restore}", "keeps page words through a quota failure")
mutation("hide-retention-retry", "hook", "setWriteFailed(true);", "setWriteFailed(false);", "keeps page words through a quota failure")
mutation("drop-newer-memory-copy", "hook", "current.current = next; setRecord(next);", "void next;", "does not overwrite changed stored bytes while keeping")
mutation("download-old-copy-as-latest", "hook", "record ? JSON.stringify(record) : sessionStorage.getItem(key)", "sessionStorage.getItem(key)", "downloads the newer page draft")
mutation("invent-empty-download", "hook", 'if (raw === null) throw new Error("No stored draft copy");\n          downloadDraft(raw);', 'downloadDraft(raw ?? "");', "does not invent an empty download")
mutation("enable-unreadable-editor", "hook", "catch { setReady(false);", "catch { setReady(true);", "preserves unreadable bytes after a remount")

results = []
report = review / "translation-storage-recovery-controls.json"
try:
    for name, key, body, failure in cases:
        path = paths[key]; assert path.read_text() == originals[key]
        output = private / (name + ".json"); path.write_text(body)
        try:
            command = ["npm", "exec", "--", "vitest", "run", "src/test/engagement-translation-draft-storage-recovery.test.tsx", "src/test/engagement-translation-drafts.test.ts", "src/test/engagement-translation-draft-recovery.test.tsx", "src/test/engagement-translation-editor-recovery.test.tsx", "--reporter=json", "--outputFile=" + str(output)]
            if failure: command += ["-t", failure]
            run = subprocess.run(command, cwd=app, capture_output=True, text=True, timeout=60)
        finally: path.write_text(originals[key])
        (private / (name + ".log")).write_text(run.stdout + run.stderr)
        data = json.loads(output.read_text())
        failed = [a["fullName"] for suite in data["testResults"] for a in suite["assertionResults"] if a["status"] == "failed"]
        expected = run.returncode == 0 and data["numPassedTests"] == 51 if failure is None else run.returncode != 0 and any(failure in title for title in failed)
        results.append({"case": name, "outcome": "survived" if run.returncode == 0 else "killed", "expectedFailure": failure, "failedAssertions": failed, "expectedOutcome": expected})
        report.write_text(json.dumps({"sourceSha256": {key: hashlib.sha256(value.encode()).hexdigest() for key,value in originals.items()}, "results": results,
            "limits": "Selected draft storage/recovery guards in jsdom. Not all editor/write guards, browser quota behavior, real downloads, generation or release checks."}, indent=2) + "\n")
        print(name, results[-1]["outcome"], "expected" if expected else "UNEXPECTED", flush=True)
        assert expected, (name, failed)
finally:
    for key, path in paths.items(): path.write_text(originals[key])
