"""Keep parser-output decoding distinct from planner or agent input schemas."""
from pathlib import Path
import hashlib,json,subprocess,sys
here=Path(__file__).resolve().parent;root=here.parents[2]
artifact=root/'openplan/src/lib/gtfs/parsed-artifact.ts';original=artifact.read_text()
guard=root/'openplan/src/test/a-gtfs-tier-comes-only-from-the-parser.test.ts'
probe=root/'openplan/src/app/api/gtfs/archive-reconciliation-probe.ts'
assert not probe.exists()
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=False)
variants=[('baseline',original,None,None),('harmless',original+'\n// Harmless parser decoder comment.\n',None,None),
 ('new-request-shape',original+'\nconst request = z.object({ medianHeadwayBasis: z.string() });\n',None,'no request-capable zod schema declares medianHeadwayBasis'),
 ('export-level',original.replace('const level = z.object','export const level = z.object'),None,'keeps the saved-parser schema private'),
 ('route-import',original,'import { decodeGtfsParsedArtifact } from "@/lib/gtfs/parsed-artifact";\n','keeps the saved-parser schema private'),
 ('restored',original,None,None)]
records=[]
try:
 for name,source,probe_source,failure in variants:
  artifact.write_text(source)
  if probe_source is not None:
   with probe.open('x') as handle:handle.write(probe_source)
  result=subprocess.run([str(root/'openplan/node_modules/.bin/vitest'),'run','src/test/a-gtfs-tier-comes-only-from-the-parser.test.ts','--maxWorkers=1'],cwd=root/'openplan',text=True,capture_output=True,timeout=40)
  (out/f'{name}.log').write_text(result.stdout+result.stderr)
  if failure is None:assert result.returncode==0,(name,result.stderr[-2000:])
  else:assert result.returncode!=0 and failure in result.stdout+result.stderr,(name,result.returncode)
  probe.unlink(missing_ok=True)
  records.append({'variant':name,'result':'pass' if failure is None else 'expected assertion failure','assertion':failure})
finally:
 artifact.write_text(original);probe.unlink(missing_ok=True)
result={'guardSha256':hashlib.sha256(guard.read_bytes()).hexdigest(),'artifactSha256':hashlib.sha256(original.encode()).hexdigest(),'records':records}
(out/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
