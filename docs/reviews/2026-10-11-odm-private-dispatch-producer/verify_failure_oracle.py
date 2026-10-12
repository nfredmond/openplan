"""Prove the native classifier rejects wrong exits, cases and extra failures."""
import argparse
import ast
import hashlib
import json
from pathlib import Path

SOURCE = Path(__file__).with_name("verify_native_controls.py")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    output = parser.parse_args().output.resolve()
    original = SOURCE.read_bytes()
    tree = ast.parse(original)
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "accept_failure")
    code = ast.get_source_segment(original.decode(), function)
    expected = "selected-native-boundary"
    diagnostic = "AssertionError: Refused scope became authorized: " + expected
    rows = []

    def run(name, source, arguments, refuses=False):
        scope = {}
        exec(source, scope)
        refusal = None
        try:
            scope["accept_failure"](*arguments)
        except AssertionError as error:
            refusal = str(error)
        assert bool(refusal) == refuses, (name, "Declared classifier outcome differs")
        rows.append({"name": name, "result": "refused" if refusal else "survived", "reason": refusal})

    good = (1, diagnostic, expected)
    run("baseline", code, good)
    run("harmless comment", "# Harmless oracle control.\n" + code, good)
    bad = [
        ("wrong exit", (2, diagnostic, expected), 'assert exit_code == 1, "Expected native test exit"'),
        ("extra assertion", (1, diagnostic + "\nAssertionError: Unrelated cleanup error", expected), 'assert len(failures) == 1, "Exactly one native assertion required"'),
        ("wrong test", (1, diagnostic, "different-boundary"), 'assert failures[0] in ["AssertionError: " + reason + expected for reason in reasons], "Expected native assertion boundary"'),
        ("unrelated SQL error", (1, diagnostic + "\nWrong native SQL refusal", expected), 'assert "Wrong native SQL refusal" not in diagnostic, "Unrelated SQL refusal cannot prove the mutation"'),
    ]
    for name, arguments, line in bad:
        run("protected " + name, code, arguments, True)
        assert code.count(line) == 1
        changed = code.replace(line, "pass # Deliberately omit this classifier guard.")
        run("broken " + name, changed, arguments)
        rows[-1]["result"] = "intended oracle failure"
    run("missing assertion", code, (1, "RuntimeError: infrastructure", expected), True)
    run("wrong assertion reason", code, (1, "AssertionError: Wrong native SQL refusal: " + expected, expected), True)
    run("restored", code, good)
    assert SOURCE.read_bytes() == original
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    output.write_text(json.dumps({"sourceSha256": hashlib.sha256(original).hexdigest(), "controls": rows,
        "scope": "Pure native failure classifier. No database or process operation."}, indent=2) + "\n")
    print(str(len(rows)) + " classifier controls behave as declared; source unchanged")


if __name__ == "__main__":
    main()
