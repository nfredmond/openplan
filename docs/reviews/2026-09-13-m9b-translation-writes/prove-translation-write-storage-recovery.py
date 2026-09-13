"""Prove selected volatile-request recovery guards with real assertions in jsdom.

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
private = Path("/home/nathaniel/.local/state/openplan/response-write-probe-20260913/write-storage-recovery-controls") / time.strftime("%Y%m%dT%H%M%S")
private.mkdir(parents=True, exist_ok=False)
paths = {"hook": app / "src/components/engagement/translation-write-recovery.tsx"}
originals = {key: path.read_text() for key, path in paths.items()}
cases = [("baseline", "hook", originals["hook"], None), ("harmless-hook", "hook", originals["hook"] + "\n// Harmless retained-request recovery control.\n", None)]
def mutation(name, old, new, test):
    assert originals["hook"].count(old) == 1, (name, old, originals["hook"].count(old))
    cases.append((name, "hook", originals["hook"].replace(old, new, 1), test))
mutation("replace-page-copy", "values.set(key, value);", "if (!values.has(key)) values.set(key, value);", "preserves the page request and separate stored bytes")
mutation("hide-differing-copy", "unresolved.add(pendingTranslationKey(value));", "void stored;", "preserves the page request and separate stored bytes")
mutation("report-identical-copy-damaged", "stored && canonicalizeActionPayload({ ...stored, phase: value.phase }) !== canonicalizeActionPayload(value)", "true", "does not report identical stored words as damaged")
# The page-memory merge now restores this copy even if the volatile cache is cleared.
# Retain the former killer as a harmless control instead of claiming it still fails.
cases.append(("clear-volatile-cache-after-archive", "hook", originals["hook"].replace('volatile.current.delete(value?.intent.requestId ?? "");', 'volatile.current.clear();'), None))
mutation("forget-page-on-storage-change", "volatile.current.set(value.intent.requestId, value);", "void value;", "keeps the in-flight page request when its stored copy")
mutation("archive-without-page-retention", "if (value) retainPendingTranslation(window.localStorage, value);", "void value;", "archives the page copy before reopening")
mutation("resurrect-confirmed-page", "remember(pendingRef.current.filter(row => row.intent.requestId !== retained.intent.requestId));", "void retained;", "removes the page request after an exact confirmation")
mutation("lose-refused-phase", "catch { volatile.current.set(next.intent.requestId, next); }", "catch { /* lost phase */ }", "retains a definite refusal phase")
mutation("resurrect-archived-page", "if (value) remember(pendingRef.current.filter(row => row.intent.requestId !== value.intent.requestId));", "void value;", "archives the page copy before reopening")
mutation("claim-deleted-attempt-unsent", '"This page still has the request, but could not confirm its retention', '"This attempt was not sent. This page still has the request, but could not confirm its retention', "keeps the in-flight page request when its stored copy")
mutation("deny-possible-earlier-send", "An earlier attempt may have reached the server.", "This request has never reached the server.", "keeps an earlier sent attempt uncertain")

results = []
report = review / "translation-write-storage-recovery-controls.json"
try:
    for name, key, body, failure in cases:
        path = paths[key]; assert path.read_text() == originals[key]
        output = private / (name + ".json"); path.write_text(body)
        try:
            command = ["npm", "exec", "--", "vitest", "run", "src/test/engagement-translation-write-storage-recovery.test.tsx", "--reporter=json", "--outputFile=" + str(output)]
            if failure: command += ["-t", failure]
            run = subprocess.run(command, cwd=app, capture_output=True, text=True, timeout=60)
        finally: path.write_text(originals[key])
        (private / (name + ".log")).write_text(run.stdout + run.stderr)
        data = json.loads(output.read_text())
        failed = [a["fullName"] for suite in data["testResults"] for a in suite["assertionResults"] if a["status"] == "failed"]
        expected = run.returncode == 0 and data["numPassedTests"] == 9 if failure is None else run.returncode != 0 and any(failure in title for title in failed)
        results.append({"case": name, "outcome": "survived" if run.returncode == 0 else "killed", "expectedFailure": failure, "failedAssertions": failed, "expectedOutcome": expected})
        report.write_text(json.dumps({"sourceSha256": {key: hashlib.sha256(value.encode()).hexdigest() for key,value in originals.items()}, "results": results,
            "limits": "Selected volatile-request merge and recovery checks in jsdom. Does not establish all request guards, real browser delivery, durable generation or release readiness."}, indent=2) + "\n")
        print(name, results[-1]["outcome"], "expected" if expected else "UNEXPECTED", flush=True)
        assert expected, (name, failed)
finally:
    for key, path in paths.items(): path.write_text(originals[key])
