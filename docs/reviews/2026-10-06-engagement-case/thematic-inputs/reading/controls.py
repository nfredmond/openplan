import hashlib,json,os,subprocess,sys,time
from pathlib import Path
root=Path(sys.argv[1]).resolve();out=Path(sys.argv[2]).resolve();out.mkdir(exist_ok=False)
paths={'reader':'src/components/engagement/synthesis-context-output-reader.tsx','choice':'src/components/engagement/synthesis-thematic-context-choice.tsx','command':'src/lib/engagement/synthesis-thematic-choice-command.ts','route':'src/app/api/engagement/campaigns/[campaignId]/synthesis/thematic-choices/route.ts','schema':'src/lib/engagement/synthesis-context-output.ts','engine':'src/lib/engagement/synthesis-context-continuation.ts'}
suites={'reader':'engagement-synthesis-context-output-reader.test.tsx','choice':'engagement-synthesis-thematic-choice-panel.test.tsx','command':'engagement-synthesis-thematic-choice-command.test.ts','route':'engagement-synthesis-thematic-choice-route.test.ts','schema':'engagement-synthesis-context-continuation.test.ts','engine':'engagement-synthesis-context-history-server.test.ts'}
original={key:(root/path).read_bytes() for key,path in paths.items()};rows=[]
def run(name,files,pattern=None):
 args=['npm','exec','--','vitest','run',*['src/test/'+s for s in sorted(set(files))],'--maxWorkers=1']
 if pattern:args+=['-t',pattern]
 with (out/(name+'.log')).open('w') as log:r=subprocess.run(args,cwd=root,env={**os.environ,'NODE_OPTIONS':'--max-old-space-size=6144'},stdout=log,stderr=subprocess.STDOUT,timeout=120)
 return r.returncode
mutations=[
 ('full-output-hash','command','preview.outputSha256 !== await digest(preview.outputText)','false','verifies complete output beyond'),
 ('completed-output','command','output.status !== "complete"','false','self-hashed incomplete'),
 ('original-api-output','route','outputText: prepared.outputText,','outputText: prepared.outputText.slice(0, 1600),','returns a bounded preview'),
 ('saved-choice-custody','choice','result.command.expected.choiceText !== saved.choiceText','false','self-hashed replacement'),
 ('wording-display','reader','{note.text}','{"SYNTHETIC omitted wording"}','shows generated wording'),
 ('uncertainty-display','reader','>{text}</li>','>{"SYNTHETIC omitted uncertainty"}</li>','shows generated wording'),
 ('notes-pagination','reader','value => value + 20','value => value','pages notes and uncertainties'),
 ('reader-reset','reader','`${contextRequestId}:${outputSha256}`','contextRequestId','pages notes and uncertainties'),
 ('original-download','reader','new Blob([outputText]','new Blob([JSON.stringify(JSON.parse(outputText))]','downloads the exact original'),
 ('quotation-required','schema','z.array(citationSchema).min(1)','z.array(citationSchema)','malformed, truncated, partial and uncited'),
 ('codepoint-bound','schema','Array.from(text).length <= 4000','true','matches Unicode code-point'),
]
try:
 for key,path in paths.items():(root/path).write_bytes(original[key]+b'\n// Harmless verification comment.\n')
 code=run('harmless',suites.values());rows.append({'case':'harmless','exitCode':code,'expected':'pass'})
 if code:raise RuntimeError('Harmless control failed')
 for key,path in paths.items():(root/path).write_bytes(original[key])
 for name,key,old,new,pattern in mutations:
  try:
   s=original[key].decode();count=s.count(old)
   if count!=(2 if name=='notes-pagination' else 1):raise RuntimeError('Ambiguous mutation '+name+' '+str(count))
   (root/paths[key]).write_text(s.replace(old,new))
   code=run(name,[suites[key]],pattern);log=(out/(name+'.log')).read_text()
   matched=code!=0 and 'FAIL ' in log and any(marker in log for marker in ['AssertionError','TestingLibraryElementError','Error: expect(element)'])
   rows.append({'case':name,'exitCode':code,'expected':'targeted failure','testPattern':pattern,'markerMatched':matched})
   if not matched:raise RuntimeError('Unexpected control outcome '+name)
  finally:(root/paths[key]).write_bytes(original[key])
finally:
 for key,path in paths.items():(root/path).write_bytes(original[key])
 restored=all((root/path).read_bytes()==original[key] for key,path in paths.items())
 (out/'report.json').write_text(json.dumps({'checkedAt':time.time(),'results':rows,'restored':restored,'sourceSha256':{paths[key]:hashlib.sha256(value).hexdigest() for key,value in original.items()}},indent=2)+'\n')
print(json.dumps({'controls':len(rows),'restored':restored}))
