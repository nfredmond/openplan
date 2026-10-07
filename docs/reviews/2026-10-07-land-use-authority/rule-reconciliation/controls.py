from pathlib import Path
import hashlib,json,os,subprocess

app=Path(__file__).resolve().parents[4]/'openplan'
if os.environ.get('OPENPLAN_RECONCILIATION_CONTROLS')!='1':
 raise SystemExit('Use an owned idle checkout and explicitly set OPENPLAN_RECONCILIATION_CONTROLS=1')
stack=os.environ.get('OPENPLAN_SUPABASE_WORKDIR','')
if not stack: raise SystemExit('Select an isolated OPENPLAN_SUPABASE_WORKDIR')
import tempfile
out=Path(tempfile.mkdtemp(prefix='openplan-reconciliation-controls-'));print(out,flush=True)
paths={'route':'src/app/api/land-use-plans/[planId]/reconcile-rules/route.ts',
 'store':'src/lib/land-use-plans/rule-reconciliation-store.ts',
 'command':'src/lib/land-use-plans/rule-reconciliation-command.ts',
 'sql':'supabase/migrations/20261016000010_land_use_plan_rule_reconciliation.sql'}
originals={k:(app/p).read_bytes() for k,p in paths.items()}
for k,b in originals.items():(out/(k+'.original')).write_bytes(b)
cases=[]
def case(name,key,old,new,target=None,native=False,expected=None):cases.append((name,key,[(old,new)],target,native,False,expected))
for native in [False,True]:
 cases.append(('native-baseline' if native else 'route-baseline',None,[],None,native,True,None))
 cases.append(('native-harmless' if native else 'route-harmless','harmless',[],None,native,True,None))
case('agent-refusal','route','if (["x-openplan-assistant-execution-source"','if (false && ["x-openplan-assistant-execution-source"','refuses agent header')
case('origin-refusal','route','try { requireProviderBrowserOrigin(request); }','try { /* controlled origin bypass */ }','refuses untrusted or changed browser scope')
case('write-access','route','{ write: true }','{ write: false }','retains exact request bytes')
case('account-scope','route','request.headers.get("x-openplan-expected-user") !== access.userId','false','refuses untrusted or changed browser scope')
case('workspace-scope','route','request.headers.get("x-openplan-expected-workspace") !== access.plan.workspace_id','false','refuses untrusted or changed browser scope')
case('body-limit','route','readBytesWithLimitStreaming(request, 8192)','readBytesWithLimitStreaming(request, 16384)','bounds request bytes')
case('draft-revision','route','version.draft_revision !== command.expectedDraftRevision','false','refuses stale or unavailable working version')
case('working-version','route','version.id !== command.versionId','false','refuses stale or unavailable working version')
case('rule-hash','route','hashFrozenRecord(descriptor) !== command.expectedDescriptorHash','false','refuses unavailable or changed selected rules')
case('recovery-before-current-rules','route','if (!await hasRuleReconciliation(service, scope, command.commandId)) {','if (true) {','replays original results')
case('fresh-status','route','result.replayed ? 200 : 201','200','retains exact request bytes')
case('replay-status','route','result.replayed ? 200 : 201','201','replays original results')
case('lookup-projection','store','.select("command_id")','.select("actor_id")','retains exact request bytes')
for name,old in [('plan',' .eq("plan_id", scope.planId)'),('workspace','.eq("workspace_id", scope.workspaceId)'),('command','.eq("command_id", commandId)')]:
 case('lookup-'+name,'store',old.strip(),'','retains exact request bytes')
case('lookup-errors','store','error || (data && data.command_id !== commandId)','(data && data.command_id !== commandId)','keeps failed or incomplete receipt discovery')
case('lookup-identity','store','error || (data && data.command_id !== commandId)','error','keeps failed or incomplete receipt discovery')
case('prepared-hash','store','if (descriptor && hashFrozenRecord(descriptor) !== command.expectedDescriptorHash)','if (false)','checks the prepared hash again')
case('recovery-receipt','store','|| (!descriptor && !parsed.data.replayed)','','requires a replayed receipt')
case('receipt-added-key','store','result.addedSections.some(section => !descriptor.requirements.some(rule => rule.key === section.requirementKey))','false','keeps invalid or mismatched receipts')
case('receipt-defaults','store','descriptor.requirements.some(rule => rule.applicability !== "conditional" && !result.applicableRequirementKeys.includes(rule.key))','false','keeps invalid or mismatched receipts|retains locally defined defaults')
case('receipt-local-defaults','store','rule.applicability !== "conditional"','rule.applicability === "required"','retains locally defined defaults')
for field in ['actorId','workspaceId','planId']:
 case('receipt-'+field,'command','result.'+field+' === scope.'+field,'true','rejects substituted receipt '+field)
for field in ['commandId','versionId']:
 case('receipt-'+field,'command','result.'+field+' === command.'+field,'true','rejects substituted receipt '+field)
case('receipt-before-revision','command','result.previousDraftRevision === command.expectedDraftRevision','true','keeps invalid or mismatched receipts')
case('receipt-rule-hash','command','result.descriptorHash === command.expectedDescriptorHash','true','keeps invalid or mismatched receipts')
case('receipt-revision-delta','command','result.draftRevision - result.previousDraftRevision < result.addedSections.length','false','keeps invalid or mismatched receipts')
case('receipt-duplicate-nodes','command','new Set(result.addedSections.map(section => section.id)).size !== result.addedSections.length','false','keeps invalid or mismatched receipts')
case('receipt-duplicate-keys','command','new Set(result.addedSections.map(section => section.requirementKey)).size !== result.addedSections.length','false','keeps invalid or mismatched receipts')
case('receipt-extra-fields','command','}).strict().superRefine','}).passthrough().superRefine','keeps invalid or mismatched receipts')
case('command-extra-fields','command','expectedDraftRevision: revision, expectedDescriptorHash: hash,\n}).strict();','expectedDraftRevision: revision, expectedDescriptorHash: hash,\n});','rejects malformed commands')
case('command-revision-range','command','.max(2_147_483_647)','','rejects malformed commands')

def sql(name,old,new,expected):case(name,'sql',old,new,None,True,expected)
sql('native-write-permission','IF NOT EXISTS (SELECT 1 FROM public.workspace_members','IF false AND NOT EXISTS (SELECT 1 FROM public.workspace_members','viewer denied: accepted')
sql('native-replay-permission',"role IN ('owner','admin','member') FOR SHARE NOWAIT) THEN","role IN ('owner','admin','member') FOR SHARE NOWAIT) AND NOT EXISTS (SELECT 1 FROM public.land_use_plan_rule_reconciliation_commands WHERE plan_id=p_plan_id AND command_id=p_command_id) THEN",'revoked permission refuses replay: accepted')
sql('native-workspace-scope','WHERE id=p_plan_id AND workspace_id=p_workspace_id FOR UPDATE NOWAIT','WHERE id=p_plan_id FOR UPDATE NOWAIT','wrong workspace denied: unexpected PT409')
sql('native-replay-actor','previous.actor_id IS DISTINCT FROM p_actor_id OR ','','another staff member cannot reuse receipt: accepted')
sql('native-replay-bytes','OR previous.command_text IS DISTINCT FROM p_command_text','OR false','changed retry bytes: accepted')
sql('native-replay-before-rules','IF FOUND THEN','IF false THEN','The selected descriptor is required')
sql('native-command-shape',"AND (SELECT count(*) FROM jsonb_object_keys(command))=5",'','extra command fields: accepted')
sql('native-rule-hash',"AND descriptor_hash=command->>'expectedDescriptorHash'",'','changed descriptor bytes: accepted')
sql('native-family',"AND rules->>'id'=plan_row.descriptor_id",'','mismatched rule selection: accepted')
sql('native-one-kind',"jsonb_array_length(rules->'planKinds')<>1 OR ",'','mismatched rule selection: accepted')
sql('native-kind-binding',"OR rules#>>'{planKinds,0,key}' IS DISTINCT FROM plan_row.plan_kind_key",'','mismatched rule selection: accepted')
sql('native-frozen-state',"working.state<>'working' OR ",'','frozen state alone refused: accepted')
sql('native-current-pointer','plan_row.current_working_version_id IS DISTINCT FROM working.id','false','noncurrent working version refused: accepted')
sql('native-draft-revision',"working.draft_revision IS DISTINCT FROM (command->>'expectedDraftRevision')::integer",'false','changed draft revision: accepted')
sql('native-preserve-keys',"FOR requirement IN SELECT value FROM jsonb_array_elements(rules->'requirements') LOOP","next_keys:=ARRAY[]::text[]; FOR requirement IN SELECT value FROM jsonb_array_elements(rules->'requirements') LOOP",'receipt preserves earlier and non-conditional keys')
sql('native-nonconditional-defaults',"requirement->>'applicability'<>'conditional'","requirement->>'applicability'='required'",'receipt preserves earlier and non-conditional keys')
sql('native-conditional-defaults',"requirement->>'applicability'<>'conditional'","requirement->>'applicability' IS NOT NULL",'receipt preserves earlier and non-conditional keys')
sql('native-policy-is-not-section',"AND node_kind='section' AND requirement_key=requirement->>'key'","AND requirement_key=requirement->>'key'",'three inserts and applicability advance revision')
sql('native-preserve-authored-text','  next_keys:=working.applicable_requirement_keys;',"  UPDATE public.land_use_plan_content_nodes SET body='SYNTHETIC unwanted rewrite' WHERE version_id=working.id;\n  next_keys:=working.applicable_requirement_keys;",'authored nodes and evidence are byte-preserved')
sql('native-preserve-map-reference','  next_keys:=working.applicable_requirement_keys;',"  UPDATE public.land_use_plan_designations SET map_note='SYNTHETIC unwanted map rewrite' WHERE version_id=working.id;\n  next_keys:=working.applicable_requirement_keys;",'relationships maps policy links and actions preserved')
sql('native-section-order','greatest(coalesce(max(sort_order)::bigint,-1),-1)+1','0','full section ordering refused: accepted')
sql('native-applicability-validation',"IF EXISTS (SELECT 1 FROM unnest(next_keys) value WHERE value IS NULL OR btrim(value)='') THEN",'IF false THEN','malformed existing applicability: accepted')
sql('native-plan-lock','WHERE id=p_plan_id AND workspace_id=p_workspace_id FOR UPDATE NOWAIT','WHERE id=p_plan_id AND workspace_id=p_workspace_id','Reconciliation accepted while peer held SELECT id FROM public.land_use_plans')
sql('native-membership-lock',"role IN ('owner','admin','member') FOR SHARE NOWAIT","role IN ('owner','admin','member')",'Reconciliation accepted while peer held SELECT user_id FROM public.workspace_members')
sql('native-version-lock',"WHERE id=(command->>'versionId')::uuid AND plan_id=p_plan_id AND workspace_id=p_workspace_id FOR UPDATE NOWAIT", "WHERE id=(command->>'versionId')::uuid AND plan_id=p_plan_id AND workspace_id=p_workspace_id",'Reconciliation accepted while peer held SELECT id FROM public.land_use_plan_versions')
sql('native-private-journal','ALTER TABLE public.land_use_plan_rule_reconciliation_commands ENABLE ROW LEVEL SECURITY;','', 'journal RLS')
sql('native-authenticated-rpc', 'GRANT EXECUTE ON FUNCTION public.reconcile_land_use_plan_rules(uuid,uuid,uuid,uuid,text,text) TO service_role;', 'GRANT EXECUTE ON FUNCTION public.reconcile_land_use_plan_rules(uuid,uuid,uuid,uuid,text,text) TO service_role,authenticated;', 'authenticated RPC denied')

rows=[]
try:
 for name,key,replacements,target,native,success,expected in cases:
  try:
   if key=='harmless':
    for k,b in originals.items(): (app/paths[k]).write_bytes((b'-- Harmless control.\n' if k=='sql' else b'// Harmless control.\n')+b)
   elif key:
    source=originals[key].decode()
    for old,new in replacements:
     assert source.count(old)==1,(name,old,source.count(old))
     source=source.replace(old,new)
    (app/paths[key]).write_text(source)
   report=out/(name+'.json');suite='src/test/land-use-plan-rule-reconciliation-'+('rls' if native else 'route')+'.test.ts'
   command=['npm','exec','--','vitest','run',suite,'--maxWorkers=1','--reporter=json','--outputFile='+str(report)]
   if target:command+=['-t',target]
   env={**os.environ,'NODE_OPTIONS':'--max-old-space-size=6144'}
   if native:env.update(OPENPLAN_RLS_LIVE_TEST='1',OPENPLAN_RECONCILIATION_MIGRATION_PROBE='1',OPENPLAN_SUPABASE_WORKDIR=stack)
   run=subprocess.run(command,cwd=app,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=100)
   (out/(name+'.log')).write_text(run.stdout);data=json.loads(report.read_text())
   failed=[a for f in data['testResults'] for a in f['assertionResults'] if a['status']=='failed']
   messages='\n'.join(m for a in failed for m in a.get('failureMessages',[]))
   matched=(run.returncode==0 and data['numPassedTests']==(2 if native else 56)) if success else (run.returncode!=0 and len(failed)>0 and ('AssertionError' in messages or '__VITEST_REJECTS__' in messages) and (expected is None or expected in messages) and 'syntax error' not in messages)
   rows.append({'case':name,'native':native,'expectedPass':success,'exitCode':run.returncode,'passed':data['numPassedTests'],'failedTests':[a['fullName'] for a in failed],'failures':[a.get('failureMessages',[]) for a in failed],'matched':matched})
   print(name,matched,flush=True);assert matched,name
  finally:
   for k,b in originals.items():(app/paths[k]).write_bytes(b)
finally:
 (out/'report.json').write_text(json.dumps({'results':rows,'restored':all((app/paths[k]).read_bytes()==b for k,b in originals.items()),'sources':{paths[k]:hashlib.sha256(b).hexdigest() for k,b in originals.items()},'boundary':'Route mocks, transactional native preservation/rollback and two-session row locks. No browser recovery, installed migration upgrade, two concurrent HTTP commands, full public/export agreement or practitioner acceptance.'},indent=2)+'\n')
