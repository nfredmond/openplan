"""Validate scan argument custody and reply refusal controls through the SDK."""
from pathlib import Path
import hashlib,json,subprocess,sys
here=Path(__file__).resolve().parent;root=here.parents[2];path=root/'openplan/src/lib/gtfs/managed-worker-service.ts';original=path.read_text();out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=False)
def change(before,after):
 assert original.count(before)==1,before
 return original.replace(before,after)
variants=[('baseline',original,None),('harmless',original+'\n// Harmless scan client control.\n',None),
 ('endpoint',change('"scan_gtfs_ingest_candidates", { p_limit: boundedLimit','"list_gtfs_ingest_candidates", { p_limit: boundedLimit'),'exact native scan cursor'),
 ('cursor',change('p_after: after === null ? null : id.parse(after)','p_after: null'),'exact native scan cursor'),
 ('cursor-validation',change('p_after: after === null ? null : id.parse(after)','p_after: after'),'invalid cursor identity'),
 ('bounds',change('const boundedLimit = z.number().int().min(1).max(100).parse(limit);','const boundedLimit = limit;'),'scan limit'),
 ('row-bound',change(').strict()).max(boundedLimit).parse(raw)',').strict()).parse(raw)'),'inconsistent scan reply'),
 ('restored',original,None)]
records=[]
try:
 for name,source,assertion in variants:
  path.write_text(source);report=out/f'{name}.json';result=subprocess.run([str(root/'openplan/node_modules/.bin/vitest'),'run','src/test/gtfs-candidate-cursor.test.ts','--maxWorkers=1','--reporter=json',f'--outputFile={report}'],cwd=root/'openplan',capture_output=True,text=True,timeout=25);(out/f'{name}.log').write_text(result.stdout+result.stderr)
  data=json.loads(report.read_text());failures=[t['fullName'] for suite in data['testResults'] for t in suite['assertionResults'] if t['status']=='failed']
  if assertion:assert result.returncode!=0 and any(assertion in case for case in failures),(name,failures)
  else:assert result.returncode==0 and not failures,(name,failures)
  records.append({'variant':name,'result':'expected assertion failure' if assertion else 'pass','failedAssertions':failures});print(name,records[-1]['result'],flush=True)
finally:path.write_text(original)
(out/'result.json').write_text(json.dumps({'records':records,'sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'testSha256':hashlib.sha256((root/'openplan/src/test/gtfs-candidate-cursor.test.ts').read_bytes()).hexdigest()},indent=2)+'\n')
