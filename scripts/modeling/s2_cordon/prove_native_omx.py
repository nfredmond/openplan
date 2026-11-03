"""Mutation controls for the post-closure synthetic OMX diagnosis."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

source = Path(__file__).with_name("test_native_omx_contract.py").read_text()
changes = [
    ("harmless", "new synthetic data only", "fresh synthetic data only", 0),
    ("invalid_direct_read", 'loaded.matrix["travel_time"]', 'loaded.get_matrix("travel_time", copy=True)', 1),
    ("wrong_core_values", 'loaded.get_matrix("travel_time", copy=True), expected', 'loaded.get_matrix("travel_time", copy=True) * 0, expected', 1),
    ("wrong_index", "loaded.index, [101, 102]", "loaded.index, [102, 101]", 1),
]
results = []
with tempfile.TemporaryDirectory(prefix="s2-omx-controls-") as directory:
    for name, old, new, exit_code in changes + [("restored", "", "", 0)]:
        path = Path(directory) / (name + ".py")
        path.write_text(source if name == "restored" else source.replace(old, new))
        run = subprocess.run([sys.executable, "-B", str(path), "-v"], capture_output=True, text=True,
                             env={**os.environ, "PYTHONPYCACHEPREFIX": str(Path(directory) / name)})
        combined = run.stdout + run.stderr
        assert run.returncode == exit_code and (not exit_code or "FAIL: test_loaded_omx_requires_public_core_reader" in combined), combined
        results.append({"name": name, "exit_code": run.returncode,
                        "outcome": "survived" if run.returncode == 0 else "intended_failure",
                        "output_sha256": hashlib.sha256(combined.encode()).hexdigest()})
Path(sys.argv[1]).write_text(json.dumps({"synthetic_only": True, "frozen_evaluator_changed": False,
                                      "controls": results}, indent=2) + "\n")
print("Native OMX controls: 1 harmless survivor, 3 intended assertion failures, 1 restored pass")
