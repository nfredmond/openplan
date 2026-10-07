from pathlib import Path
import subprocess, json, hashlib
root=Path('/home/nathaniel/.local/state/openplan/land-use-plan-kinds-20261007/openplan')
out=Path('/home/nathaniel/.local/state/openplan/t3-restart-recovery-20261006/land-use-authority/implementation-report-controls')
out.mkdir(exist_ok=True)
reader=root/'src/lib/land-use-plans/implementation-report-snapshot.ts'
page=root/'src/components/reports/land-use-plan-report-page.tsx'
detail=root/'src/components/reports/land-use-plan-report-detail.tsx'
paths=[reader,page,detail]
original={p:p.read_bytes() for p in paths}
public_test='src/test/land-use-implementation-report-custody.test.tsx'
cases=[
 ('wrong-report-kind',reader,'report.report_type !== "land_use_plan_implementation_report"','false',public_test,'refuses wrong report kind'),
 ('infer-missing-plan',reader,'!report.land_use_plan_id','!(report.land_use_plan_id ||= String(metadata.landUsePlanId))',public_test,'refuses missing plan'),
 ('wrong-artifact-kind',reader,'metadata.kind !== "land_use_plan_implementation_report"','false',public_test,'withholds wrong kind'),
 ('wrong-artifact-plan',reader,'metadata.landUsePlanId !== report.land_use_plan_id','false',public_test,'withholds wrong artifact plan'),
 ('invalid-hash',reader,'!hash.safeParse(metadata.contentHash).success','false',public_test,'withholds invalid content hash'),
 ('invalid-action-status',reader,'z.enum(["not_started", "in_progress", "completed", "deferred"])','z.string()',public_test,'withholds invalid status'),
 ('invalid-update-time',reader,'z.string().datetime({ offset: true })','z.string()',public_test,'withholds invalid update time'),
 ('private-extra-field',reader,'}).strict()),','}).passthrough()),',public_test,'withholds private extra field'),
 ('inverted-dates',reader,'value.reportingPeriodEnd >= value.reportingPeriodStart','true',public_test,'withholds inverted reporting dates'),
 ('ignore-register-error',reader,'result.error || !native','false || !native',public_test,'withholds unreadable register'),
 ('wrong-native-report',reader,'native.report_id !== report.id','false',public_test,'withholds wrong registered report'),
 ('ignore-native-plan',reader,'native.plan_id','report.land_use_plan_id',public_test,'withholds wrong registered plan'),
 ('wrong-native-workspace',reader,'native.workspace_id !== report.workspace_id','false',public_test,'withholds wrong registered workspace'),
 ('wrong-native-hash',reader,'native.content_hash !== metadata.contentHash','false',public_test,'withholds changed artifact hash'),
 ('changed-summary',reader,'native.summary !== metadata.summary','false',public_test,'withholds changed artifact summary'),
 ('ignore-version-error',reader,'versionResult.error || !version','false || !version',public_test,'withholds unreadable version'),
 ('ignore-version-id',reader,'version.id','native.adopted_version_id',public_test,'withholds wrong native version'),
 ('wrong-version-workspace',reader,'version.workspace_id !== report.workspace_id','false',public_test,'withholds wrong native workspace'),
 ('wrong-version-plan',reader,'version.plan_id !== report.land_use_plan_id','false',public_test,'withholds wrong native plan'),
 ('wrong-version-state',reader,'!["adopted", "superseded", "repealed"].includes(version.state)','false',public_test,'withholds unadopted version'),
 ('skip-frozen-identity',reader,'readFrozenPlanIdentity(version.frozen_snapshot, native.plan_id, version.id, version.version_number, version.content_hash)','(version.frozen_snapshot.plan as NonNullable<ReturnType<typeof readFrozenPlanIdentity>>)',public_test,'withholds changed native snapshot'),
 ('skip-status-comparison',reader,'!isDeepStrictEqual(metadata.snapshot, snapshot)','false',public_test,'withholds changed artifact action'),
 ('order-sensitive-comparison',reader,'!isDeepStrictEqual(metadata.snapshot, snapshot)','JSON.stringify(metadata.snapshot) !== JSON.stringify(snapshot)',public_test,'accepts jsonb key reordering'),
 ('omit-register-projection',reader,'summary, action_status_snapshot, content_hash','summary, content_hash',public_test,'reads the adopted edition'),
 ('omit-register-report-filter',reader,'.eq("report_id", report.id)','',public_test,'reads the adopted edition'),
 ('omit-version-id-filter',reader,'.eq("id", native.adopted_version_id)','',public_test,'reads the adopted edition'),
 ('omit-workspace-filters',reader,'.eq("workspace_id", report.workspace_id)','',public_test,'reads the adopted edition'),
 ('omit-owner',detail,'text(action, "responsible_party")','null',public_test,'reads the adopted edition'),
 ('omit-update-time',detail,'text(action, "updated_at")','null',public_test,'reads the adopted edition'),
 ('omit-owner-absence',detail,'?? "Not specified"','?? ""',public_test,'labels an unspecified responsible party'),
 ('omit-summary-default',reader,'native.summary ?? `Implementation status for ${native.reporting_period_start} through ${native.reporting_period_end}.`','native.summary ?? ""',public_test,'uses saved reporting dates'),
 ('omit-retained-context',page,'retainedContext={<LandUsePlanPublicContext snapshot={retained.frozen} />}','',public_test,'discloses absent legacy context'),
 ('omit-refusal-caveat',page,'This does not establish whether the agency completed any action.','',public_test,'withholds changed artifact action'),
 ('restore-original-unverified-render',page,'const retained = await loadImplementationReportSnapshot(supabase, report, metadata);','return <LandUsePlanReportDetail report={report} plan={planResult.data} artifact={artifactsResult.data} />;\n    const retained = await loadImplementationReportSnapshot(supabase, report, metadata);',public_test,'withholds missing register'),
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
  source=original[p].decode();assert source.count(before)>=1,(name,source.count(before))
  try:
   p.write_text(source.replace(before,after));run(name,[test],expected)
  finally:p.write_bytes(original[p])
finally:
 for p in paths:p.write_bytes(original[p])
 restored=all(p.read_bytes()==original[p] for p in paths)
 (out/'report.json').write_text(json.dumps({'state':'complete' if len(results)==len(cases)+2 and all(r['verified'] for r in results) and restored else 'incomplete','cases':results,'restored':restored,'sourceHashes':{str(p.relative_to(root)):hashlib.sha256(b).hexdigest() for p,b in original.items()},'blindCategory':'Mounted pages and projected mocks only. Does not prove native authorization, browser download, layout, or practitioner acceptance.'},indent=2)+'\n')
