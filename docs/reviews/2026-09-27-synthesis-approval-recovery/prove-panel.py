"""Challenge component state and parent recovery wiring; this is not browser layout evidence."""
from pathlib import Path
import hashlib
import json
import subprocess
import tempfile
from datetime import datetime, timezone
review = Path(__file__).resolve().parent
repo = review.parents[2]
app = repo / "openplan"
panel = app / "src/components/engagement/synthesis-approval-panel.tsx"
editor = app / "src/components/engagement/synthesis-review-editor.tsx"
sources = app / "src/components/engagement/engagement-synthesis-sources.tsx"
originals = {path: path.read_bytes() for path in [panel, editor, sources]}
cases = [("baseline", panel, "", "", None), ("harmless-comment", panel, "/** Recovery belongs", "/** Browser recovery belongs", None)]
def fault(name, before, after, assertion, path=panel):
    cases.append((name, path, before, after, assertion))
fault("no-parent-recovery-map", ' approvalMemories={approvalMemories.current}', '', "keeps quota-failed approval reasons through real source focus", sources)
fault("editor-ignores-parent-memory", 'sourceApprovalMemories ?? localApprovalMemories.current', 'localApprovalMemories.current', "keeps quota-failed approval reasons through real source storage", editor)
start = originals[editor].decode().index('      <SynthesisApprovalPanel key=')
end = originals[editor].decode().index('      <ReviewCorrectionForm key=', start)
fault("approval-unreachable-from-review", originals[editor].decode()[start:end], '', "keeps quota-failed approval reasons through real source focus", editor)
fault("drop-quota-failed-memory", 'memory.current = value; setWorking(value);', 'memory.current = null; setWorking(value);', "keeps quota-failed reason text across inspector unmount")
fault("restore-stale-storage-over-latest", 'setWorking(unsaved); setError(', 'setError(', "keeps quota-failed reason text across inspector unmount")
fault("allow-quota-failed-restore", 'setBlocked(Boolean(unsaved))', 'setBlocked(false)', "keeps quota-failed reason text across inspector unmount")
fault("allow-new-action-while-pending", '|| Boolean(working.pending) || Boolean(otherDraft)', '|| Boolean(otherDraft)', "recovers an old exact request after an interrupted acknowledgement")
fault("allow-approval-of-history", 'disabled || !isCurrent || status?.state', 'disabled || status?.state', "leaves a correction unapproved and permits explicit withdrawal")
fault("carry-approval-to-correction", 'loaded ? synthesisApprovalForRevision(loaded.history, revision) : null', 'loaded ? { ...synthesisApprovalForRevision(loaded.history, revision), state: loaded.history.head?.intent.operation === "approve" ? "approved" : "unapproved" } : null', "leaves a correction unapproved and permits explicit withdrawal")
fault("no-refresh-on-revision-change", ', revision.revisionId, revision.revisionSha256, revision.revisionNo]);', ']);', "leaves a correction unapproved and permits explicit withdrawal")
fault("allow-unfinished-correction", '|| status?.state === "approved" || hasUnsavedReview', '|| status?.state === "approved"', "does not approve an unfinished review correction")
fault("invent-approval-reason", 'reason: retained.draft?.reason ?? ""', 'reason: retained.draft?.reason ?? "SYNTHETIC invented reason"', "requires a reason, approves exact bytes")
fault("unchecked-current-context", 'synthesisApprovalForRevision(history, current);', '', "refuses malformed current context")
fault("ignore-denied-read", 'res.status === 401 || res.status === 403', 'false', "clears private history after current access fails")
fault("late-read-changes-new-view", 'if (currentEpoch !== epoch.current || sequence !== reads.current) return;', '', "ignores a late denied read after unmount")
fault("unmount-does-not-invalidate", 'return invalidate;', 'return () => {};', "ignores a late denied read after unmount")
fault("late-write-changes-new-view", '    } catch (cause) {\n      if (currentEpoch !== epoch.current) return;', '    } catch (cause) {', "ignores a late denied write after unmount")
fault("recovered-receipt-names-new-version", '${result.receipt.event.intent.revisionNo}.', '${revision.revisionNo}.', "recovers an old exact request after an interrupted acknowledgement")
fault("discard-failed-request", 'else setError(cause instanceof z.ZodError', 'else { localStorage.clear(); setError(cause instanceof z.ZodError', "recovers an old exact request after an interrupted acknowledgement")
# The last fault inserts a block; close that block in the same case without changing other cases.
name, path, before, after, assertion = cases.pop()
before = 'else setError(cause instanceof z.ZodError ? "Record a reason of at most 2000 characters before approval or withdrawal." : message(cause));'
after = 'else { localStorage.clear(); setError(cause instanceof z.ZodError ? "Record a reason of at most 2000 characters before approval or withdrawal." : message(cause)); }'
fault(name, before, after, assertion)

fault("revision-selection-invalidates-write", 'return () => { window.removeEventListener', 'return () => { epoch.current++; window.removeEventListener', "finishes an in-flight exact approval after selecting a corrected revision")
results = []
tests = ["src/test/engagement-synthesis-approval-panel.test.tsx", "src/test/engagement-synthesis-review-editor.test.tsx", "src/test/engagement-synthesis-source-panel.test.tsx"]
try:
    with tempfile.TemporaryDirectory(prefix="openplan-approval-panel-proof-") as scratch:
        for name, path, before, after, assertion in cases:
            for file, raw in originals.items(): file.write_bytes(raw)
            value = path.read_text()
            if before:
                assert value.count(before) == 1, (name, value.count(before))
                path.write_text(value.replace(before, after, 1))
            output = Path(scratch) / "result.json"; output.unlink(missing_ok=True)
            run = subprocess.run(["node_modules/.bin/vitest", "run", *tests, "--reporter=json", "--outputFile=" + str(output)], cwd=app, capture_output=True, text=True, timeout=60)
            report = json.loads(output.read_text())
            failures = [{"name": test["fullName"], "messages": test["failureMessages"]} for suite in report["testResults"] for test in suite["assertionResults"] if test["status"] == "failed"]
            expected = (run.returncode == 0 and report["numPassedTests"] == 32 and report["numFailedTests"] == 0) if assertion is None else (run.returncode != 0 and any(assertion in test["name"] for test in failures))
            results.append({"case": name, "expected": "survives" if assertion is None else "fails", "expectedOutcome": bool(expected), "exit": run.returncode,
                "passed": report["numPassedTests"], "failed": report["numFailedTests"], "failedAssertions": failures})
            print(name, "expected" if expected else "UNEXPECTED", flush=True)
            if not expected: raise AssertionError((name, failures, run.stdout[-1000:], run.stderr[-1000:]))
finally:
    for path, raw in originals.items(): path.write_bytes(raw)
    (review / "panel-mutations.json").write_text(json.dumps({"recordedAt": datetime.now(timezone.utc).isoformat(), "cases": results,
        "sourcesRestored": all(path.read_bytes() == raw for path, raw in originals.items()),
        "sourceSha256": {str(path.relative_to(repo)): hashlib.sha256(raw).hexdigest() for path, raw in originals.items()},
        "blindCategories": ["jsdom has no layout and does not establish desktop/390px usability, browser storage or actual tab focus.",
            "Synthetic transport uses the real approval protocol, but does not establish HTTP, native permissions, concurrent writers or durable database changes.",
            "Some faults change denial classification or reachability while a second guard still protects stored data."]}, indent=2) + "\n")
