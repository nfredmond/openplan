from pathlib import Path
import hashlib, json, os, subprocess

app = Path(__file__).resolve().parents[5] / 'openplan'
import tempfile
out = Path(tempfile.mkdtemp(prefix='openplan-kind-connection-controls-'))

paths = {
 'create': 'src/lib/land-use-plans/create-store.ts',
 'context': 'src/lib/land-use-plans/plan-context-store.ts',
 'api': 'src/lib/land-use-plans/api.ts',
 'public': 'src/lib/land-use-plans/public.ts',
 'detail': 'src/app/api/land-use-plans/[planId]/route.ts',
 'content': 'src/app/api/land-use-plans/[planId]/content/route.ts',
 'process': 'src/app/api/land-use-plans/[planId]/process/route.ts',
 'freeze': 'src/app/api/land-use-plans/[planId]/freeze/route.ts',
 'decisions': 'src/app/api/land-use-plans/[planId]/decisions/route.ts',
 'page': 'src/app/(app)/land-use-plans/page.tsx',
 'creator': 'src/components/land-use-plans/land-use-plan-creator.tsx',
}
originals = {key: (app/path).read_bytes() for key, path in paths.items()}
for key, value in originals.items(): (out/(key+'.original')).write_bytes(value)
tests = {
 'integration':'src/test/land-use-plan-frozen-rules-integration.test.ts',
 'create':'src/test/land-use-plan-creation.test.ts',
 'context':'src/test/land-use-plan-context-route.test.ts',
 'freeze':'src/test/land-use-plan-freeze-route.test.ts',
 'public':'src/test/land-use-plan-public-identity.test.ts',
 'creator':'src/test/land-use-plan-creator-recovery.test.tsx',
 'page':'src/test/land-use-plan-first-run-jurisdiction.test.tsx',
}
cases=[]
def case(name, key, replacements, suite, target):
 cases.append((name,key,replacements,suite,target,False))
def family(name,key,call,args,suite,target):
 # Import a real family getter, avoiding an undefined-symbol fault.
 case(name,key,[('import { getPlanKindDescriptor }','import { getPlanKindDescriptor, getJurisdictionPlanDescriptor }'),(call,'getJurisdictionPlanDescriptor('+args+')')],suite,target)
cases.append(('baseline',None,[],None,None,True))
cases.append(('harmless',None,[],None,None,True))
family('creation-family-rules','create','getPlanKindDescriptor(command.descriptorId, command.planKindKey)','command.descriptorId','create','selected area rules')
case('creation-replay-after-live-rules','create',[('if (!lookup.data) {','if (true) {')],'create','replays original context before changed installed rules')
family('context-family-scope','context','getPlanKindDescriptor(command.descriptorId, command.planKindKey)','command.descriptorId','context',"checks context against a selected kind")
family('freeze-builder-family','api','getPlanKindDescriptor(access.plan.descriptor_id, access.plan.plan_kind_key)','access.plan.descriptor_id','integration','freezes the selected specific-plan rules')
family('working-detail-family','detail','getPlanKindDescriptor(access.plan.descriptor_id, access.plan.plan_kind_key)','access.plan.descriptor_id','integration','returns the specific-plan checklist')
family('applicability-family','detail','getPlanKindDescriptor(loaded.access.plan.descriptor_id, loaded.access.plan.plan_kind_key)','loaded.access.plan.descriptor_id','integration','preserves previously selected keys')
case('applicability-drops-older-keys','detail',[(', ...(working.applicable_requirement_keys ?? [])','')],'integration','preserves previously selected keys')
case('applicability-omits-required','detail',[("requirement.applicability === \"required\"",'false')],'integration','preserves previously selected keys')
case('applicability-allows-unknown','detail',[('if (!parsed.data.applicableRequirementKeys.every((key) => allowed.has(key))) {','if (false) {')],'integration','preserves previously selected keys')
case('applicability-writes-before-validation','detail',[('  if (parsed.data.applicableRequirementKeys !== undefined) {\n    const descriptor', '  if (parsed.data.title !== undefined) await loaded.access.supabase.from("land_use_plans").update({ title: parsed.data.title }).eq("id", loaded.access.plan.id);\n  if (parsed.data.applicableRequirementKeys !== undefined) {\n    const descriptor')],'integration','preserves previously selected keys')
family('content-family','content','getPlanKindDescriptor(loaded.access.plan.descriptor_id, loaded.access.plan.plan_kind_key)','loaded.access.plan.descriptor_id','integration','validates newly keyed section specific_land_use')
case('content-unknown-key','content',[('!descriptor?.requirements.some(requirement => requirement.key === payload.requirementKey)','false')],'integration','validates newly keyed section (land_use|invented_rule)')
case('content-policy-key','content',[('payload.nodeKind !== "section" || ','')],'integration','does not put a checklist key on a policy node')
family('process-working-family','process','getPlanKindDescriptor(access.plan.descriptor_id, access.plan.plan_kind_key)','access.plan.descriptor_id','integration','validates current process selection specific_amendment_procedure')
case('process-uses-live-not-retained','process',[('rules.status === "retained" ? rules.descriptor : getPlanKindDescriptor(identity.descriptorId, identity.planKindKey)','getPlanKindDescriptor(identity.descriptorId, identity.planKindKey)')],'integration','uses the retained process definition')
family('process-legacy-family','process','getPlanKindDescriptor(identity.descriptorId, identity.planKindKey)','identity.descriptorId','integration','selects specific-plan process rules for a legacy version')
case('process-snapshot-identity-bypass','process',[('readFrozenPlanIdentity(version.frozen_snapshot, access.plan.id, version.id, version.version_number, version.content_hash)','{ descriptorId: "local-unconfigured", planKindKey: "community" }')],'integration','refuses frozen process (hash|identity|context) corruption')
case('process-malformed-rules-bypass','process',[('if (rules.status === "invalid") return','if (false) return')],'integration','refuses frozen process rules corruption')
case('process-state-bypass','process',[('!["public_review", "adopted", "superseded", "repealed"].includes(version.state) || ','')],'integration','refuses frozen process state corruption')
case('process-projection-incomplete','process',[('.select("id, state, version_number, content_hash, frozen_snapshot")','.select("id, state, version_number, content_hash")')],'integration','validates current process selection specific_amendment_procedure')
case('process-plan-scope-missing','process',[('.eq("plan_id", access.plan.id)','')],'integration','validates current process selection specific_amendment_procedure')
family('public-legacy-family','public','getPlanKindDescriptor(identity.descriptorId, identity.planKindKey)','identity.descriptorId','public','uses the selected kind for an explicitly unretained legacy reference')
family('freeze-gate-family','freeze','getPlanKindDescriptor(access.plan.descriptor_id, access.plan.plan_kind_key)','access.plan.descriptor_id','freeze','reports required area rules absent')
case('adoption-does-not-compare-rules','decisions',[('if (rules.status === "retained" && (!installed || !reviewedSelection || hashFrozenRecord(installed) !== hashFrozenRecord(reviewedSelection))) {','if (false) {')],'integration','does not reinterpret a retained general-plan checklist')
case('adoption-compares-other-kinds','decisions',[('selectPlanKindRules(descriptor, frozenScope.data.plan.planKindKey)','descriptor')],'integration','compares the selected kind while retaining')
case('adoption-legacy-content-bypass','decisions',[('if (missing.length) return NextResponse.json({ error: "This legacy version','if (false) return NextResponse.json({ error: "This legacy version')],'integration','checks legacy required section content with (blank|number|policy|null) evidence')
case('adoption-legacy-blank-content','decisions',[(' && node.body.trim()','')],'integration','checks legacy required section content with blank evidence')
case('adoption-legacy-number-content','decisions',[("typeof node.body === \"string\" && node.body.trim()",'Boolean(node.body)')],'integration','checks legacy required section content with number evidence')
case('adoption-legacy-policy-content','decisions',[('node.node_kind === "section" && ','')],'integration','checks legacy required section content with policy evidence')
family('adoption-legacy-family','decisions','getPlanKindDescriptor(frozenScope.data.plan.descriptorId, frozenScope.data.plan.planKindKey)','frozenScope.data.plan.descriptorId','integration','does not let a legacy specific plan omit')
case('creator-review-survives-kind-change','creator',[('setForm(next); setReviewed(false); setNotice(null);','setForm(next); setNotice(null);')],'creator','retains a distinct checklist hash')
case('creator-kind-keeps-old-hash','creator',[('descriptorHash: descriptorHashes[planDescriptorSelectionKey(form.fields.descriptorId, event.target.value)]','descriptorHash: form.fields.descriptorHash')],'creator','retains a distinct checklist hash')
case('creator-hides-other-kind-options','creator',[('{family?.planKinds.map(kind =>','{descriptor?.planKinds.map(kind =>')],'creator','retains a distinct checklist hash')
case('creator-shows-family-disclosure','creator',[('getPlanKindDescriptor(family.id, form.fields.planKindKey) : null','family : null')],'creator','retains a distinct checklist hash')
case('creator-stale-hash-accepted','creator',[('if (!descriptor || descriptorHashes[selectionKey!] !== form.fields.descriptorHash)','if (!descriptor)')],'creator','keeps an older family-hash draft')
case('creator-initial-hash-family-key','creator',[('descriptorHashes[planDescriptorSelectionKey(neutral.id, neutral.planKinds[0].key)]','descriptorHashes[neutral.id]')],'page','passes each family-kind hash')
case('creator-family-hash-wrong-kind','creator',[('descriptorHashes[planDescriptorSelectionKey(next.id, next.planKinds[0].key)]','descriptorHashes[planDescriptorSelectionKey(next.id, "area")]')],'page','passes each family-kind hash')
case('page-hashes-family-key','page',[('[planDescriptorSelectionKey(family.id, kind.key),','[family.id,')],'page','passes each family-kind hash')
case('page-hashes-wrong-kind','page',[('hashFrozenRecord(snapshotPlanDescriptor(descriptor, kind.key))','"0".repeat(64)')],'page','passes each family-kind hash')

rows=[]
try:
 for name,key,replacements,suite,target,success in cases:
  try:
   if name == 'harmless':
    for k,b in originals.items(): (app/paths[k]).write_bytes(b'// Plan-kind connection control: no behavior change.\n'+b)
   elif key:
    source=originals[key].decode()
    for old,new in replacements:
     count=source.count(old)
     assert count == 1 or (name == 'public-legacy-family' and count == 2), (name,old,count)
     source=source.replace(old,new)
    (app/paths[key]).write_text(source)
   report=out/(name+'.json')
   command=['npm','exec','--','vitest','run',*(tests.values() if suite is None else [tests[suite]]),'--maxWorkers=1','--reporter=json','--outputFile='+str(report)]
   if target: command += ['-t',target]
   result=subprocess.run(command,cwd=app,env={**os.environ,'NODE_OPTIONS':'--max-old-space-size=6144'},stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=120)
   (out/(name+'.log')).write_text(result.stdout)
   data=json.loads(report.read_text())
   failed=[a for f in data['testResults'] for a in f['assertionResults'] if a['status']=='failed']
   matched=(result.returncode==0 and data['numPassedTests']>0) if success else (result.returncode!=0 and len(failed)>0 and all('AssertionError' in '\n'.join(a.get('failureMessages',[])) or '__VITEST_EXTEND_ASSERTION__' in '\n'.join(a.get('failureMessages',[])) or 'TestingLibraryElementError' in '\n'.join(a.get('failureMessages',[])) or (name in ['creation-family-rules','creation-replay-after-live-rules'] and '\n'.join(a.get('failureMessages',[])).startswith('Error: conflict')) for a in failed))
   rows.append({'case':name,'expectedPass':success,'exitCode':result.returncode,'passed':data['numPassedTests'],'failedTests':[a['fullName'] for a in failed],'failures':[a.get('failureMessages',[]) for a in failed],'matched':matched})
   print(name,matched,flush=True)
   assert matched,name
  finally:
   for k,b in originals.items(): (app/paths[k]).write_bytes(b)
finally:
 (out/'report.json').write_text(json.dumps({'results':rows,'restored':all((app/paths[k]).read_bytes()==b for k,b in originals.items()),'sources':{paths[k]:hashlib.sha256(b).hexdigest() for k,b in originals.items()},'boundary':'Mocked routes and mounted component behavior only. No native transaction, RLS, concurrency, real browser, legal sufficiency or older-draft reconciliation acceptance.'},indent=2)+'\n')
