from pathlib import Path
import hashlib,json,os,subprocess,tempfile
app=Path(__file__).resolve().parents[4]/'openplan'
if os.environ.get('OPENPLAN_UI_CONTROLS')!='1': raise SystemExit('Requires an owned idle checkout and OPENPLAN_UI_CONTROLS=1')
out=Path(tempfile.mkdtemp(prefix='openplan-reconciliation-ui-controls-'));print(out,flush=True)
paths={'recovery':'src/lib/land-use-plans/rule-reconciliation-recovery.ts','control':'src/components/land-use-plans/land-use-plan-rule-reconciliation-control.tsx','form':'src/components/land-use-plans/use-plan-form-custody.ts','workbench':'src/components/land-use-plans/land-use-plan-workbench.tsx','command':'src/lib/land-use-plans/rule-reconciliation-command.ts','inventory':'src/test/migrations/inventory.test.ts','columns':'src/test/a-column-nothing-reads-is-a-question.test.ts'}
originals={k:(app/p).read_bytes() for k,p in paths.items()}
for k,b in originals.items():(out/(k+'.original')).write_bytes(b)
recovery=['src/test/land-use-plan-rule-reconciliation-recovery.test.ts']
control=['src/test/land-use-plan-rule-reconciliation-control.test.tsx']
workbench=['src/test/land-use-plan-draft-custody.test.tsx']
ci=['src/test/migrations/inventory.test.ts','src/test/a-column-nothing-reads-is-a-question.test.ts','src/test/every-api-route-has-a-caller.test.ts']
cases=[]
def add(name,key,old,new,tests,target=None,pass_expected=False):cases.append((name,key,[(old,new)],tests,target,pass_expected))
cases.append(('baseline',None,[],recovery+control+workbench+ci,None,True))
add('harmless','recovery','Each command owns an immutable key','Each saved command owns an immutable key',recovery+control+workbench+ci,None,True)
add('transport-exact-bytes','recovery','body: valid.commandText','body: JSON.stringify(command)',recovery)
add('transport-scope','recovery','"x-openplan-expected-user": valid.actorId','"x-openplan-expected-user": valid.workspaceId',recovery)
add('retention-required','recovery','if (storage.getItem(key) !== JSON.stringify(valid))','if (false)',recovery)
add('retain-overwrite','recovery','if (existing !== null && existing !== raw)','if (false)',recovery)
add('retain-readback','recovery','if (storage.getItem(key) !== raw) throw new Error("The checklist request could not be saved','if (false) throw new Error("The checklist request could not be saved',recovery)
add('receipt-bindings','recovery','!matchesRuleReconciliation(result, scopeOf(valid), command)','false',recovery)
add('receipt-status','recovery','response.status !== (result.replayed ? 200 : 201)','false',recovery)
add('receipt-schema','recovery','ruleReconciliationResultSchema.parse(await response.json())','await response.json()',recovery)
add('abort-before-transport','recovery','bounded.throwIfAborted();\n  const response','/* controlled bypass */\n  const response',recovery)
add('abort-after-transport','recovery','bounded.throwIfAborted();\n  if (!response.ok)','/* controlled bypass */\n  if (!response.ok)',recovery)
add('abort-after-json','recovery','bounded.throwIfAborted();\n  if (!matches','/* controlled bypass */\n  if (!matches',recovery)
add('ack-changed-copy','recovery','if (storage.getItem(key) !== raw) throw new Error("The checklist change is confirmed','if (false) throw new Error("The checklist change is confirmed',recovery)
add('ack-readback','recovery','if (storage.getItem(key) !== null) throw new Error("The checklist change is confirmed','if (false) throw new Error("The checklist change is confirmed',recovery)
add('preserve-readback','recovery','if (storage.getItem(copyKey) !== record.raw || storage.getItem(record.key) !== record.raw)','if (false)',recovery)
add('restore-size','recovery','if (raw.length > 32_768)','if (false)',recovery)
for field in ['actorId','workspaceId','planId']:
 add('restore-scope-'+field,'recovery',f'pending.{field} !== scope.{field}','false',recovery)
add('no-auto-send','control','refresh(); window.addEventListener','refresh(); void sendRuleReconciliation(localStorage, readRuleReconciliationRecovery(localStorage, { actorId, workspaceId, planId })[0]?.pending!); window.addEventListener',control,'does not send on mount')
add('review-stale','control','const reviewKey = JSON.stringify([actorId, workspaceId, planId, props.versionId, props.draftRevision,\n    props.descriptorHash, props.missingSections, props.missingDefaults]);','const reviewKey = "fixed";',control)
add('retained-before-send','control','request = retainRuleReconciliation(localStorage, { ...scope','request = ({ ...scope',control,'retains before transport')
add('dirty-refresh','control','if (latest.current.disabled)','if (false)',control)
add('readiness-button','control','|| !ready || !props.canWrite','|| !props.canWrite',control)
add('stale-storage-error','control','onClick={() => { setError(null); read(); }}','onClick={read}',control)
add('frozen-new-request','control','{props.working && needsChanges ?','{needsChanges ?',control)
add('pending-preserve-disabled','control','disabled={busy || props.disabled} onClick={() => void preserve(record)}','disabled={busy} onClick={() => void preserve(record)}',control)
add('file-account-generation','control','if (current === generation.current) restore(raw);','restore(raw);',control)
add('request-ack','control','acknowledgeRuleReconciliation(localStorage, request); read();','read();',control)
add('request-no-refresh','control','await refreshCurrentPlan(current);','/* omit refresh */',control)
add('form-dirty','workbench',' || formCustody.hasUnsavedForms','',workbench)
add('form-late-reset','form','if (planFormSnapshot(form) !== planFormSnapshot(submitted)) return false;','',workbench)
add('form-ack-current','form','baseline: submitted, dirty: current !== submitted','baseline: current, dirty: false',workbench)
add('form-snapshot','form','record.dirty = planFormSnapshot(form) !== record.baseline;','record.dirty = true;',workbench)
add('old-section-edit','workbench','const applicable = !requirement || requirement.applicability !== "conditional" ||','const applicable = Boolean(requirement) && (requirement?.applicability !== "conditional") ||',workbench,'adds reviewed blank sections')
add('inventory-count','inventory','relations: 299','relations: 298',ci)
add('column-accounting','columns','column: "land_use_plan_rule_reconciliation_commands.command_text"','column: "land_use_plan_rule_reconciliation_commands.missing_text"',ci)
cases = [('review-form-baseline',None,[],workbench,None,True)]
add('review-form-harmless','workbench','"use client";','"use client"; // harmless control',workbench,None,True)
add('disposition-field-custody','workbench','name="dispositionSummary"','data-control="dispositionSummary"',workbench,'unfinished Disposition')
add('withdrawal-field-custody','workbench','name="withdrawalReason"','data-control="withdrawalReason"',workbench,'unfinished Reason')
results=[]
def restore():
 for key,raw in originals.items():(app/paths[key]).write_bytes(raw)
try:
 for name,key,replacements,tests,target,pass_expected in cases:
  restore()
  if key:
   text=originals[key].decode()
   for old,new in replacements:
    if old not in text: raise ValueError('Missing anchor '+name+': '+old)
    text=text.replace(old,new,1)
   (app/paths[key]).write_text(text)
  report=out/(name+'.json')
  cmd=['npm','exec','--','vitest','run','--maxWorkers=1',*tests,'--reporter=json','--outputFile='+str(report)]
  if target:cmd+=['-t',target]
  run=subprocess.run(cmd,cwd=app,env={**os.environ,'NODE_OPTIONS':'--max-old-space-size=6144'},capture_output=True,text=True,timeout=100)
  (out/(name+'.log')).write_text(run.stdout+run.stderr)
  data=json.loads(report.read_text()) if report.exists() else {}
  failures=[{'name':a['fullName'],'messages':a.get('failureMessages',[])} for t in data.get('testResults',[]) for a in t.get('assertionResults',[]) if a['status']=='failed']
  correct=(run.returncode==0 and data.get('numPassedTests',0)>0) if pass_expected else (run.returncode!=0 and bool(failures))
  row={'name':name,'expected':'pass' if pass_expected else 'assertion_failure','exit':run.returncode,'passed':data.get('numPassedTests'),'failed':data.get('numFailedTests'),'correct':correct,'failures':failures}
  results.append(row);(out/'results.json').write_text(json.dumps(results,indent=2));print(name,run.returncode,'expected' if correct else 'INVESTIGATE',flush=True)
finally:
 restore()
 (out/'restored.json').write_text(json.dumps({k:{'before':hashlib.sha256(b).hexdigest(),'after':hashlib.sha256((app/paths[k]).read_bytes()).hexdigest()} for k,b in originals.items()},indent=2))
print('complete',out,flush=True)
