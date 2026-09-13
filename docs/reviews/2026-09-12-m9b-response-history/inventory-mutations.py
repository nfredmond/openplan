from pathlib import Path
import json
import os
import subprocess
import tempfile

review = Path(__file__).resolve().parent
app = review.parents[2] / "openplan"
source = app / "src/test/rls-isolation.test.ts"
original = source.read_text()
scratch = Path(tempfile.mkdtemp(prefix="openplan-history-inventory-"))
(scratch / source.name).write_text(original)
env = dict(os.environ, OPENPLAN_RLS_LIVE_TEST="1", OPENPLAN_SUPABASE_WORKDIR="/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050")
results = []
try:
 for name, text in [("harmless-comment", original + "\n// Harmless history inventory probe.\n"), ("invalid-history-projection", original.replace('select: "id,campaign_id,response_id,revision"', 'select: "id,workspace_id,response_id,revision"'))]:
  assert text != original
  source.write_text(text)
  run = subprocess.run(["node", "--env-file-if-exists=.env.local", "node_modules/vitest/vitest.mjs", "run", "src/test/rls-isolation.test.ts", "--reporter=json"], cwd=app, env=env, capture_output=True, text=True, timeout=120)
  (scratch / (name + ".json")).write_text(run.stdout)
  report = json.loads(run.stdout)
  failures = [{"name":a["fullName"],"message":"\n".join(a["failureMessages"])[:1200]} for f in report["testResults"] for a in f["assertionResults"] if a["status"]=="failed"]
  matched = run.returncode == 0 if name == "harmless-comment" else run.returncode != 0 and any("engagement_response_history member read error" in x["message"] and "column engagement_response_history." in x["message"] for x in failures)
  results.append({"name":name,"outcome":"survived" if run.returncode==0 else "killed","matched":matched,"failures":failures})
  (review / "inventory-mutations.json").write_text(json.dumps(results,indent=2)+"\n")
  print(name,results[-1]["outcome"],"matched="+str(matched),flush=True)
  if not matched: raise RuntimeError(run.stderr or str(failures))
finally:
 source.write_text(original)
print("Source restored; recovery copy at",scratch)
