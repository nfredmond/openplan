"""Check the paged HTTP history mock and projection oracle in the owned checkout."""
from pathlib import Path
import json, subprocess
root = Path(__file__).resolve().parents[4]
app = root / "openplan"
out = Path(__file__).resolve().parent
source = app / "src/app/api/programs/[programId]/work-program/reimbursement/route.ts"
original = source.read_bytes()
results = []
try:
    for mode in ("harmless", "missing_snapshot_hash"):
        text = original.decode()
        changed = text + "\n// Harmless projection check.\n" if mode == "harmless" else text.replace("snapshot, snapshot_hash, issued_at", "snapshot, issued_at")
        assert changed != text
        source.write_text(changed)
        run = subprocess.run([str(app / "node_modules/.bin/vitest"), "run", "src/test/work-program-reimbursement-route.test.ts"], cwd=app, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        (out / f"reimbursement-{mode}.log").write_text(run.stdout)
        if mode == "harmless":
            assert run.returncode == 0
        else:
            assert run.returncode != 0 and "AssertionError" in run.stdout and "reads scoped finance history" in run.stdout and "snapshot_hash" in run.stdout
        results.append({"mode": mode, "exit": run.returncode, "result": "survived" if mode == "harmless" else "detected missing projection field"})
finally:
    source.write_bytes(original)
(out / "reimbursement-projection-mutations.json").write_text(json.dumps(results, indent=2) + "\n")
print(json.dumps(results))
