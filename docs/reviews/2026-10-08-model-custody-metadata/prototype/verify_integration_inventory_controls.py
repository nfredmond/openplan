"""Keep exact inventory guards while reconciling the member-read migration."""
import hashlib,json,os,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
app=ROOT/'openplan'
paths={
 'policy':app/'src/test/migrations/inventory.test.ts',
 'rls':app/'src/test/rls-isolation.test.ts',
 'columns':app/'src/test/a-column-nothing-reads-is-a-question.test.ts',
 'release':ROOT/'CHANGELOG.md',
}
original={name:path.read_text() for name,path in paths.items()}
tests=['src/test/migrations/inventory.test.ts','src/test/rls-isolation.test.ts','src/test/a-column-nothing-reads-is-a-question.test.ts','src/test/migrations/release-ordering.test.ts']
output=Path(os.environ['OPENPLAN_INVENTORY_CONTROLS'])
output.mkdir(mode=0o700,parents=True,exist_ok=False)
entry=next(line for line in original['columns'].splitlines(True) if 'column: "model_legacy_artifact_receipts.artifact_id"' in line)
checks=[
 ('harmless',None,None,None,None),
 ('wrong-policy-count','policy','policies: 759','policies: 758','have a length of 758'),
 ('missing-probe-inventory','rls','expect([...DEDICATED_LIVE_RLS_PROBES]).toEqual([\n      "model_attempt_instrument_custody",','expect([...DEDICATED_LIVE_RLS_PROBES]).toEqual([','model_attempt_instrument_custody'),
 ('stale-unread-exception','columns','const NAME_COLLISIONS = [\n'+entry,'const NAME_COLLISIONS = [\n','these columns are now read'),
 ('missing-migration-note','release','Apply `20261016000024_model_attempt_instrument_member_read.sql` before using','Apply the instrument member-read migration before using','Missing: 20261016000024_model_attempt_instrument_member_read.sql'),
 ('restored',None,None,None,None),
]
results=[]
try:
 for control,name,old,new,reason in checks:
  for key,path in paths.items():path.write_text(original[key])
  if name:
   source=original[name];assert source.count(old)==1,control
   changed=source.replace(old,new)
   if control=='stale-unread-exception':
    anchor='const UNREAD_COLUMNS: ReadonlyArray<{'
    # Retain the declaration's type; insert at the actual initializer.
    start=changed.index(anchor);position=changed.index('= [',start)+3
    changed=changed[:position]+'\n'+entry+changed[position:]
   paths[name].write_text(changed)
  elif control=='harmless':
   for key,path in paths.items():path.write_text(original[key]+('\n<!-- Harmless comment. -->\n' if key=='release' else '\n// Harmless comment.\n'))
  result=subprocess.run(['npm','exec','--','vitest','run',*tests,'--maxWorkers=1','--no-file-parallelism'],cwd=app,
       env=dict(os.environ,NODE_OPTIONS='--max-old-space-size=1536'),capture_output=True,text=True,timeout=90)
  log=result.stdout+result.stderr;(output/(control+'.log')).write_text(log)
  matched=result.returncode==0 if reason is None else result.returncode!=0 and reason in log
  results.append({'control':control,'returncode':result.returncode,'expected_failure':reason,'matched':matched})
  if not matched:raise AssertionError(f'{control}: {log[-2500:]}')
finally:
 for key,path in paths.items():path.write_text(original[key])
report={'source_sha256':{name:hashlib.sha256(content.encode()).hexdigest() for name,content in original.items()},'controls':results,
        'limits':'Static migration and identifier inventories plus release notes. Live RLS tests are deliberately skipped; this is not a replacement for their native fixtures or GitHub jobs.'}
(output/'controls.json').write_text(json.dumps(report,indent=2)+'\n')
(Path(__file__).parent/'integration-inventory-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
