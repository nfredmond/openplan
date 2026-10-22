"""Reseal only this newly owned preparation packet. No operating stages."""
import difflib
import hashlib
import json
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v4')
OLD=Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015')
V3=Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015-v3')
HOST=Path('/home/nathaniel/.local/state/openplan/current-project-preview-host-attestation-v2-20261015')
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def js(p,v):p.write_text(json.dumps(v,indent=2)+'\n');p.chmod(0o600)
def main():
 manifest=json.loads((HERE/'manifest.json').read_text())
 if not (ROOT/'preparation-01-manifest.json').exists():
  (ROOT/'preparation-01-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
  (ROOT/'preparation-01-seal.txt').write_bytes((ROOT/'operation-files.sha256').read_bytes())
 h=(ROOT/'helper.py').read_text().split('# V4 additions use only this new target.',1)[0]
 h=h.replace(' Old operational entrypoints are absent.\n','')
 h+=(HERE/'helper_additions.py.txt').read_text()
 # Python files remain non-executable sealed inputs.
 (ROOT/'helper.py').write_text(h)
 a=(ROOT/'app_binding_v1.py').read_text()
 start=a.index('HELPERS = ');end=a.index('\nGiB',start)
 a=a[:start]+'HELPERS = '+repr({n:sha(ROOT/n) for n in ['helper.py','policy.py']})+a[end:]
 # Distinguish new helper build identity from the retained original source lineage.
 a=a.replace("HELPER_HEAD = '06a108010ab39aa42eed4c2bcda3e1371b8aa813'", "HELPER_HEAD = APP_HEAD")
 a=a.replace("RECOVERY_PRODUCER = 'd71e0aa7aa1b2c3c945ee87a54ea49d6a5772378'", "RECOVERY_PRODUCER = APP_HEAD")
 lines=a.splitlines(True)
 a=''.join(line for line in lines if not line.startswith(('ACTIVE_REST_ID =','OPERATION_OBSERVATION =','ACTIVE =')))
 (ROOT/'app_binding_v1.py').write_text(a)
 t=(ROOT/'attest_start_v1.py').read_text();start=t.index("BINDING_SHA = '")+len("BINDING_SHA = '")
 t=t[:start]+sha(ROOT/'app_binding_v1.py')+t[start+64:];(ROOT/'attest_start_v1.py').write_text(t)
 (ROOT/'run_stage.sh').write_bytes((HERE/'templates/run_stage.sh').read_bytes())
 b=json.loads((ROOT/'binding-private.json').read_text());b['helperHead']=b['producer']=manifest['appHead']
 b['files']={n:sha(ROOT/n) for n in b['files']};js(ROOT/'binding-private.json',b)
 js(ROOT/'template-binding.json',{n:sha(ROOT/n) for n in ['policy.py','helper.py']})
 # Private bindings are unchanged except hashes remain freshly self-consistent.
 b=json.loads((ROOT/'private-bindings.json').read_text());js(ROOT/'private-bindings.json',{n:sha(ROOT/n) for n in b})
 origins={'helper.py':OLD/'launcher.py','policy.py':OLD/'rest_uri_recovery_01_policy.py','app_binding_v1.py':V3/'app_binding_v1.py','attest_start_v1.py':HOST/'attest_start_v2.py','run_stage.sh':V3/'run_stage_v3.sh'}
 for n,base in origins.items():
  text=(ROOT/n).read_text();(HERE/'templates'/n).write_text(text)
  (HERE/(n+'.patch')).write_text(''.join(difflib.unified_diff(base.read_text().splitlines(True),text.splitlines(True),fromfile=str(base),tofile=n,n=0)))
 files={n:sha(ROOT/n) for n in manifest['files']}
 (ROOT/'operation-files.sha256').write_text(''.join(h+'  '+str(ROOT/n)+'\n' for n,h in sorted(files.items())))
 manifest.update(files=files,checksumListSHA256=sha(ROOT/'operation-files.sha256'),preparationCorrections=['All runtime stages use absolute entry paths.','Active-check/checkout retain the original outer readonly wrapper.','Upgrade transaction refuses another target connection.','New helper and producer metadata identify exact 49e3fa200.'])
 (HERE/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');js(ROOT/'preparation.json',manifest)
 for p in ROOT.iterdir():
  if p.is_file():p.chmod(0o700 if p.name=='run_stage.sh' else 0o600)
 print(json.dumps({'sealed':True,'files':len(files),'candidateAbsent':not (ROOT/'candidate').exists()}))
if __name__=='__main__':main()
