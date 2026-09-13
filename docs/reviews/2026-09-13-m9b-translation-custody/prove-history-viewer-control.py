"""Keep the private history entry point aligned with the staff-only reader."""
from pathlib import Path
import json,subprocess
root=Path(__file__).resolve().parents[3];app=root/'openplan'
p=app/'src/components/engagement/campaign-translations-panel.tsx';original=p.read_text()
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/history-viewer-controls');private.mkdir(exist_ok=True)
needle='{canWrite ? <TranslationHistory campaignId={campaignId} revision={historyRevision} /> : null}'
assert needle in original
results=[]
try:
 for name,source,fault in [('baseline',original,None),('harmless-comment',original+'\n// Harmless history access comment.\n',None),('show-to-viewer',original.replace(needle,needle.replace('canWrite ?','true ?')),'false'),('hide-from-staff',original.replace(needle,needle.replace('canWrite ?','false ?')),'true')]:
  p.write_text(source);report=private/(name+'.json')
  run=subprocess.run(['node','node_modules/vitest/vitest.mjs','run','src/test/an-operator-can-author-a-campaigns-translations.test.tsx','-t','offers private translation history','--reporter=json','--outputFile='+str(report)],cwd=app,text=True,capture_output=True,timeout=60)
  d=json.loads(report.read_text());failed=[t['fullName'] for f in d['testResults'] for t in f['assertionResults'] if t['status']=='failed']
  matched=(run.returncode==0 and d['numPassedTests']==2) if fault is None else (run.returncode!=0 and any('staff access: '+fault in t for t in failed))
  results.append({'case':name,'matched':matched,'outcome':'survived' if run.returncode==0 else 'killed','failed':failed});assert matched,results[-1]
finally:p.write_text(original)
(Path(__file__).parent/'history-viewer-controls.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(results))
