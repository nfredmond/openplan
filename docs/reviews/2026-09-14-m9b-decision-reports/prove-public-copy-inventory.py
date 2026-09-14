"""Prove the census notices a lost view without altering any installed schema."""
from pathlib import Path
import json,subprocess,time
REVIEW=Path(__file__).resolve().parent
APP=REVIEW.parents[2]/'openplan'
SOURCE=APP/'src/test/migrations/schema-inventory.ts'
original=SOURCE.read_text()
PRIVATE=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context')/('public-copy-inventory-'+str(time.time_ns()))
PRIVATE.mkdir()
old='views: () => [...viewNames].sort(),'
assert original.count(old)==1
cases=[('baseline',original,False),('harmless',original+'\n// Harmless inventory comment.\n',False),('omitted-public-view',original.replace(old,"views: () => [...viewNames].filter(name => name !== 'engagement_public_items').sort(),"),True)]
out=[]
for name,source,broken in cases:
 try:
  assert SOURCE.read_text()==original
  SOURCE.write_text(source)
  path=PRIVATE/(name+'.json')
  result=subprocess.run(['npm','exec','--','vitest','run','src/test/migrations/inventory.test.ts','--reporter=json','--outputFile='+str(path)],cwd=APP,text=True,capture_output=True,timeout=90)
  (PRIVATE/(name+'.log')).write_text(result.stdout+result.stderr)
  data=json.loads(path.read_text())
  assert data['numTotalTests']==29
  failed=[t['fullName'] for suite in data['testResults'] for t in suite['assertionResults'] if t['status']=='failed']
  if broken:
   assert result.returncode!=0 and len(failed)==2,failed
   assert any('reads every relation' in name for name in failed) and any("view's columns" in name for name in failed),failed
  else:assert result.returncode==0 and not failed,failed
  out.append({'name':name,'outcome':'killed' if broken else 'survived','failedTests':failed})
  print(name,out[-1]['outcome'],flush=True)
 finally:SOURCE.write_text(original)
(REVIEW/'public-copy-inventory-results.json').write_text(json.dumps({'outcomes':out,'privateEvidence':str(PRIVATE),'limit':'Source census proof, not an installed migration or live permission check.'},indent=2)+'\n')
