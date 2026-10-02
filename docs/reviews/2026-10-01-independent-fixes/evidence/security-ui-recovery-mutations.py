from pathlib import Path
import hashlib, json, subprocess
ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "openplan"
EVIDENCE = Path(__file__).resolve().parent
HELPER = APP / "src/lib/auth/callback-destination.ts"
PORTAL = APP / "src/app/(portal)/error.tsx"
originals = {p: p.read_text() for p in [HELPER, PORTAL]}
cases = [
 ("baseline", None, None, None, []),
 ("harmless-comment", HELPER, "const FALLBACK_PATH", "// Harmless recovery check control.\nconst FALLBACK_PATH", []),
 ("malformed-throws", HELPER, "    return fallback;", "    throw new Error(\"Malformed destination escaped fallback\");", ["falls back for a malformed destination"]),
 ("origin-guard-removed", HELPER, "return destination.origin === fallback.origin ? destination : fallback;", "return destination;", ["rejects an origin change"]),
 ("fragment-dropped", HELPER, "    return destination.origin", "    destination.hash = \"\";\n    return destination.origin", ["preserves a valid local query and fragment"]),
 ("receipt-asserted", PORTAL, "Please try loading this page again in a moment.", "Please try loading this page again in a moment. Anything you already sent was received.", ["offers a reload"]),
 ("cause-asserted", PORTAL, "Please try loading this page again in a moment.", "Please try loading this page again in a moment. The problem is on our side.", ["offers a reload"]),
 ("reload-disconnected", PORTAL, "onClick={() => window.location.reload()}", "onClick={() => {}}", ["offers a reload"]),
 ("reset-only", PORTAL, originals[PORTAL], originals[PORTAL].replace("  error,\n", "  error,\n  reset,\n").replace("onClick={() => window.location.reload()}", "onClick={reset}"), ["offers a reload"]),
]
results=[]
try:
 for name, path, old, new, expected in cases:
  for p, value in originals.items(): p.write_text(value)
  if path:
   assert originals[path].count(old)==1, (name,old)
   path.write_text(originals[path].replace(old,new))
  output=EVIDENCE / f"security-ui-recovery-{name}.json"
  proc=subprocess.run(["npx","vitest","run","src/test/auth-callback-destination.test.ts","src/test/portal-error-recovery.test.tsx","--reporter=json",f"--outputFile={output}"],cwd=APP,capture_output=True,text=True)
  report=json.loads(output.read_text())
  failures=[a for t in report['testResults'] for a in t['assertionResults'] if a['status']=='failed']
  if expected:
   assert proc.returncode != 0 and failures, (name,proc.returncode)
   for title in expected: assert any(title in a['fullName'] for a in failures),(name,title)
  else: assert proc.returncode==0 and not failures,(name,proc.stdout,proc.stderr)
  results.append({'case':name,'exit':proc.returncode,'passed':report['numPassedTests'],'failed':report['numFailedTests'],'failures':[{'title':a['fullName'],'messages':a['failureMessages']} for a in failures]})
  print(name,report['numPassedTests'],report['numFailedTests'],flush=True)
finally:
 for p,value in originals.items(): p.write_text(value)
 (EVIDENCE/'security-ui-recovery-mutations.json').write_text(json.dumps({'results':results,'restored':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in originals}},indent=2)+'\n')
