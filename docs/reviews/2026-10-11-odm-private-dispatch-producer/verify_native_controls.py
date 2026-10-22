"""Require intended SQL assertion failures, including a surviving control."""
import argparse
import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def accept_failure(exit_code, diagnostic, expected):
    reasons = ["Expected native refusal absent: ", "Refused scope became authorized: ", "Native actor check differs: "]
    assert exit_code == 1, "Expected native test exit"
    failures = [line for line in diagnostic.splitlines() if line.startswith("AssertionError: ")]
    assert len(failures) == 1, "Exactly one native assertion required"
    assert failures[0] in ["AssertionError: " + reason + expected for reason in reasons], "Expected native assertion boundary"
    assert "Wrong native SQL refusal" not in diagnostic, "Unrelated SQL refusal cannot prove the mutation"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("receipt", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(mode=0o700, parents=True, exist_ok=False)
    spec = importlib.util.spec_from_file_location("dispatch_native", HERE / "native_database.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    original = module.MIGRATION.read_bytes()
    rows = []

    def run(name, mutation=None):
        directory = out / (str(len(rows)) + "-" + name)
        command = [sys.executable, "-B", str(HERE / "native_database.py"), str(args.receipt.resolve()), str(directory)]
        if mutation:
            command.extend(["--mutation", mutation])
        result = subprocess.run(command, capture_output=True, timeout=90)
        (out / (name + "-private.log")).write_bytes(result.stdout + result.stderr)
        expected = module.MUTATIONS[mutation][2] if mutation else "survivor"
        if expected == "survivor":
            assert result.returncode == 0, name
            data = json.loads((directory / "native.json").read_text())
            observed = {item["name"] for item in data["observations"]}
            assert {value[2] for key, value in module.MUTATIONS.items() if key != "harmless"} <= observed, "Every selected boundary reached"
        else:
            diagnostic = result.stderr.decode()
            accept_failure(result.returncode, diagnostic, expected)
            assert not (directory / "native.json").exists(), (name, "Failed mutation cannot publish success")
        info = json.loads((directory / "container-before-stop.json").read_text())
        assert not info["oomKilled"], name
        assert module.MIGRATION.read_bytes() == original, "No source mutation"
        rows.append({"name": name, "result": "survived" if expected == "survivor" else "intended assertion failure", "assertion": expected})
        (out / "controls.json").write_text(json.dumps({"sourceSha256": hashlib.sha256(original).hexdigest(), "controls": rows,
            "scope": "Candidate functions replaced only within rolled-back native transactions. PostgreSQL scope/refusal checks, not PostgREST, caller authenticity, external revocation fences or full installation acceptance."}, indent=2) + "\n")
        print(name + ": " + rows[-1]["result"], flush=True)

    try:
        run("baseline")
        run("harmless", "harmless")
        for mutation in module.MUTATIONS:
            if mutation != "harmless":
                run(mutation, mutation)
        run("restored")
    finally:
        assert module.MIGRATION.read_bytes() == original


if __name__ == "__main__":
    main()
