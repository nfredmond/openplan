"""Prove isolated native-read guards without Docker or database access."""
import ast
import copy
import hashlib
import json
import sys
from pathlib import Path


source = Path(__file__).with_name("verify_light_mode_browser.py")
tree = ast.parse(source.read_text())
constant = next(node for node in tree.body if isinstance(node, ast.Assign) and node.targets[0].id == "CONTAINER")
functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in {"verify_native_scope", "verify_native_stable"}]
namespace = {}
exec(compile(ast.Module(body=[constant, *functions], type_ignores=[]), str(source), "exec"), namespace)
scope = namespace["verify_native_scope"]
stable = namespace["verify_native_stable"]
settings = {"database": "openplan_recovered_2553c3e83129432e86c97cf3aef72aee", "sourceDatabase": "openplan_attempt_cli_9cb007ca9ecc4e81af6f6b5b55603391"}
container = {"Id": namespace["CONTAINER"], "Name": "/supabase_db_openplan-restore-target-2026091050", "Config": {"Labels": {"com.supabase.cli.project": "openplan-restore-target-2026091050"}}, "State": {"Running": True}}
records = []
for label in ["baseline", "harmless", "restored"]:
    config, info = copy.deepcopy(settings), copy.deepcopy(container)
    if label == "harmless":
        info["Config"]["Labels"]["reviewerNote"] = "Unrelated label"
    scope(config, info)
    stable({"runs": 0}, {"runs": 0})
    records.append({"case": label, "passed": True})

variants = [
    ("isolated-database-scope", lambda config, info: config.update(database="postgres")),
    ("isolated-source-scope", lambda config, info: config.update(sourceDatabase="postgres")),
    ("isolated-container-identity", lambda config, info: info.update(Id="other")),
    ("isolated-container-name", lambda config, info: info.update(Name="/supabase_db_other")),
    ("isolated-container-project", lambda config, info: info["Config"]["Labels"].update({"com.supabase.cli.project": "other"})),
    ("isolated-container-running", lambda config, info: info["State"].update(Running=False)),
]
for expected, mutate in variants:
    config, info = copy.deepcopy(settings), copy.deepcopy(container)
    mutate(config, info)
    try:
        scope(config, info)
    except AssertionError as error:
        assert str(error) == expected
    else:
        raise AssertionError(expected + " survived")
    broken = copy.deepcopy(next(node for node in functions if node.name == "verify_native_scope"))
    broken.body = [node for node in broken.body if not (isinstance(node, ast.Assert) and isinstance(node.msg, ast.Constant) and node.msg.value == expected)]
    changed = {}
    exec(compile(ast.Module(body=[constant, broken], type_ignores=[]), str(source), "exec"), changed)
    changed["verify_native_scope"](config, info)
    records.append({"case": expected, "refused": True, "omittedGuardAcceptsBrokenFixture": True})
    scope(settings, container)

try:
    stable({"runs": 0}, {"runs": 1})
except AssertionError as error:
    assert str(error) == "native-records-changed-during-controls"
else:
    raise AssertionError("Changed native records survived")
broken_stability = copy.deepcopy(next(node for node in functions if node.name == "verify_native_stable"))
broken_stability.body = [ast.Pass(lineno=1, col_offset=0)]
changed = {}
exec(compile(ast.Module(body=[broken_stability], type_ignores=[]), str(source), "exec"), changed)
changed["verify_native_stable"]({"runs": 0}, {"runs": 1})
stable({"runs": 0}, {"runs": 0})
records.append({"case": "native-records-changed-during-controls", "refused": True, "omittedGuardAcceptsBrokenFixture": True})

report = {"sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(), "records": records, "limit": "Extracted guard controls alter in-memory copies. No Docker, database, app or capture writes."}
Path(sys.argv[1]).write_text(json.dumps(report, indent=2) + "\n")
print("Three positive, seven refusals and seven omitted-guard controls pass.")
