import hashlib, json, os, pathlib, subprocess, sys
app=pathlib.Path(sys.argv[1]).resolve(); out=pathlib.Path(sys.argv[2]).resolve(); out.mkdir(parents=True,exist_ok=False)
names={'schema':'src/lib/land-use-plans/descriptor-snapshot.ts','api':'src/lib/land-use-plans/api.ts',
 'public':'src/lib/land-use-plans/public.ts','decision':'src/app/api/land-use-plans/[planId]/decisions/route.ts',
 'published':'src/app/(published)/published-plans/[planId]/page.tsx','review':'src/app/(published)/review/land-use-plans/[shareToken]/page.tsx'}
original={key:(app/value).read_text() for key,value in names.items()}
env=dict(os.environ,NODE_OPTIONS='--max-old-space-size=6144')
command=['node','node_modules/vitest/vitest.mjs','run','src/test/land-use-plan-descriptor-snapshot.test.ts','src/test/land-use-plan-frozen-rules-integration.test.ts','src/test/land-use-plan-public-identity.test.ts','src/test/land-use-plan-source-review.test.tsx','--maxWorkers=1']
report={'controls':[]}
def run(name, edits, expected, target=''):
 for key,text in original.items(): (app/names[key]).write_text(edits.get(key,text))
 result=subprocess.run(command,cwd=app,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
 (out/(name+'.log')).write_text(result.stdout)
 report['controls'].append({'name':name,'exitCode':result.returncode,'expected':expected,'target':target})
 if expected=='pass' and result.returncode: raise RuntimeError(name+' did not pass')
 assertion='AssertionError' in result.stdout or (name.startswith('hide-') and 'TestingLibraryElementError' in result.stdout and 'Unable to find an element with the text' in result.stdout)
 if expected=='fail' and (not result.returncode or target not in result.stdout or not assertion): raise RuntimeError(name+' did not detect intended assertion')
def mutation(name,key,before,after,target):
 if before not in original[key]: raise RuntimeError('Missing mutation '+name)
 run(name,{key:original[key].replace(before,after)},'fail',target)
try:
 run('harmless-comments',{key:'// Harmless control comment.\n'+text for key,text in original.items()},'pass')
 mutations=[
 ('omit-freeze-rules','api','    descriptorSnapshot,','', 'includes the exact descriptor'),
 ('retain-mutable-reference','schema','  return parsed;','  return descriptor;', 'copies every rule'),
 ('unsupported-kind','schema','if (!parsed.planKinds.some(kind => kind.key === planKindKey))','if (false)', 'does not claim a descriptor for a plan kind'),
 ('null-is-legacy','schema','!Object.hasOwn(snapshot, "descriptorSnapshot")','!snapshot.descriptorSnapshot', 'refuses a self-hashed null descriptor'),
 ('wrong-rule-id','schema',' || parsed.data.id !== descriptorId','', 'refuses a self-hashed wrong-id descriptor'),
 ('wrong-rule-kind','schema',' || !parsed.data.planKinds.some(kind => kind.key === planKindKey)','', 'refuses a self-hashed wrong-kind descriptor'),
 ('missing-rule-date','schema','verifiedAt: z.string().date()','verifiedAt: z.string().date().optional()', 'refuses a self-hashed missing-source-date descriptor'),
 ('unsafe-rule-source','schema','protocol: /^https?$/','protocol: /.*/', 'refuses unsafe source links'),
 ('live-public-rules','public','rules.status === "retained" ? rules.descriptor : getJurisdictionPlanDescriptor(identity.descriptorId)','getJurisdictionPlanDescriptor(identity.descriptorId)', 'uses saved descriptor wording and dates'),
 ('skip-installed-comparison','decision','!installed || hashFrozenRecord(installed) !== hashFrozenRecord(descriptor)','false', 'requires reassessment when the installed descriptor differs'),
 ('skip-adoption-hash','decision',' || hashFrozenRecord(version.frozen_snapshot) !== payload.versionContentHash','', 'refuses substituted frozen bytes'),
 ('skip-adoption-plan','decision',' || frozenScope.data.plan.id !== access.plan.id','', 'refuses substituted frozen plan'),
 ('skip-adoption-version','decision',' || frozenScope.data.version.id !== version.id','', 'refuses substituted frozen version'),
 ('skip-adoption-number','decision','frozenScope.data.version.versionNumber !== version.version_number || ','', 'refuses substituted frozen number'),
 ('omit-manifest-rules','decision','      descriptorSnapshot: descriptor,','', 'retains the reviewed rules and their hash'),
 ('omit-manifest-rule-hash','decision','      descriptorSha256: hashFrozenRecord(descriptor),','', 'retains the reviewed rules and their hash'),
 ('promote-legacy-rules','decision','"current_reference_not_retained_at_review"','"frozen"', 'records legacy adoption with an explicitly current'),
 ('skip-process-evidence','decision','if (adoptionBlockers.length)','if (false)', 'keeps required recorded process evidence'),
 ('hide-published-disclosure','published','{describeDescriptorCustody(packet.descriptorCustody)}','', 'identifies an unsaved legacy descriptor'),
 ('hide-review-disclosure','review','{describeDescriptorCustody(packet.descriptorCustody)}','', 'discloses'),
 ]
 for args in mutations: mutation(*args)
 legacy=original['decision'].replace('const rules = readFrozenPlanDescriptor(', 'let rules = readFrozenPlanDescriptor(')
 marker='    if (rules.status === "invalid") return'
 if marker not in legacy: raise RuntimeError('Missing legacy guard')
 legacy=legacy.replace(marker,'    if (rules.status === "invalid") rules = { status: "retained", descriptor: getJurisdictionPlanDescriptor(frozenScope.data.plan.descriptorId)! };\n'+marker)
 run('reconstruct-invalid-rules',{'decision':legacy},'fail','refuses a malformed saved checklist')
finally:
 for key,text in original.items(): (app/names[key]).write_text(text)
 report['restored']=all((app/names[key]).read_text()==text for key,text in original.items())
 report['sourceSha256']={names[key]:hashlib.sha256(text.encode()).hexdigest() for key,text in original.items()}
 (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
