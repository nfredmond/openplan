import hashlib,json,os,subprocess,time,sys
from pathlib import Path
root=Path(sys.argv[1]).resolve()
out=Path(sys.argv[2]).resolve();out.mkdir(exist_ok=False)
files={name:root/"src/lib/engagement"/("synthesis-continuation-"+name+".ts") for name in ["records","server"]}
files["route"]=root/"src/app/api/engagement/campaigns/[campaignId]/synthesis/continuation/route.ts"
original={key:path.read_bytes() for key,path in files.items()}
reports=[]
def run(name,suites):
    log=out/(name+".log")
    with log.open("w") as stream:
        result=subprocess.run(["npm","exec","--","vitest","run",*["src/test/engagement-synthesis-continuation-"+suite+".test.ts" for suite in suites],"--maxWorkers=1"],cwd=root,env={**os.environ,"NODE_OPTIONS":"--max-old-space-size=6144"},stdout=stream,stderr=subprocess.STDOUT,timeout=120)
    return result.returncode,log.name
try:
    for path in files.values(): path.write_text(path.read_text()+"\n// Harmless verification comment.\n")
    code,log=run("harmless",["records","server","route"])
    reports.append({"case":"harmless comments","exitCode":code,"log":log,"expected":"pass"})
    if code!=0: raise RuntimeError("Harmless control failed")
finally:
    for key,path in files.items(): path.write_bytes(original[key])
mutations=[
 ("source-intent-pin","records","intent.data.sourceSha256 !== value.parent.sourceSha256","false",["records"]),
 ("page-duplicates","records","new Set(page.entries.map(row => row.recordId)).size !== page.entries.length","false",["records"]),
 ("manifest-pin","server","history.inventory.manifestSha256 !== parent.segmentResultsManifestSha256","false",["server"]),
 ("sealed-plan","server",'if (await readSynthesisProgressPlan(service, history.selections.plan, signal) !== "sealed") conflict();','await readSynthesisProgressPlan(service, history.selections.plan, signal);',["server"]),
 ("initial-access","server","  await readParent(client, scope, parent, signal);","  // Deliberate omitted initial access check.",["server"]),
 ("whole-membership","server","if (rows.size !== ids.length || ids.some(recordId => !rows.has(recordId))) conflict();","// Deliberate omitted membership check.",["server"]),
 ("expected-account","route",'request.headers.get("x-openplan-expected-user") !== user.id','false',["route"]),
 ("agent-refusal","route",'.some(key => request.headers.has(key))','.some(() => false)',["route"]),
]
for name,key,old,new,suites in mutations:
    try:
        text=original[key].decode()
        if old not in text: raise RuntimeError("Mutation target absent: "+name)
        files[key].write_text(text.replace(old,new,1))
        code,log=run(name,suites)
        reports.append({"case":name,"exitCode":code,"log":log,"expected":"targeted failure"})
        if code==0: raise RuntimeError("Fault survived: "+name)
    finally: files[key].write_bytes(original[key])
restored=all(path.read_bytes()==original[key] for key,path in files.items())
(out/"report.json").write_text(json.dumps({"checkedAt":time.time(),"controls":reports,"restored":restored,"sha256":{key:hashlib.sha256(value).hexdigest() for key,value in original.items()}},indent=2)+"\n")
print(json.dumps({"controls":len(reports),"restored":restored,"allExpected":True}))
