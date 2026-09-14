"""Check real access journeys and prove the browser assertions reject leaked bodies.

Fault cases inject synthetic leakage into browser responses, not the database or
application guards. Existing installed RLS controls test those separate boundaries.
Only the named isolated stack and synthetic UI accounts are used by the child.
"""
from pathlib import Path
import hashlib,json,os,re,subprocess,time
review=Path(__file__).resolve().parent
root=review.parents[2]
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913')
logs=private/'translation-access-controls'/time.strftime('%Y%m%dT%H%M%S')
logs.mkdir(parents=True,exist_ok=False)
results=[]
for mode,expected in [('baseline',None),('harmless',None),('viewer-history-leak','Viewer refusal contains no private history'),('outsider-snapshot-leak','Outsider refusal contains no campaign snapshot')]:
    env={**os.environ,'OPENPLAN_TRANSLATION_ACCESS_PROBE':'1','OPENPLAN_TRANSLATION_ACCESS_CONTROL':mode}
    env.pop('OPENPLAN_TRANSLATION_CLEANUP_PROBE',None)
    run=subprocess.run(['python3',str(review/'run-translation-editor-browser.py')],cwd=root,env=env,capture_output=True,text=True,timeout=600)
    (logs/(mode+'.log')).write_text(run.stdout+run.stderr)
    prefixes=re.findall(r'Checking translation access 1440 (.+)',run.stdout)
    if not prefixes: raise RuntimeError('Access runner did not reach its role checks; inspect private log')
    prefix=Path(prefixes[0]);cleanup=json.loads((private/'translation-editor-installed-permissions-access-journey.json').read_text())
    matched=run.returncode==1 and expected in run.stderr if expected else run.returncode==0
    if expected:
        detail=json.loads(Path(str(prefix)+'-failure.json').read_text());matched=matched and expected in detail['message']
    else:
        result=Path(str(prefix)+'-result.json')
        detail=json.loads(result.read_text()) if result.exists() else {}
        matched=matched and detail.get('passed',False) and [r['width'] for r in detail.get('results',[])]==[1440,390]
    matched=matched and cleanup['installedPermissionsPreserved'] and cleanup['childExit']==run.returncode
    results.append({'case':mode,'expectedFailure':expected,'exit':run.returncode,'matched':matched,'installedPermissionsPreserved':cleanup['installedPermissionsPreserved'],'artifactPrefix':prefix.name})
    (review/'translation-access-browser-controls.json').write_text(json.dumps({'sourceSha256':{name:hashlib.sha256((review/name).read_bytes()).hexdigest() for name in ['translation-access-browser.cjs','run-translation-editor-browser.py']},'results':results,'limits':'Faults inject response bodies to prove browser refusal assertions. They do not mutate application authorization or substitute for installed RLS controls.'},indent=2)+'\n')
    print(mode,'expected outcome' if matched else 'UNEXPECTED',flush=True)
    assert matched,mode
