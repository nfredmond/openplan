"""Reseal this new v5 preparation only. No operation or observer dispatch."""
import difflib
import hashlib
import json
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v5')
V4=Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v4')
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def js(p,v):p.write_text(json.dumps(v,indent=2)+'\n')
def main():
 m=json.loads((HERE/'manifest.json').read_text())
 if not (ROOT/'preparation-01-manifest.json').exists():js(ROOT/'preparation-01-manifest.json',m)
 app=(ROOT/'app_binding_v1.py').read_text();start=app.index('HELPERS = ');end=app.index('\nGiB',start)
 app=app[:start]+'HELPERS = '+repr({n:sha(ROOT/n) for n in ['helper.py','policy.py']})+app[end:];(ROOT/'app_binding_v1.py').write_text(app)
 t=(ROOT/'attest_start_v1.py').read_text();start=t.index("BINDING_SHA = '")+len("BINDING_SHA = '");t=t[:start]+sha(ROOT/'app_binding_v1.py')+t[start+64:];(ROOT/'attest_start_v1.py').write_text(t)
 for n in ['private-bindings.json','template-binding.json']:
  b=json.loads((ROOT/n).read_text());js(ROOT/n,{name:sha(ROOT/name) for name in b})
 b=json.loads((ROOT/'binding-private.json').read_text());b['files']={n:sha(ROOT/n) for n in b['files']};js(ROOT/'binding-private.json',b)
 for n in ['helper.py','policy.py','app_binding_v1.py','attest_start_v1.py','run_stage.sh','observer.py','observer_transport.py']:
  text=(ROOT/n).read_text();(HERE/'templates'/n).write_text(text)
  if (V4/n).exists():(HERE/(n+'.patch')).write_text(''.join(difflib.unified_diff((V4/n).read_text().splitlines(True),text.splitlines(True),fromfile=str(V4/n),tofile=n,n=0)))
 m['files']={n:sha(ROOT/n) for n in m['files']}
 (ROOT/'operation-files.sha256').write_text(''.join(h+'  '+str(ROOT/n)+'\n' for n,h in m['files'].items()))
 m['checksumListSHA256']=sha(ROOT/'operation-files.sha256');js(HERE/'manifest.json',m);js(ROOT/'preparation.json',m)
 recipe=(HERE/'parent_recipe.sh.in').read_text().replace('__SEAL_SHA__',m['checksumListSHA256']).replace('__RUNNER_SHA__',m['files']['run_stage.sh'])
 (HERE/'parent_recipe.sh').write_text(recipe);(HERE/'parent_recipe.sh').chmod(0o755)
 (ROOT/'parent_recipe.sh').write_text(recipe);(ROOT/'parent_recipe.sh').chmod(0o700)
 print(json.dumps({'sealedFiles':len(m['files']),'manifestSHA256':sha(HERE/'manifest.json'),'checksumListSHA256':m['checksumListSHA256']}))
if __name__=='__main__':main()
