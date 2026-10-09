"""Run owned live-scope controls serially and restore exact production bytes."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[4]
WORKER = ROOT / "workers/aequilibrae_worker"
path = WORKER / "model_engine_supervision.py"
original = path.read_bytes()
source = original.decode()
cases = [
    ("harmless", source + "\n# Harmless swap-policy control.\n", None),
    ("unlimited-swap", source.replace("--property=MemorySwapMax=0", "--property=MemorySwapMax=infinity"), "Scope resource policy differs"),
    ("accept-wrong-policy", source.replace(" or state.get('MemorySwapMax')!='0'", ""), "ValueError not raised"),
    ("restored", source, None),
]
records = []
try:
    for name, body, expected in cases:
        if expected:
            assert body != source
        path.write_text(body)
        result = subprocess.run([
            sys.executable, "-B", "-m", "unittest", "-v",
            "test_model_engine_supervision.LiveEngineScopeTests.test_live_scope_disables_swap",
            "test_model_engine_supervision.LiveEngineScopeTests.test_unlimited_swap_refuses_engine_before_authorization",
        ], cwd=WORKER, env=dict(os.environ, OPENPLAN_LIVE_ENGINE_SCOPE="1"),
            capture_output=True, text=True, timeout=45)
        output = result.stdout + result.stderr
        if expected:
            assert result.returncode != 0 and expected in output, output
        else:
            assert result.returncode == 0, output
        records.append({"case": name, "verified": True, "returncode": result.returncode, "expected_failure": expected})
finally:
    path.write_bytes(original)
print(json.dumps({"cases": records, "source_sha256": hashlib.sha256(original).hexdigest(),
    "limits": ["Synthetic commands in owned live user scopes", "No memory exhaustion, native model, container, database or scientific acceptance"]}, indent=2))
