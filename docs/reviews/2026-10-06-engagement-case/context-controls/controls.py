import hashlib,json,os,subprocess,time,sys
from pathlib import Path
root=Path(sys.argv[1]).resolve();out=Path(sys.argv[2]).resolve();out.mkdir(exist_ok=False)
paths={
 "recovery":"src/lib/engagement/synthesis-generation-request-recovery.ts",
 "browser":"src/lib/engagement/synthesis-continuation-browser.ts",
 "records":"src/lib/engagement/synthesis-continuation-records.ts",
 "form":"src/components/engagement/synthesis-generation-create-panel.tsx",
 "progress":"src/components/engagement/synthesis-progress-panel.tsx",
 "picker":"src/components/engagement/synthesis-continuation-panel.tsx",
}
original={key:(root/path).read_bytes() for key,path in paths.items()}
suites=["engagement-synthesis-generation-request-recovery.test.ts","engagement-synthesis-continuation-recovery.test.ts","engagement-synthesis-continuation-panel.test.tsx","engagement-synthesis-generation-create-panel.test.tsx","engagement-synthesis-progress-panel.test.tsx","engagement-synthesis-continuation-records.test.ts"]
rows=[]
def run(name,files):
 with (out/(name+".log")).open("w") as log:
  result=subprocess.run(["npm","exec","--","vitest","run",*["src/test/"+file for file in files],"--maxWorkers=1"],cwd=root,env={**os.environ,"NODE_OPTIONS":"--max-old-space-size=6144"},stdout=log,stderr=subprocess.STDOUT,timeout=120)
 return result.returncode
try:
 for key,path in paths.items():(root/path).write_bytes(original[key]+b"\n// Harmless verification comment.\n")
 code=run("harmless",suites);rows.append({"case":"harmless","exitCode":code,"expected":"pass"})
 if code:raise RuntimeError("Harmless control failed")
finally:
 for key,path in paths.items():(root/path).write_bytes(original[key])
mutations=[
 ("contribution-slot","recovery",'parsed.stage === "context" ? parsed.targetRecordId : "all"','"all"',[suites[1]],"separates parents"),
 ("immutable-parent-actor","recovery",'["parentRequestId", "parentActorId", "parentIntentSha256", "sourceId", "sourceSha256"]','["parentRequestId", "parentIntentSha256", "sourceId", "sourceSha256"]',[suites[1]],"parentActorId"),
 ("context-target","browser",'parsed.targetRecordId !== command.targetRecordId','false',[suites[1]],"altered child target"),
 ("context-checksum","browser",'await digest(context.contextText) !== context.contextSha256','false',[suites[1]],"altered child checksum"),
 ("selection-sequence","browser",'binding.selectionSequence !== command.parent.throughSequence','false',[suites[1]],"altered child sequence"),
 ("child-stage","form",'stage={stage}','stage="segment"',[suites[3]],"retries it after remount"),
 ("progress-handoff","progress",'summary?.stage === "segment"','false',[suites[4]],"completed segment output"),
 ("picker-manifest","picker",'.some(key => page.parent[key] !== expected[key])','.some(key => key !== "segmentResultsManifestSha256" && page.parent[key] !== expected[key])',[suites[2]],"contribution page manifest"),
 ("cross-page-duplicate","picker",'page.entries.some(row => previous.entries.some(saved => saved.recordId === row.recordId))','false',[suites[2]],"contribution page duplicate"),
 ("account-remount","picker",'${props.userId}:${props.workspaceId}','${props.workspaceId}',[suites[2]],"changed account"),
]
try:
 for name,key,old,new,files,marker in mutations:
  try:
   text=original[key].decode()
   if text.count(old)!=1:raise RuntimeError("Ambiguous mutation target: "+name)
   (root/paths[key]).write_text(text.replace(old,new))
   code=run(name,files);body=(out/(name+".log")).read_text()
   matched=code!=0 and "FAIL " in body and marker in body and ("AssertionError" in body or "TestingLibraryElementError" in body or name == "account-remount" and 'Error: expect(element).toHaveAttribute("aria-expanded", "false")' in body or name == "contribution-slot" and "Error: Generation recovery belongs to another source, account or operation" in body)
   rows.append({"case":name,"exitCode":code,"expected":"targeted failure","failureMarker":marker,"markerMatched":matched})
   if not matched:raise RuntimeError("Unexpected mutation outcome: "+name)
  finally:(root/paths[key]).write_bytes(original[key])
finally:
 restored=all((root/path).read_bytes()==original[key] for key,path in paths.items())
 (out/"report.json").write_text(json.dumps({"checkedAt":time.time(),"results":rows,"restored":restored,"sourceSha256":{key:hashlib.sha256(value).hexdigest() for key,value in original.items()}},indent=2)+"\n")
print(json.dumps({"controls":len(rows),"restored":restored}))
