from pathlib import Path
import json
import subprocess

root = Path(__file__).resolve().parent
original = (root / "m9b-response-write-gap.sql").read_text()
needle = "WHERE id=e.id AND campaign_id=e.campaign_id;"
at = original.rindex(needle)
guarded = original[:at] + original[at:].replace(needle, "WHERE id=e.id AND campaign_id=e.campaign_id AND updated_at=e.updated_at;", 1)
results = []
for name, sql in [("harmless-comment", original + "\n-- Harmless probe control.\n"), ("reject-stale-version", guarded)]:
    run = subprocess.run(["docker", "exec", "-i", "supabase_db_openplan-restore-target-2026091050", "psql", "-U", "postgres", "-d", "postgres", "-X"], input=sql, text=True, capture_output=True)
    expected = run.returncode == 0 if name == "harmless-comment" else run.returncode != 0 and "Expected current stale overwrite was not reproduced" in run.stderr
    results.append({"name": name, "exitCode": run.returncode, "outcome": "survived" if run.returncode == 0 else "killed", "matched": expected, "stderr": run.stderr})
    if not expected:
        raise RuntimeError(f"Unexpected probe result: {name}")
(root / "write-gap-mutations.json").write_text(json.dumps(results, indent=2) + "\n")
print("Harmless probe survived; the stale-version predicate killed the overwrite reproduction")
