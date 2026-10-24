"""Exercise the import guard through scoped Vitest with temporary owned files."""
import hashlib
import json
from pathlib import Path
import subprocess
ROOT=Path(__file__).resolve().parents[4]
original=ROOT/'openplan/src/test/modeling-requirements-cover-the-modeling-imports.test.ts'
source=original.read_text()
test=original.with_name('transit-dependency-mutation.test.ts')
module=ROOT/'scripts/modeling/transit_dependency_mutation.py'
if test.exists() or module.exists():raise RuntimeError('Owned temporary path is occupied')
records=[]
try:
    for name,test_source,extra,expected in [
        ('harmless_comment',source+'\n// Harmless import-guard mutation.\n',None,0),
        ('bisect_not_admitted',source.replace('"bisect", ',''),None,1),
        ('undeclared_library',source,'import transit_library_not_installed\n',1),
    ]:
        test.write_text(test_source)
        if extra:module.write_text(extra)
        r=subprocess.run(['npm','exec','--','vitest','run','src/test/'+test.name,'--pool=forks','--maxWorkers=2'],cwd=ROOT/'openplan',capture_output=True,text=True)
        text=r.stdout+r.stderr
        valid=(r.returncode==0) if expected==0 else (r.returncode!=0 and ('bisect' if name=='bisect_not_admitted' else 'transit_library_not_installed') in text and 'AssertionError' in text)
        records.append({'mutation':name,'verified':valid,'exit_code':r.returncode,'output':text})
        print(name,valid)
        if module.exists():module.unlink()
        if not valid:break
finally:
    test.unlink(missing_ok=True);module.unlink(missing_ok=True)
Path(__file__).with_name('dependency-mutations.json').write_text(json.dumps({'cases':records,'source_sha256':hashlib.sha256(source.encode()).hexdigest(),'source_unchanged':original.read_text()==source,'skipped':3-len(records)},indent=2)+'\n')
raise SystemExit(not all(r['verified'] for r in records) or len(records)!=3)
