import hashlib,json,os,subprocess,time,sys
from pathlib import Path
root=Path(sys.argv[1]).resolve();out=Path(sys.argv[2]).resolve();out.mkdir(exist_ok=False)
paths={"server":"src/lib/engagement/synthesis-thematic-choices-server.ts","contract":"src/lib/engagement/synthesis-thematic-choice-command.ts","route":"src/app/api/engagement/campaigns/[campaignId]/synthesis/thematic-choices/route.ts"}
original={key:(root/path).read_bytes() for key,path in paths.items()}
suites={"server":"engagement-synthesis-thematic-choices-server.test.ts","contract":"engagement-synthesis-thematic-choice-command.test.ts","route":"engagement-synthesis-thematic-choice-route.test.ts"}
rows=[]
def run(name,files,pattern=None):
 command=["npm","exec","--","vitest","run",*["src/test/"+file for file in files],"--maxWorkers=1"]
 if pattern:command += ["-t",pattern]
 with (out/(name+".log")).open("w") as log:
  result=subprocess.run(command,cwd=root,env={**os.environ,"NODE_OPTIONS":"--max-old-space-size=6144"},stdout=log,stderr=subprocess.STDOUT,timeout=120)
 return result.returncode
mutations=[
 ("inspected-intent","server","expected.requestIntentSha256 !== request.state.request.intentSha256","false","altered inspected requestIntentSha256"),
 ("inspected-request","server","expected.thematicSha256 !== request.state.thematic.thematicSha256","false","altered inspected thematicSha256"),
 ("inspected-choice","server","expected.choiceText !== choiceText","false","altered inspected choiceText"),
 ("late-access","server","const current = await readSynthesisThematicRequest(client, scope, signal);","const current = request;","late access loss"),
 ("receipt-bytes","contract","record.choiceText !== command.expected.choiceText","false","self-hashed substituted"),
 ("receipt-actor","contract","record.createdBy !== scope.actorId","false","altered receipt createdBy"),
 ("preview-hash","contract","preview.choiceSha256 !== await digest(preview.command.expected.choiceText)","false","altered preview choiceSha256"),
 ("choice-sequence","contract","choice.data.selectionSequence !== command.throughSequence","false","different selectionSequence"),
 ("workspace-header","route",'request.headers.get("x-openplan-expected-workspace") !== workspaceId',"false","changed-workspace"),
 ("agent-refusal","route",'.some(key => request.headers.has(key))',".some(() => false)","unregistered agent marker"),
]
try:
 for key,path in paths.items():(root/path).write_bytes(original[key]+b"\n// Harmless verification comment.\n")
 code=run("harmless",list(suites.values()));rows.append({"case":"harmless","exitCode":code,"expected":"pass"})
 if code:raise RuntimeError("Harmless control failed")
 for key,path in paths.items():(root/path).write_bytes(original[key])
 for name,key,old,new,pattern in mutations:
  try:
   text=original[key].decode()
   if text.count(old)!=1:raise RuntimeError("Ambiguous mutation: "+name)
   (root/paths[key]).write_text(text.replace(old,new))
   code=run(name,[suites[key]],pattern);body=(out/(name+".log")).read_text()
   matched=code!=0 and "FAIL " in body and "AssertionError" in body
   rows.append({"case":name,"exitCode":code,"expected":"targeted failure","testPattern":pattern,"markerMatched":matched})
   if not matched:raise RuntimeError("Unexpected control outcome: "+name)
  finally:(root/paths[key]).write_bytes(original[key])
finally:
 for key,path in paths.items():(root/path).write_bytes(original[key])
 restored=all((root/path).read_bytes()==original[key] for key,path in paths.items())
 (out/"report.json").write_text(json.dumps({"checkedAt":time.time(),"results":rows,"restored":restored,"sourceSha256":{key:hashlib.sha256(value).hexdigest() for key,value in original.items()}},indent=2)+"\n")
print(json.dumps({"controls":len(rows),"restored":restored}))
