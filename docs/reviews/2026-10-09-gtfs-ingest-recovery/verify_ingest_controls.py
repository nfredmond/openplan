"""Ensure failed stage/custody writes actually stop the ingest sequence."""
import json
from pathlib import Path
import subprocess

root=Path(__file__).resolve().parents[3]
app=root/'openplan'
ingest=app/'src/lib/gtfs/ingest.ts'
persist=app/'src/lib/gtfs/persist.ts'
original={ingest:ingest.read_text(),persist:persist.read_text()}
cases=[('baseline',None,None,None,True),('harmless',ingest,'','// harmless control\n',True),
       ('ignore_fetching_refusal',ingest,'if (!(await markGtfsFeedVersionStage(service, versionId, "fetching")))','if (false)',False),
       ('ignore_parsing_refusal',ingest,'if (!(await markGtfsFeedVersionStage(service, versionId, "parsing")))','if (false)',False),
       ('ignore_object_refusal',ingest,'if (!(await recordUploadedObject(service, versionId, path, byteSize, checksumSha256)))','if (false)',False),
       ('misreport_stage_error',persist,'return !result.error && !writeMatchedNoRows(result);','return !writeMatchedNoRows(result);',False),
       ('misreport_object_error',ingest,'return !result.error && !writeMatchedNoRows(result);','return !writeMatchedNoRows(result);',False),
       ('restored',None,None,None,True)]
results=[]
try:
    for name,path,old,new,expected in cases:
        for p,s in original.items():p.write_text(s)
        if path:
            if old:assert original[path].count(old)==1
            path.write_text(original[path].replace(old,new,1) if old else new+original[path])
        r=subprocess.run([str(app/'node_modules/.bin/vitest'),'run','src/test/gtfs-ingest-closure.test.ts','--maxWorkers=1'],cwd=app,text=True,capture_output=True,timeout=60)
        if (r.returncode==0)!=expected or (not expected and 'AssertionError' not in r.stdout+r.stderr):
            raise SystemExit(f'{name}: {r.stdout}\n{r.stderr}')
        results.append({'case':name,'expectedPass':expected,'returnCode':r.returncode})
finally:
    for p,s in original.items():p.write_text(s)
print(json.dumps(results,indent=2))
