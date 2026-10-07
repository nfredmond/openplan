from pathlib import Path
import subprocess, json, hashlib, time

root=Path('/home/nathaniel/.local/state/openplan/land-use-plan-kinds-20261007/openplan')
out=Path('/home/nathaniel/.local/state/openplan/t3-restart-recovery-20261006/land-use-authority/report-custody-controls-v2')
out.mkdir(exist_ok=True)
page=root/'src/components/reports/land-use-plan-report-page.tsx'
detail=root/'src/components/reports/land-use-plan-report-detail.tsx'
paths=[page,detail]
original={p:p.read_bytes() for p in paths}
public_test='src/test/land-use-plan-report-custody.test.tsx'
index_test=public_test
cases=[
 ('live-identity',page,'plan={{ id: identity.id, title: identity.title, authority_label: identity.authorityLabel, geography_label: identity.geographyLabel }}','plan={planResult.data}',public_test,'recorded identity and context'),
 ('omit-context',page,'retainedContext={<LandUsePlanPublicContext snapshot={frozen} />}','',public_test,'recorded identity and context'),
 ('omit-legacy-context',page,'retainedContext={<LandUsePlanPublicContext snapshot={frozen} />}','',public_test,'discloses legacy context'),
 ('omit-superseded',page,'"adopted", "superseded", "repealed"','"adopted", "repealed"',public_test,'shows the superseded'),
 ('omit-repealed',page,'"adopted", "superseded", "repealed"','"adopted", "superseded"',public_test,'shows the repealed'),
 ('omit-download',detail,' download={`openplan-report-${report.id}-provenance.json`}','',public_test,'recorded identity and context'),
 ('omit-wrap',detail,'[overflow-wrap:anywhere]','',public_test,'recorded identity and context'),
 ('omit-projection',page,'state, content_hash, published_report_id','state, published_report_id',public_test,'recorded identity and context'),
 ('omit-plan-filter',page,'.eq("plan_id", report.land_use_plan_id)','',public_test,'recorded identity and context'),
 ('trust-artifact-hash',page,'version.content_hash','metadata.contentHash',public_test,'withholds self-rehashed artifact'),
 ('ignore-artifact-plan',page,'metadata.landUsePlanId === report.land_use_plan_id','true',public_test,'withholds wrong artifact plan'),
 ('ignore-native-plan',page,'version.plan_id === report.land_use_plan_id','true',public_test,'withholds wrong queried plan'),
 ('ignore-native-id',page,'version.id','versionId',public_test,'withholds wrong queried version'),
 ('ignore-version-number',page,'version.version_number','(frozen.version as { versionNumber: number }).versionNumber',public_test,'withholds wrong version number'),
 ('ignore-report-pointer',page,'version.published_report_id === report.id','true',public_test,'withholds wrong report pointer'),
 ('ignore-adopted-state',page,'["adopted", "superseded", "repealed"].includes(version.state)','true',public_test,'withholds unadopted version'),
 ('ignore-kind',page,'metadata.kind !== "land_use_plan_implementation_report"','true',public_test,'withholds kind substitution'),
 ('ignore-version-error',page,'!versionResult?.error','true',public_test,'withholds unreadable native version'),
 ('skip-frozen-verification',page,'readFrozenPlanIdentity(frozen, report.land_use_plan_id, version.id, version.version_number, version.content_hash)','(frozen.plan as NonNullable<ReturnType<typeof readFrozenPlanIdentity>>)',public_test,'withholds changed artifact'),
 ('skip-context-verification',page,'readFrozenPlanIdentity(frozen, report.land_use_plan_id, version.id, version.version_number, version.content_hash)','(frozen.plan as NonNullable<ReturnType<typeof readFrozenPlanIdentity>>)',public_test,'withholds invalid retained context'),
]

results=[]
def run(name,tests,expected=None):
 with (out/(name+'.log')).open('w') as log:
  r=subprocess.run(['npm','exec','--','vitest','run',*tests,'--maxWorkers=1'],cwd=root,stdout=log,stderr=subprocess.STDOUT)
 text=(out/(name+'.log')).read_text()
 passed=r.returncode==0 if expected is None else r.returncode!=0 and 'FAIL' in text and expected in text and ('AssertionError' in text or 'TestingLibraryElementError' in text or 'Error: expect(element).toHaveAttribute' in text or 'Error: expect(element).toHaveTextContent' in text or 'Error: expect(element).toHaveClass' in text)
 results.append({'name':name,'exitCode':r.returncode,'verified':passed,'expectedFailure':expected})
 (out/'report.json').write_text(json.dumps({'state':'running','cases':results},indent=2))
 if not passed:raise RuntimeError('Control did not satisfy expected result: '+name)
try:
 run('baseline',[public_test])
 for p in paths:p.write_bytes(original[p]+b'\n// Harmless observation-control comment.\n')
 run('harmless',[public_test])
 for p in paths:p.write_bytes(original[p])
 for name,p,before,after,test,expected in cases:
  source=original[p].decode();assert source.count(before)=={'trust-artifact-hash':3,'ignore-native-id':2}.get(name,1),(name,source.count(before))
  try:
   p.write_text(source.replace(before,after));run(name,[test],expected)
  finally:p.write_bytes(original[p])
finally:
 for p in paths:p.write_bytes(original[p])
 restored=all(p.read_bytes()==original[p] for p in paths)
 (out/'report.json').write_text(json.dumps({'state':'complete' if len(results)==len(cases)+2 and all(r['verified'] for r in results) and restored else 'incomplete','cases':results,'restored':restored,'sourceHashes':{str(p.relative_to(root)):hashlib.sha256(b).hexdigest() for p,b in original.items()},'blindCategory':'Mounted pages and projected mocks only. Does not prove native authorization, browser download, layout, or practitioner acceptance.'},indent=2)+'\n')
