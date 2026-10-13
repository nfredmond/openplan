"""Require the selected scope refusal rather than another SQL failure."""
import argparse
import ast
import hashlib
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    output = parser.parse_args().output.resolve()
    source = Path(__file__).with_name("native_snapshot_locks.py")
    original = source.read_bytes()
    tree = ast.parse(original)
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "expect_refusal")
    code = ast.get_source_segment(original.decode(), function)
    detail = "Original aerial job or mission scope changed"
    diagnostic = "ERROR:  42501: " + detail
    cases = [("selected", 3, diagnostic + "\nCONTEXT: actual candidate function", True),
        ("success-exit", 0, diagnostic, False), ("wrong-exit", 1, diagnostic, False),
        ("later-payload", 3, "ERROR:  22023: Original aerial payload scope differs", False),
        ("wrong-detail", 3, "ERROR:  42501: Unrelated scope refusal", False),
        ("missing-error", 3, "CONTEXT: " + diagnostic, False),
        ("extra-error", 3, diagnostic + "\nERROR:  40P01: deadlock detected", False),
        ("empty", 3, "", False)]
    mutations = [("baseline", code, None), ("harmless", "# Harmless classifier comment.\n" + code, None),
        ("exit-removed", code.replace("exit_code == 3", "True"), "success-exit"),
        ("state-removed", code.replace('errors == ["ERROR:  42501: " + DETAIL]', 'len(errors) == 1'), "later-payload"),
        ("extra-error-accepted", code.replace('errors == ["ERROR:  42501: " + DETAIL]', '"ERROR:  42501: " + DETAIL in errors'), "extra-error"),
        ("restored", code, None)]
    rows = []
    for name, text, intended in mutations:
        scope = {"DETAIL": detail}
        exec(compile(text, "snapshot-oracle-control", "exec"), scope)
        failures = []
        for label, exit_code, message, expected in cases:
            try:
                scope["expect_refusal"](exit_code, message, "selected-field")
                accepted = True
            except AssertionError:
                accepted = False
            if accepted != expected:
                failures.append(label)
        if intended:
            assert intended in failures, "Intended snapshot oracle fault was not detected: " + name
        else:
            assert not failures, "Snapshot oracle outcome differs: " + name
        rows.append({"name": name, "result": "intended oracle failure: " + intended if intended else "survived"})
    assert source.read_bytes() == original
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    output.write_text(json.dumps({"sourceSha256": hashlib.sha256(original).hexdigest(), "cases": len(cases), "controls": rows,
        "scope": "In-memory scope-refusal classifier. Actual concurrent database proof remains separate."}, indent=2) + "\n")
    print(str(len(rows)) + " snapshot oracle controls against " + str(len(cases)) + " diagnostics; source unchanged")


if __name__ == "__main__":
    main()
