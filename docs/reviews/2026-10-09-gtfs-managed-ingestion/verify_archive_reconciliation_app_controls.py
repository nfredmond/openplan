"""Exercise the cleanup response checks; restore the isolated source in finally."""
from pathlib import Path
import hashlib,json,subprocess,sys
here=Path(__file__).resolve().parent;root=here.parents[2]
path=root/'openplan/src/lib/gtfs/persist.ts';original=path.read_text()
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=False)
def changed(before,after):
 assert original.count(before)==1,before
 return original.replace(before,after)
variants=[('baseline',original,True),('harmless',original+'\n// Harmless cleanup control.\n',True),
 ('path-shape',changed('storage_path: z.string().regex(new RegExp(`^${uuid}/${uuid}/${uuid}\\\\.zip$`)),','storage_path: z.string(),'),False),
 ('version-match',changed('.strict().refine(row => row.storage_path.endsWith(`/${row.version_id}.zip`))','.strict()'),False),
 ('page-size',changed('.max(200).safeParse(cleanup.data)','.safeParse(cleanup.data)'),False),
 ('duplicate-version',changed(' || new Set(candidates.data.map(row => row.version_id)).size !== candidates.data.length',''),False),
 ('extra-fields',changed('}).strict().refine(row => row.storage_path.endsWith','}).refine(row => row.storage_path.endsWith'),False),
 ('stop-at-first-failure',changed('      firstFailure ??= error;','      throw error;'),False),
 ('restored',original,True)]
records=[]
try:
 for name,source,passes in variants:
  path.write_text(source)
  result=subprocess.run([str(root/'openplan/node_modules/.bin/vitest'),'run','src/test/gtfs-reaper-rpc.test.ts','--maxWorkers=1'],cwd=root/'openplan',text=True,capture_output=True,timeout=30)
  (out/f'{name}.log').write_text(result.stdout+result.stderr)
  if passes:assert result.returncode==0,(name,result.stderr[-1500:])
  else:
   expected='continues cleanup after one object fails' if name=='stop-at-first-failure' else 'refuses malformed reconciliation before Storage writes'
   assert result.returncode!=0 and expected in result.stdout+result.stderr,(name,result.returncode)
  records.append({'variant':name,'result':'pass' if passes else 'expected assertion failure'})
finally:path.write_text(original)
assert path.read_text()==original
result={'sourceSha256':hashlib.sha256(original.encode()).hexdigest(),'testSha256':hashlib.sha256((root/'openplan/src/test/gtfs-reaper-rpc.test.ts').read_bytes()).hexdigest(),'records':records}
(out/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
