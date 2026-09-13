"""Use a fresh successful baseline, then restore each demonstrated layout defect in Chrome."""
from pathlib import Path
import hashlib,json,os,subprocess,sys,time
review=Path(__file__).resolve().parent;root=review.parents[2]
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913')
baseline=Path(sys.argv[1]);data=json.loads(baseline.read_text())
assert data['passed'] and [row['width'] for row in data['results']]==[1440,900,390,320]
for name,expected in data['sourceHashes'].items():assert hashlib.sha256((root/name).read_bytes()).hexdigest()==expected
logs=private/'workspace-switch-controls'/time.strftime('%Y%m%dT%H%M%S');logs.mkdir(parents=True,exist_ok=False)
results=[{'case':'baseline','matched':True,'exit':0,'artifact':baseline.name}]
for mode,expected in [('harmless',None),('hidden','Workspace switch remains visible'),('clipped','Workspace menu target is reachable')]:
    before=set(private.glob('workspace-switch-'+mode+'-*-result.json'))|set(private.glob('workspace-switch-'+mode+'-*-failure.json'))
    run=subprocess.run(['node',str(review/'workspace-switch-browser.cjs')],cwd=root,env={**os.environ,'OPENPLAN_WORKSPACE_SWITCH_CONTROL':mode},capture_output=True,text=True,timeout=300)
    (logs/(mode+'.log')).write_text(run.stdout+run.stderr)
    after=(set(private.glob('workspace-switch-'+mode+'-*-result.json'))|set(private.glob('workspace-switch-'+mode+'-*-failure.json')))-before
    assert len(after)==1
    artifact=after.pop();detail=json.loads(artifact.read_text())
    matched=run.returncode==1 and expected in detail.get('message','') if expected else run.returncode==0 and detail.get('passed',False)
    results.append({'case':mode,'matched':matched,'exit':run.returncode,'expectedFailure':expected,'artifact':artifact.name})
    (review/'workspace-switch-browser-controls.json').write_text(json.dumps({'sourceHashes':data['sourceHashes'],'runnerSha256':hashlib.sha256((review/'workspace-switch-browser.cjs').read_bytes()).hexdigest(),'results':results,'limits':'Visible navigation and menu hit-testing at selected widths; injected CSS reproduces hidden/clipped controls. Does not establish every global header layout, permission guard or production performance.'},indent=2)+'\n')
    print(mode,'expected outcome' if matched else 'UNEXPECTED',flush=True);assert matched,mode
