"""Verify the declared native FIFO tool with disposable knip configurations."""
import hashlib,json,os,subprocess,uuid
from pathlib import Path
root=Path(__file__).resolve().parents[3]
app=root/'openplan'
source=app/'knip.json'
original=source.read_text()
config=json.loads(original)
assert 'mkfifo' in config['ignoreBinaries']
broken={**config,'ignoreBinaries':[x for x in config['ignoreBinaries'] if x!='mkfifo']}
target=app/('.knip-control-'+uuid.uuid4().hex+'.json')
results=[]
try:
 for name,code,expected in [('harmless',json.dumps(config,indent=4)+'\n',True),('missing-system-tool',json.dumps(broken),False),('restored',original,True)]:
  target.write_text(code)
  r=subprocess.run([str(app/'node_modules/.bin/knip'),'--no-progress','--config',str(target)],cwd=app,env={**os.environ,'NODE_OPTIONS':'--max-old-space-size=4096'},capture_output=True,text=True,timeout=120)
  output=r.stdout+r.stderr
  assert (r.returncode==0)==expected,(name,output[:2500])
  if not expected: assert 'Unlisted binaries (1)' in output and 'mkfifo' in output
  results.append({'case':name,'expectedPass':expected,'exitCode':r.returncode})
finally:
 target.unlink(missing_ok=True)
 assert source.read_text()==original
print(json.dumps({'sourceSha256':hashlib.sha256(original.encode()).hexdigest(),'cases':results,'trackedConfigUnchanged':True},indent=2))
