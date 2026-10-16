"""Serial, source-restoring controls. Run inside a 1 GiB, zero-swap scope.

The history controller remains unmodified and is not an exact-diagnostic guard.
This controller accepts only declared assertion names and exact first-line
diagnostics. Stack locations vary by checkout; they are retained privately.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

PROOF = Path(__file__).resolve().parent
ROOT = PROOF.parents[2]
APP = ROOT / "openplan"


class Refused(Exception):
    pass


def classify(report, exit_code, expected, runner_output=""):
    """Reject failures outside the declared assertion and diagnostic boundary."""
    if exit_code != 1 or report.get("success") is not False:
        raise Refused("not an ordinary test failure")
    if report.get("numRuntimeErrorTestSuites", 0) or report.get("unhandledErrors", []):
        raise Refused("runtime errors")
    if any(marker in runner_output for marker in ["Unhandled Errors", "Unhandled Rejection", "Uncaught Exception", "Transform failed", "Failed to resolve import", "Cannot find module"]):
        raise Refused("runtime/import/compiler runner output")
    suites = report.get("testResults", [])
    if not suites or any(suite.get("message") for suite in suites):
        raise Refused("suite/import/compiler failure")
    if any(s.get("testExecError") or s.get("failureMessage") or (s.get("status") == "failed" and not any(a.get("status") == "failed" for a in s.get("assertionResults", []))) for s in suites):
        raise Refused("failed suite without attributable assertions")
    assertions = [a for suite in suites for a in suite.get("assertionResults", [])]
    failed = [a for a in assertions if a.get("status") == "failed"]
    if len(failed) != len(expected) or {a.get("fullName") for a in failed} != set(expected):
        raise Refused("unexpected assertion names")
    if report.get("numFailedTests") != len(failed):
        raise Refused("inconsistent failure count")
    for assertion, expected_diagnostic in zip(sorted(failed, key=lambda a: a["fullName"]), [expected[name] for name in sorted(expected)]):
        messages = assertion.get("failureMessages", [])
        if len(messages) != 1:
            raise Refused("multiple or missing diagnostics")
        diagnostic = messages[0].splitlines()[0]
        if diagnostic != expected_diagnostic:
            raise Refused("unexpected assertion diagnostic")
    return "intended assertion failure"


def classifier_fixtures():
    name = "declared test"
    diagnostic = "AssertionError: declared-camera: expected 360 to be 0.6"
    good = {"success": False, "numFailedTests": 1, "testResults": [{"message": "", "assertionResults": [
        {"fullName": name, "status": "failed", "failureMessages": [diagnostic + "\n    at portable:1"]},
    ]}]}
    expected = {name: diagnostic}
    fixtures = [("declared-assertion", good, 1, False, "")]
    def fault(label, edit, exit_code=1):
        report = copy.deepcopy(good)
        edit(report)
        fixtures.append((label, report, exit_code, True, ""))
    fault("unrelated-assertion", lambda r: r["testResults"][0]["assertionResults"][0].update(failureMessages=["AssertionError: unrelated-camera: expected 360 to be 0.6"]))
    fault("runtime-in-selected-test", lambda r: r["testResults"][0]["assertionResults"][0].update(failureMessages=["TypeError: declared-camera: expected 360 to be 0.6"]))
    fault("different-test", lambda r: r["testResults"][0]["assertionResults"][0].update(fullName="unrelated test"))
    fault("runtime-suite", lambda r: r.update(numRuntimeErrorTestSuites=1))
    fault("unhandled-runtime", lambda r: r.update(unhandledErrors=["unhandled rejection"]))
    fault("import-failure", lambda r: r["testResults"][0].update(message="Cannot find module"))
    fault("compiler-failure", lambda r: r["testResults"][0].update(message="Transform failed with 1 error"))
    fault("empty-failed-suite", lambda r: r["testResults"].append({"status": "failed", "message": "", "assertionResults": []}))
    fault("signal-exit", lambda r: None, -9)
    fault("inconsistent-count", lambda r: r.update(numFailedTests=2))
    fault("multiple-diagnostics", lambda r: r["testResults"][0]["assertionResults"][0]["failureMessages"].append(diagnostic))
    fault("missing-diagnostic", lambda r: r["testResults"][0]["assertionResults"][0].update(failureMessages=[]))
    fixtures.append(("unhandled-runner-output", copy.deepcopy(good), 1, True, "Unhandled Errors: synthetic rejection"))
    return fixtures, expected


def check_classifier(selected=None):
    fixtures, expected = classifier_fixtures()
    records = []
    for label, report, exit_code, should_refuse, runner_output in fixtures:
        if selected and label != selected:
            continue
        try:
            classify(report, exit_code, expected, runner_output)
            refused = False
        except Refused:
            refused = True
        if refused != should_refuse:
            raise AssertionError("classifier-reject:" + label)
        records.append({"name": label, "result": "refused" if refused else "accepted intended assertion"})
    assert records, "classifier fixture must exist"
    return records


def resource_limits():
    path = Path("/sys/fs/cgroup") / Path("/proc/self/cgroup").read_text().strip().split("::", 1)[1].lstrip("/")
    maximum = (path / "memory.max").read_text().strip()
    swap = (path / "memory.swap.max").read_text().strip()
    if maximum != "1073741824" or swap != "0":
        raise Refused("run inside MemoryMax=1G MemorySwapMax=0 scope")
    return {"cgroup": str(path), "memoryMax": maximum, "swapMax": swap, "cpuMax": (path / "cpu.max").read_text().strip()}


def campaign(output):
    resources = resource_limits()
    output.mkdir(parents=True, exist_ok=False)
    cases = json.loads((PROOF / "faults.json").read_text())
    paths = {ROOT / case["path"] for case in cases}
    paths.add(Path(__file__).resolve())
    originals = {p: p.read_bytes() for p in paths}
    records = []
    refused_cases = []
    script = Path(__file__).resolve()
    def run(name, case=None):
        report_path = output / (name + ".json")
        files = [case["testFile"]] if case else ["src/test/project-saved-map.test.tsx", "src/test/saved-geometry-frame.test.ts"]
        command = [str(APP / "node_modules/.bin/vitest"), "run", *files, "--maxWorkers=1", "--no-file-parallelism", "--cache=false", "--reporter=json", "--outputFile=" + str(report_path)]
        if case:
            command += ["--testNamePattern", case["pattern"]]
        completed = subprocess.run(command, cwd=APP, env={**os.environ, "NODE_OPTIONS": "--max-old-space-size=640"}, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=60)
        (output / (name + ".log")).write_text(completed.stdout)
        report = json.loads(report_path.read_text())
        failed = [a for suite in report["testResults"] for a in suite["assertionResults"] if a["status"] == "failed"]
        record = {"name": name, "exit": completed.returncode, "passed": report["numPassedTests"], "failed": [
            {"name": a["fullName"], "diagnostics": [m.splitlines()[0] for m in a["failureMessages"]]} for a in failed
        ]}
        records.append(record)
        if case:
            record["expected"] = case["expected"]
            record["result"] = classify(report, completed.returncode, case["expected"], completed.stdout)
        else:
            if completed.returncode != 0 or report.get("success") is not True or report["numPassedTests"] != 33 or failed:
                raise Refused("positive cohort did not pass all 33 cases")
            record["result"] = "survived"
        print(name + ": " + record["result"], flush=True)
    def restore():
        for path, original in originals.items():
            path.write_bytes(original)
    try:
        classifier_records = check_classifier()
        # The controller must survive a harmless edit and reject its own faulty classifiers.
        original = originals[script].decode()
        script.write_text(original.replace("Stack locations vary", "Stack paths vary"))
        child = subprocess.run([sys.executable, "-B", str(script), "--classifier-check"], capture_output=True, text=True)
        if child.returncode != 0:
            raise Refused("harmless classifier edit did not survive")
        records.append({"name": "classifier-harmless", "result": "survived"})
        restore()
        for name, old, new, fixture in [
            ("classifier-wrong-diagnostic", 'if diagnostic != expected_diagnostic:', 'if False:', "unrelated-assertion"),
            ("classifier-wrong-name", 'if len(failed) != len(expected) or {a.get("fullName") for a in failed} != set(expected):', 'if False:', "different-test"),
            ("classifier-runtime", 'if report.get("numRuntimeErrorTestSuites", 0) or report.get("unhandledErrors", []):', 'if False:', "runtime-suite"),
            ("classifier-runner-output", 'if any(marker in runner_output for marker in ["Unhandled Errors", "Unhandled Rejection", "Uncaught Exception", "Transform failed", "Failed to resolve import", "Cannot find module"]):', 'if False:', "unhandled-runner-output"),
            ("classifier-suite-error", 'if not suites or any(suite.get("message") for suite in suites):', 'if False:', "compiler-failure"),
            ("classifier-unattributed-suite", 'if any(s.get("testExecError") or s.get("failureMessage") or (s.get("status") == "failed" and not any(a.get("status") == "failed" for a in s.get("assertionResults", []))) for s in suites):', 'if False:', "empty-failed-suite"),
            ("classifier-exit", 'if exit_code != 1 or report.get("success") is not False:', 'if False:', "signal-exit"),
            ("classifier-count", 'if report.get("numFailedTests") != len(failed):', 'if False:', "inconsistent-count"),
            ("classifier-messages", 'if len(messages) != 1:', 'if False:', "multiple-diagnostics"),
        ]:
            try:
                # Replace the function guard, excluding the mutation declaration itself.
                function, rest = original.split("def classifier_fixtures", 1)
                if function.count(old) != 1:
                    raise Refused("classifier mutation anchor is not unique")
                script.write_text(function.replace(old, new) + "def classifier_fixtures" + rest)
                child = subprocess.run([sys.executable, "-B", str(script), "--classifier-check", fixture], capture_output=True, text=True)
                expected_error = "AssertionError: classifier-reject:" + fixture
                if child.returncode != 1 or child.stderr.splitlines()[-1:] != [expected_error]:
                    raise Refused("classifier fault did not fail the named assertion: " + child.stderr)
                records.append({"name": name, "result": "intended classifier assertion failure", "diagnostic": expected_error})
            finally:
                restore()
        run("baseline")
        renderer = ROOT / "openplan/src/components/projects/project-saved-map.tsx"
        try:
            renderer.write_bytes(originals[renderer].replace(b"Draw the validated project-record features", b"Display the validated project-record features"))
            run("harmless-comment")
        finally:
            restore()
        for case in cases:
            try:
                path = ROOT / case["path"]
                source = originals[path].decode()
                if source.count(case["old"]) != 1:
                    raise Refused("mutation anchor is not unique: " + case["name"])
                path.write_text(source.replace(case["old"], case["new"]))
                try:
                    run(case["name"], case)
                except Refused as error:
                    records[-1]["result"] = "classification refused: " + str(error)
                    refused_cases.append(case["name"])
                    print(case["name"] + ": REFUSED " + str(error), flush=True)
            finally:
                restore()
        run("restored")
        if refused_cases:
            raise Refused("campaign has refused classifications: " + ", ".join(refused_cases))
    finally:
        restore()
        bound = paths | {ROOT / path for path in [
            "openplan/src/test/project-saved-map.test.tsx", "openplan/src/test/saved-geometry-frame.test.ts",
            "openplan/src/lib/geo/wgs84-bounds.ts", "openplan/src/lib/cartographic/geometry-bbox.ts",
            "openplan/src/lib/projects/project-geopackage.ts", "openplan/src/lib/maps/when-style-accepts.ts",
            "openplan/src/lib/maps/map-engine.ts", "openplan/src/lib/mapbox/keep-map-sized.ts",
        ]} | {PROOF / "faults.json"}
        cgroup = Path(resources["cgroup"])
        resources.update({key: (cgroup / key).read_text().strip() for key in ["memory.peak", "memory.swap.peak", "memory.events"]})
        summary = {"gitHead": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
                   "records": records, "classifierFixtures": locals().get("classifier_records", []), "sourceRestored": all(p.read_bytes() == b for p, b in originals.items()),
                   "sourceBindings": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(bound)}, "resources": resources,
                   "blindCategories": ["WebGL/projection/tessellation", "real layout, keyboard and accessibility", "identified-build desktop/exact390 browser", "live database and downloaded export byte parity", "topology, survey/legal and practitioner acceptance"]}
        (output / "controls.json").write_text(json.dumps(summary, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--classifier-check", nargs="?", const="all")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.classifier_check:
        print(json.dumps(check_classifier(None if args.classifier_check == "all" else args.classifier_check)))
    elif args.output:
        campaign(args.output.resolve())
    else:
        parser.error("provide --output NEW_DIRECTORY or --classifier-check [FIXTURE]")
