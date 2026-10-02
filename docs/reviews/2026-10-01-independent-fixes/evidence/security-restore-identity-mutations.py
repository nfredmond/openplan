from pathlib import Path
import hashlib, json, subprocess
ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "openplan"
EVIDENCE = Path(__file__).resolve().parent
paths = [APP / "src/test" / name for name in ["artifact-storage-writes-rls.test.ts", "measure-period-parent-migration.test.ts"]]
originals = {p: p.read_text() for p in paths}
needle = "  requireContractVerificationStack(container);"
cases = [("baseline", None, None, []), ("harmless-comment", paths[0], "  // Harmless stack check control.\n" + needle, [])]
for p in paths:
 label = p.stem
 cases.append((label + "-guard-removed", p, "  // Deliberately removed guard.", ["refuses"]))
 cases.append((label + "-restore-regression", p, "  if (/^supabase_db_openplan-restore-target-[1-9][0-9]*$/.test(container)) throw new Error(\"Restore target wrongly refused\");\n" + needle, ["dispatches the real probe only to approved supabase_db_openplan-restore-target"]))
results = []
try:
 for name, path, replacement, expected in cases:
  for p, source in originals.items(): p.write_text(source)
  if path:
   assert originals[path].count(needle) == 1
   path.write_text(originals[path].replace(needle, replacement))
  output = EVIDENCE / f"security-restore-identity-{name}.json"
  result = subprocess.run(["npx", "vitest", "run", "src/test/native-review-probe-stack-identity.test.ts", "--reporter=json", f"--outputFile={output}"], cwd=APP, capture_output=True, text=True)
  assert output.exists(), (name, result.stderr)
  report = json.loads(output.read_text())
  failures = [a for suite in report["testResults"] for a in suite["assertionResults"] if a["status"] == "failed"]
  if expected:
   assert result.returncode != 0 and failures, (name, result.returncode)
   for title in expected: assert any(title in a["fullName"] for a in failures), (name, title)
  else: assert result.returncode == 0 and not failures, (name, result.stdout, result.stderr)
  results.append({"case": name, "passed": report["numPassedTests"], "failed": report["numFailedTests"], "failures": [{"title": a["fullName"], "messages": a["failureMessages"]} for a in failures]})
  print(name, report["numPassedTests"], report["numFailedTests"], flush=True)
finally:
 for p, source in originals.items(): p.write_text(source)
 (EVIDENCE / "security-restore-identity-mutations.json").write_text(json.dumps({"results": results, "restored": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in originals}}, indent=2)+"\n")
