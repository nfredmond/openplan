"""Run command-level build controls and restore the original package bytes."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys


root = Path(__file__).resolve().parents[3]
app = root / "openplan"
package = app / "package.json"
output = Path(sys.argv[1]).resolve()
output.mkdir(parents=True, exist_ok=False)
original = package.read_bytes()
data = json.loads(original)
command = data["scripts"]["build"]
test_file = "src/test/build-respects-operator-memory.test.ts"
test_path = app / test_file
original_test = test_path.read_bytes()
records = []


def run(name, variant, expected_failure=None, test_variant=None):
    package.write_text(json.dumps(variant, indent=2) + "\n")
    test_path.write_bytes(original_test if test_variant is None else test_variant.encode())
    report = output / (name + ".json")
    result = subprocess.run([
        str(app / "node_modules/.bin/vitest"), "run", test_file,
        "--maxWorkers=1", "--no-file-parallelism", "--reporter=json",
        "--outputFile=" + str(report),
    ], cwd=app, capture_output=True, text=True, timeout=90)
    (output / (name + ".log")).write_text(result.stdout + result.stderr)
    parsed = json.loads(report.read_text())
    failed = [
        case["fullName"] for suite in parsed["testResults"]
        for case in suite["assertionResults"] if case["status"] == "failed"
    ]
    if expected_failure:
        assert result.returncode != 0 and any(expected_failure in case for case in failed), (name, failed)
    else:
        assert result.returncode == 0 and parsed["numPassedTests"] == 5 and not failed, name
    records.append({"name": name, "exitCode": result.returncode,
                    "expectedFailure": expected_failure, "failedTests": failed})


try:
    run("baseline", json.loads(original))
    harmless = json.loads(original)
    harmless["description"] = "Command probe with an unchanged build invocation."
    run("harmless", harmless)
    variants = [
        ("lost-default", 'NODE_OPTIONS="$NODE_OPTIONS" next build --webpack', "retains the default heap"),
        ("override-operator", 'NODE_OPTIONS="$NODE_OPTIONS --max-old-space-size=6144" next build --webpack', "passes the operator heap"),
        ("drop-operator-options", 'NODE_OPTIONS="--max-old-space-size=768" next build --webpack', "preserves the operator's complete options"),
        ("drop-webpack", command.replace(" --webpack", ""), "preserves the operator's complete options"),
        ("hide-compiler-failure", command + "; exit 0", "returns a failed compiler's exit status"),
    ]
    for name, broken, expected in variants:
        variant = json.loads(original)
        variant["scripts"]["build"] = broken
        run(name, variant, expected)
    test_text = original_test.decode()
    runtime_variants = [
        ("child-cli-overrides-heap", "#!/usr/bin/env node", "#!/usr/bin/env -S node --max-old-space-size=6144", "passes the operator heap"),
        ("wrong-child-executable", "executable: process.execPath", 'executable: "/wrong/runtime"', "passes the operator heap"),
        ("wrong-independent-reference", "--max-old-space-size=${oldSpaceMiB}", "--max-old-space-size=8192", "retains the default heap"),
        ("nonfinite-reference", "Number(result.stdout.trim())", 'Number("not-a-number")', "retains the default heap"),
        ("reference-command-fails", "--max-old-space-size=${oldSpaceMiB}", "--openplan-invalid-reference-flag", "retains the default heap"),
        ("undersized-reference", "--max-old-space-size=${oldSpaceMiB}", "--max-old-space-size=64", "retains the default heap"),
        ("wrong-semi-space-reference", '--max-semi-space-size=64"]', '--max-semi-space-size=4"]', "preserves the operator's complete options"),
    ]
    for name, before, after, expected in runtime_variants:
        assert test_text.count(before) == 1, (name, "mutation target differs")
        run(name, json.loads(original), expected, test_text.replace(before, after, 1))
    run("restored", json.loads(original))
finally:
    package.write_bytes(original)
    test_path.write_bytes(original_test)
    assert package.read_bytes() == original
    assert test_path.read_bytes() == original_test

summary = {
    "records": records,
    "restoredPackageSha256": hashlib.sha256(original).hexdigest(),
    "testSha256": hashlib.sha256((app / test_file).read_bytes()).hexdigest(),
    "boundary": "Actual npm shell invocation and real child V8 heap. Next is replaced by a small executable. No webpack capacity, total process memory, browser, CI or release acceptance.",
}
(output / "controls.json").write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps({"positiveControls": 3, "brokenControls": 12, "restored": True}))
