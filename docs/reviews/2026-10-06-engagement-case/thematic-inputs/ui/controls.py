import hashlib,json,os,subprocess,sys,time
from pathlib import Path
root=Path(sys.argv[1]).resolve();out=Path(sys.argv[2]).resolve();out.mkdir(exist_ok=False)
paths={
 'recovery':'src/lib/engagement/synthesis-thematic-choice-recovery.ts',
 'discovery':'src/lib/engagement/synthesis-thematic-choice-discovery-server.ts',
 'contract':'src/lib/engagement/synthesis-thematic-choice-discovery.ts',
 'choice':'src/components/engagement/synthesis-thematic-context-choice.tsx',
 'inputs':'src/components/engagement/synthesis-thematic-inputs-panel.tsx',
 'preparation':'src/components/engagement/synthesis-preparation-panel.tsx',
 'continuation':'src/components/engagement/synthesis-continuation-panel.tsx',
 'route':'src/app/api/engagement/campaigns/[campaignId]/synthesis/thematic-choices/route.ts',
}
suites={key:'engagement-synthesis-'+name for key,name in {
 'recovery':'thematic-choice-recovery.test.ts','discovery':'thematic-choice-discovery.test.ts','contract':'thematic-choice-discovery.test.ts',
 'choice':'thematic-choice-panel.test.tsx','inputs':'thematic-choice-panel.test.tsx','preparation':'preparation-queue-panel.test.tsx',
 'continuation':'continuation-panel.test.tsx','route':'thematic-choice-route.test.ts'}.items()}
original={key:(root/path).read_bytes() for key,path in paths.items()};rows=[]
def run(name,files,pattern=None):
 args=['npm','exec','--','vitest','run',*['src/test/'+s for s in sorted(set(files))],'--maxWorkers=1']
 if pattern:args+=['-t',pattern]
 with (out/(name+'.log')).open('w') as log:
  result=subprocess.run(args,cwd=root,env={**os.environ,'NODE_OPTIONS':'--max-old-space-size=6144'},stdout=log,stderr=subprocess.STDOUT,timeout=120)
 return result.returncode
mutations=[
 ('cursor-pair','route','Boolean(parsed.data.beforeId) !== Boolean(parsed.data.beforeCreatedAt)','false','rejects ambiguous query'),
 ('choice-readback','recovery','if (storage.getItem(name) !== raw) throw new Error("The context choice could not be retained in this browser");','if (false) throw new Error("The context choice could not be retained in this browser");','refuses storage dropWrite'),
 ('newer-copy','recovery','storage.getItem(key(pending)) !== raw','false','keeps newer commands'),
 ('archive-scope','recovery','!name?.startsWith(prefix)','!name?.includes(":preserved:")','lists exact preserved bytes'),
 ('command-account','recovery','!sameScope(pending, scope)','false','separates userId'),
 ('discovery-target','discovery','binding.targetRecordId === targetRecordId','true','different targetRecordId'),
 ('discovery-manifest','discovery','binding.contextManifestSha256 === request.binding.contextManifestSha256','true','different contextManifestSha256'),
 ('discovery-parent','discovery','parent.intent.sourceSha256 !== request.intent.sourceSha256','false','different parent source'),
 ('discovery-final-read','discovery','const current = await read(client, scope, signal);','const current = previous;','late access loss'),
 ('saved-choice-checksum','contract','await digest(choice.choiceText) !== choice.choiceSha256','false','browser checks reject'),
 ('preview-progress','choice','progress.status !== "frames_complete"','false','changed incomplete'),
 ('preview-manifest','choice','JSON.parse(result.command.expected.choiceText).historyManifestSha256 !== progress.manifestSha256','false','changed manifest'),
 ('preview-intent','choice','result.command.expected.requestIntentSha256 !== requestIntentSha256','false','changed intent'),
 ('preview-thematic','choice','result.command.expected.thematicSha256 !== thematicSha256','false','changed thematic'),
 ('choice-account-remount','choice','${props.userId}:','fixed:','clears an already inspected private preview'),
 ('coverage-total','inputs','data.rows.length === data.total','true','does not report readiness'),
 ('coverage-empty-choice','inputs','data.rows.every(row => row.choice !== null)','true','unchosen contribution'),
 ('coverage-duplicate','inputs','page.page.entries.some(row => previous.rows.some(old => old.recordId === row.recordId))','false','changed duplicate'),
 ('preparation-coverage','preparation','(stage !== "thematic" || thematicInputsReady)','true','requires whole-source'),
 ('theme-parent-proposal','continuation','stage: "thematic"','stage: "context"','reads only on demand'),
]
try:
 for key,path in paths.items():(root/path).write_bytes(original[key]+b'\n// Harmless verification comment.\n')
 code=run('harmless',suites.values());rows.append({'case':'harmless','exitCode':code,'expected':'pass'})
 if code:raise RuntimeError('Harmless control failed')
 for key,path in paths.items():(root/path).write_bytes(original[key])
 for name,key,old,new,pattern in mutations:
  try:
   text=original[key].decode()
   if text.count(old)!=1:raise RuntimeError('Ambiguous mutation: '+name+' count='+str(text.count(old)))
   (root/paths[key]).write_text(text.replace(old,new))
   code=run(name,[suites[key]],pattern);log=(out/(name+'.log')).read_text()
   matched=code!=0 and 'FAIL ' in log and ('AssertionError' in log or 'TestingLibraryElementError' in log or 'Error: expect(element).toBeDisabled()' in log)
   rows.append({'case':name,'exitCode':code,'expected':'targeted failure','testPattern':pattern,'markerMatched':matched})
   if not matched:raise RuntimeError('Unexpected control outcome: '+name)
  finally:(root/paths[key]).write_bytes(original[key])
finally:
 for key,path in paths.items():(root/path).write_bytes(original[key])
 restored=all((root/path).read_bytes()==original[key] for key,path in paths.items())
 (out/'report.json').write_text(json.dumps({'checkedAt':time.time(),'results':rows,'restored':restored,'sourceSha256':{paths[key]:hashlib.sha256(value).hexdigest() for key,value in original.items()}},indent=2)+'\n')
print(json.dumps({'controls':len(rows),'restored':restored}))
