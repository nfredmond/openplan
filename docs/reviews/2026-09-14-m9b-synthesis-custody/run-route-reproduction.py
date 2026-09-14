"""Run a historical defect diagnostic with controlled counterexamples, restoring all source bytes."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

review = Path(__file__).resolve().parent
root = review.parents[2]
app = root / "openplan"
route = app / "src/app/api/engagement/campaigns/[campaignId]/synthesis/route.ts"
target = app / "src/test/engagement-synthesis-known-defects.test.ts"
if target.exists():
    raise SystemExit("Refusing to overwrite an existing test")
original = route.read_bytes()
source = original.decode()
variants = [
    ("baseline", source, 0, []),
    ("harmless-comment", "// Diagnostic harmless comment.\n" + source, 0, []),
    ("fetch-301-counterexample", source.replace(".limit(SYNTHESIS_MAX_ITEMS)", ".limit(SYNTHESIS_MAX_ITEMS + 1)"), 1, ["DEFECT: 301 approved sources"]),
    ("report-save-failure-counterexample", source.replace('audit.warn("engagement_synthesis_persist_failed", { campaignId, message: updateError.message });', 'audit.warn("engagement_synthesis_persist_failed", { campaignId, message: updateError.message });\n        return NextResponse.json({ error: "SYNTHETIC save failed" }, { status: 503 });'), 1, ["DEFECT: failed save"]),
]
results = []
try:
    target.write_bytes((review / "route-reproduction.test.ts").read_bytes())
    for name, text, expected, failures in variants:
        if name != "baseline" and text == source:
            raise RuntimeError(f"Mutation did not change source: {name}")
        route.write_text(text)
        result = subprocess.run(["npm", "exec", "--", "vitest", "run", str(target.relative_to(app)), "--reporter=json"], cwd=app, capture_output=True, text=True)
        output = json.loads(result.stdout[result.stdout.index("{"):])
        failed = [a["fullName"] for f in output["testResults"] for a in f["assertionResults"] if a["status"] == "failed"]
        record = {"name": name, "exitCode": result.returncode, "passed": output["numPassedTests"], "failed": failed}
        results.append(record)
        print(json.dumps(record), flush=True)
        if result.returncode != expected or len(failed) != len(failures) or any(not any(wanted in actual for actual in failed) for wanted in failures):
            print(result.stdout, result.stderr)
            raise RuntimeError(f"Unexpected diagnostic outcome: {name}")
finally:
    route.write_bytes(original)
    target.unlink()
    if route.read_bytes() != original:
        raise RuntimeError("Source restoration failed")
(review / "route-reproduction-results.json").write_text(json.dumps({
    "sourceSha256": hashlib.sha256(original).hexdigest(),
    "sourceRestored": True,
    "cases": results,
    "limits": "Historical defect characterization, not desired-behavior regression tests. Real POST handler and synthesis library with mocked database, authentication, integration context and model access. Query calls asserted; database truncation/update semantics simulated. No native database, RLS, browser, model quality or network telemetry proof. Counterexamples are diagnostic only and were restored; fetching 301 does not fix complete corpus coverage or retained review custody."
}, indent=2) + "\n")
