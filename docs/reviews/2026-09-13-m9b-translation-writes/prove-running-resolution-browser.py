#!/usr/bin/env python3
"""Run actual browser/worker controls on the explicitly isolated local stack."""
import hashlib, json, subprocess, time
from pathlib import Path
root = Path(__file__).resolve().parents[3]
source = root / "openplan/src/lib/engagement/translation-generation-worker.ts"
runner = Path(__file__).with_name("translation-running-resolution-browser.cjs")
original = source.read_bytes()
needle = b'current.state !== "running" || '
assert original.count(needle) == 1
private = Path("/home/nathaniel/.local/state/openplan/response-write-probe-20260913") / ("running-resolution-controls-" + str(int(time.time())))
private.mkdir(mode=0o700)
results = []
try:
    for name, content, expected in [
        ("harmless-worker-comment", original + b"\n// Harmless running-resolution browser control.\n", 0),
        ("ignore-running-state-change", original.replace(needle, b""), 1),
    ]:
        assert source.read_bytes() == original
        source.write_bytes(content)
        log = private / (name + ".log")
        try:
            with log.open("w") as output:
                run = subprocess.run(["node", str(runner)], cwd=root, stdout=output, stderr=subprocess.STDOUT, timeout=240)
            text = log.read_text()
            assert run.returncode == expected, (name, run.returncode, str(log))
            if expected:
                assert 'Expected: "provider_abort_observed"' in text and 'Received: "provider_abort_not_observed"' in text, text[-3000:]
            results.append({"case": name, "outcome": "survived" if expected == 0 else "killed", "exit": run.returncode, "log": str(log), "logSha256": hashlib.sha256(log.read_bytes()).hexdigest()})
        finally:
            assert source.read_bytes() == content, "Concurrent source change; manual recovery required"
            source.write_bytes(original)
finally:
    assert source.read_bytes() == original
    Path(__file__).with_name("running-resolution-browser-controls.json").write_text(json.dumps({"sourceSha256": hashlib.sha256(original).hexdigest(), "runnerSha256": hashlib.sha256(runner.read_bytes()).hexdigest(), "results": results, "limits": "Actual SDK transport is synthetic and held locally. The targeted mutation removes only the worker status-state abort condition. This proves request closure reaches the active provider signal through the browser/API/database/worker; it does not prove live provider billing, arbitrary network failures or every copied archive assertion."}, indent=2) + "\n")
print(json.dumps(results))
