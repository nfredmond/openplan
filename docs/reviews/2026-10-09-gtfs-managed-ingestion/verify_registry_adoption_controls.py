"""Check adoption copy without treating saved results as absent or in use."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

root = Path(__file__).resolve().parents[3]
app = root / "openplan"
out = Path(sys.argv[1])
out.mkdir(mode=0o700, parents=True, exist_ok=False)
panel = app / "src/components/data-hub/gtfs-ingest-panel.tsx"
test = app / "src/test/gtfs-ingest-panel.test.tsx"
original = {p: p.read_bytes() for p in [panel, test]}
text = original[panel].decode()
not_adopted = "No version of this feed is in use. Review and adopt a completed version before using its service results."
unavailable = "Service details for the version in use are unavailable. Review the feed’s version history before using its results."


def replace(before, after):
    assert text.count(before) == 1, before
    return text.replace(before, after).encode()


variants = [
    ("baseline", {}, None),
    ("harmless", {p: data + b"\n// Harmless registry adoption control.\n" for p, data in original.items()}, None),
    ("false-no-results", {panel: replace(not_adopted, "No ingest of this feed has been adopted, so it derives no service levels yet.")}, "keeps an unadopted ready version"),
    ("raw-pending", {panel: replace('? "Not adopted"', '? "pending"')}, "keeps an unadopted pending version"),
    ("ignore-current-pointer", {panel: replace("{feed.current_version_id\n", "{false\n")}, "reports missing details for an adopted version"),
    ("missing-details-as-none", {panel: replace(unavailable, not_adopted)}, "reports missing details for an adopted version"),
    ("recent-as-current", {panel: replace("for (const version of registry.currentVersions)", "for (const version of registry.recentVersions)")}, "keeps an unadopted ready version"),
    ("failed-as-unadopted", {panel: replace('feed.status?.trim() === "pending" && !feed.current_version_id', '!feed.current_version_id')}, "preserves a failed feed status"),
    ("adopted-as-unadopted", {panel: replace('feed.status?.trim() === "pending" && !feed.current_version_id', 'feed.status?.trim() === "pending"')}, "reports missing details for an adopted version"),
    ("restored", {}, None),
]
records = []
try:
    for name, changes, expected in variants:
        for path, data in original.items():
            path.write_bytes(changes.get(path, data))
        report = out / (name + ".json")
        result = subprocess.run(
            [str(app / "node_modules/.bin/vitest"), "run", "src/test/gtfs-ingest-panel.test.tsx", "--maxWorkers=1", "--reporter=json", "--outputFile=" + str(report)],
            cwd=app, capture_output=True, text=True, timeout=60,
        )
        (out / (name + ".log")).write_text(result.stdout + result.stderr)
        data = json.loads(report.read_text())
        failures = [t["fullName"] for s in data["testResults"] for t in s["assertionResults"] if t["status"] == "failed"]
        if expected:
            assert result.returncode != 0 and any(expected in f for f in failures), (name, failures)
        else:
            assert result.returncode == 0 and not failures, (name, failures)
        records.append({"variant": name, "result": "expected assertion failure" if expected else "pass", "failedAssertions": failures, "passedTests": data["numPassedTests"], "failedTests": data["numFailedTests"]})
        print(name, records[-1]["result"], flush=True)
finally:
    for path, data in original.items():
        path.write_bytes(data)

assert all(path.read_bytes() == data for path, data in original.items())
(out / "controls.json").write_text(json.dumps({"variants": records, "restoredSha256": {str(p.relative_to(root)): hashlib.sha256(data).hexdigest() for p, data in original.items()}, "boundary": "Rendered jsdom registry with mocked API responses. No native database, browser, adoption action or provider operation acceptance."}, indent=2) + "\n")
