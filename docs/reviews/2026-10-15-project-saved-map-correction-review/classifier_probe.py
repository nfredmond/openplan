"""Review exact controller Git bytes without running its source-mutating campaign."""
import ast
import hashlib
import json
from pathlib import Path
import subprocess

HEAD = "ffd21964f38fb9a391e26e89a4cb705d409af6f8"
PREFIX = "docs/reviews/2026-10-15-project-saved-map-correction/"


def raw(path, head=HEAD):
    return subprocess.check_output(["git", "show", head + ":" + path])


script = raw(PREFIX + "verify_controls.py").decode()


def load(text):
    namespace = {"__name__": "reviewed_controller", "__file__": str(Path(PREFIX + "verify_controls.py").resolve())}
    exec(compile(text, "exact-controller-in-memory", "exec"), namespace)
    return namespace


baseline = load(script)["check_classifier"]()
harmless = load(script.replace("Stack locations vary", "Stack paths vary"))["check_classifier"]()
assert harmless == baseline, "harmless classifier edit must survive all fixtures"
function, rest = script.split("def classifier_fixtures", 1)
mutations = next(ast.literal_eval(node.iter) for node in ast.walk(ast.parse(script))
                 if isinstance(node, ast.For) and isinstance(node.iter, ast.List)
                 and node.iter.elts and isinstance(node.iter.elts[0], ast.Tuple)
                 and isinstance(node.iter.elts[0].elts[0], ast.Constant)
                 and node.iter.elts[0].elts[0].value == "classifier-wrong-diagnostic")
faults = []
for name, old, new, fixture in mutations:
    assert function.count(old) == 1, "exact unique classifier anchor"
    modified = function.replace(old, new) + "def classifier_fixtures" + rest
    diagnostic = None
    try:
        load(modified)["check_classifier"](fixture)
    except AssertionError as error:
        diagnostic = str(error)
    assert diagnostic == "classifier-reject:" + fixture, "exact intended classifier failure"
    faults.append({"name": name, "fixture": fixture, "diagnostic": diagnostic})
assert load(script)["check_classifier"]() == baseline, "original classifier restored in memory"

controls = json.loads(raw(PREFIX + "controls.json"))
bindings = {path: hashlib.sha256(raw(path)).hexdigest() == digest
            for path, digest in controls["sourceBindings"].items()}
assert all(bindings.values()), "all current campaign bindings must match exact head"
manifest = json.loads(raw(PREFIX + "faults.json"))
record_by_name = {record["name"]: record for record in controls["records"]}
behavior_faults = []
for case in manifest:
    assert raw(case["path"]).decode().count(case["old"]) == 1, "current behavior anchor must be unique"
    record = record_by_name[case["name"]]
    actual = {item["name"]: item["diagnostics"][0] for item in record["failed"]}
    assert actual == case["expected"], "every retained fault must match exact named manifest diagnostic"
    assert record["exit"] == 1 and record["result"] == "intended assertion failure", "ordinary selected assertion exit"
    behavior_faults.append({"name": case["name"], "expectedAssertions": len(actual)})
for name in ["baseline", "harmless-comment", "restored"]:
    record = record_by_name[name]
    assert record["passed"] == 33 and record["exit"] == 0 and not record["failed"], "retained positive cohort"
checks = json.loads(raw(PREFIX + "checks.json"))
regression_bindings = {path: hashlib.sha256(raw(path)).hexdigest() == data["sha256"]
                       for path, data in checks["vitest"]["files"].items()}
assert all(regression_bindings.values()), "all retained regression file bindings"
history = json.loads(raw(PREFIX + "history-bindings.json"))
history_bindings = {path: hashlib.sha256(raw(PREFIX + "history/" + path)).hexdigest() == digest
                    for path, digest in history["originalHistorySha256"].items()}
assert all(history_bindings.values()), "all preserved history file bindings"
old_review_path = "docs/reviews/2026-10-15-project-saved-map-review/REVIEW.md"
assert raw(old_review_path, history["independentReviewCommit"]) == raw(PREFIX + "INDEPENDENT_REVIEW.md"), "independent review unchanged"
assert hashlib.sha256(raw(PREFIX + "INDEPENDENT_REVIEW.md")).hexdigest() == history["independentReviewSha256"], "independent review hash"
for filename in ["probe.mjs", "probe-result.json"]:
    assert raw("docs/reviews/2026-10-15-project-saved-map-review/" + filename, history["independentReviewCommit"]) == raw(PREFIX + filename), "original independent probe unchanged"

trials = []
for number in range(1, 5):
    trial = json.loads(raw(PREFIX + f"trial-{number:02d}.json"))
    assert trial["sourceRestored"] is True, "failed trial exact restoration"
    trials.append({"trial": number, "sourceRestored": True, "refused": [r["name"] for r in trial["records"] if r.get("result", "").startswith("classification refused")]})

print(json.dumps({"head": HEAD, "controllerSha256": hashlib.sha256(script.encode()).hexdigest(),
                  "liveClassifierFixtures": baseline, "harmlessClassifier": "survived", "liveClassifierFaults": faults,
                  "restoredClassifier": "survived", "campaignBindings": bindings, "behaviorFaults": behavior_faults,
                  "regressionBindings": regression_bindings, "historyBindings": history_bindings,
                  "independentReviewUnchanged": True, "trials": trials,
                  "limits": ["No application/Vitest campaign rerun", "Retained records checked against manifests and exact source bytes", "No Git source writes; classifier edits occur in memory"]}, indent=2))
