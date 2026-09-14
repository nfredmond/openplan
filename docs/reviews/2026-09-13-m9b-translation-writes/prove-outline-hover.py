"""Restore the demonstrated hover defect, require real browser contrast failure,
then restore the corrected source. No database writes or permission changes.
"""
from pathlib import Path
import hashlib,json,os,subprocess,time
review=Path(__file__).resolve().parent;root=review.parents[2]
source=root/'openplan/src/components/ui/button.tsx';original=source.read_text()
old='hover:bg-[color:color-mix(in_srgb,var(--pine)_8%,var(--background))]'
new='hover:bg-[color:color-mix(in_srgb,var(--pine)_8%,white)]'
assert original.count(old)==1
mutated=original.replace(old,new)
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913')
label='restored-white-'+time.strftime('%Y%m%dT%H%M%S')
try:
 source.write_text(mutated)
 run=subprocess.run(['node',str(review/'outline-button-browser.cjs')],cwd=root,env={**os.environ,'OPENPLAN_OUTLINE_CONTROL':label},capture_output=True,text=True,timeout=240)
finally:
 assert source.read_text()==mutated,'Another source change occurred during the probe'
 source.write_text(original)
(private/(label+'.log')).write_text(run.stdout+run.stderr)
reports=list(private.glob('outline-button-'+label+'-*-result.json'));assert len(reports)==1
result=json.loads(reports[0].read_text())
assert run.returncode==1 and len(result['results'])==60 and len(result['failures'])==10
assert all(row['mode']=='dark' and row['state']=='hover' and row['ratio']<4.5 for row in result['failures'])
assert not any(e['type']=='pageerror' for e in result['events'])
script=review/'outline-button-browser.cjs'
assertion_line=next(i for i,line in enumerate(script.read_text().splitlines(),1) if "expect(failures,'Rendered outline text contrast" in line)
assert 'expect(received).toEqual(expected)' in run.stderr
assert f'{script}:{assertion_line}:' in run.stderr
assert source.read_text()==original
(review/'outline-hover-fault.json').write_text(json.dumps({'case':'restore-white-hover-background','outcome':'killed','sourceRestored':True,'sourceSha256':hashlib.sha256(original.encode()).hexdigest(),'mutantSha256':hashlib.sha256(mutated.encode()).hexdigest(),'scriptSha256':hashlib.sha256((review/'outline-button-browser.cjs').read_bytes()).hexdigest(),'privateResult':str(reports[0]),'measurementCount':len(result['results']),'failedMeasurements':[{k:r[k] for k in ['width','mode','palette','state','ratio']} for r in result['failures']],'limits':result['limits']},indent=2)+'\n')
print('Restored white hover failed all ten dark hover cases; corrected source restored',flush=True)
