"""Mutate only root-owned fixes and restore exact bytes, even on failure."""
from pathlib import Path
import subprocess,json
root=Path(__file__).resolve().parents[4]
app=root/'openplan';out=Path(__file__).resolve().parent
cases=[
 ('rounding','src/lib/measures/allocation.ts','src/test/measure-allocation-arithmetic.test.ts',lambda s:s.replace('const adjustment = remainingResidual < -current ? -current : remainingResidual;', 'const adjustment = remainingResidual;'), 'does not debit a zero-weight'),
 ('reporting','src/lib/programs/work-program/reporting-server.ts','src/test/work-program-reporting-pagination.test.ts',lambda s:s.replace('return read.rows;', 'return read.rows.slice(0, 50);'), 'advances by returned rows'),
 ('preparation','src/lib/programs/work-program/server.ts','src/test/work-program-access.test.ts',lambda s:s.replace('rows.length === 0', 'rows.length < 100'), 'captures the latest revision'),
 ('dashboard','src/lib/operations/workspace-summary.ts','src/test/workspace-summary.test.ts',lambda s:s.replace('.eq("projects.workspace_id", workspaceId)', '.eq("workspace_id", workspaceId)'), 'projects.workspace_id'),
 ('export','src/lib/project-evidence-bundles/generated-records.ts','src/test/project-evidence-generated-pagination.test.ts',lambda s:s.replace('data: result.rows, error: null','data: result.rows.slice(0, 3), error: null'), 'preserves every model'),
]
results=[]
for name,file,test,mutate,expected in cases:
 p=app/file;original=p.read_bytes()
 try:
  for mode in ['noop','broken']:
   source=original.decode();changed=source+'\n// Harmless review mutation.\n' if mode=='noop' else mutate(source)
   assert changed!=source
   p.write_text(changed)
   result=subprocess.run([str(app/'node_modules/.bin/vitest'),'run',test],cwd=app,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
   (out/f'root-mutation-{name}-{mode}.log').write_text(result.stdout)
   if mode=='noop':assert result.returncode==0,(name,'harmless mutation did not survive')
   else:
    assert result.returncode!=0,(name,'defect survived')
    assert expected in result.stdout and 'AssertionError' in result.stdout,(name,'wrong failure')
   results.append({'guard':name,'mutation':mode,'exit':result.returncode,'outcome':'survived' if mode=='noop' else 'detected by intended assertion'})
 finally:p.write_bytes(original)
(out/'root-mutations.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2))
