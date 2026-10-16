"""Read-only parity through both installed npm helpers, without spawning a script."""
import hashlib
import json
from pathlib import Path
import subprocess
import types

PUBLIC=Path(__file__).resolve().parent
ROOT=Path('/home/nathaniel/.local/state/openplan/current-project-preview-host-attestation-v2-20261015')
m=types.ModuleType('npm_context');m.__file__=str(ROOT/'attest_start_v2.py')
exec(compile((PUBLIC/'attest_start_v2.py').read_text(),m.__file__,'exec'),vars(m))
expected=m.npm_child_path('/usr/bin:/bin')
js='''const base='/usr/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/'
const setPATH=require(base+'set-path.js')
const make=require(base+'make-spawn-args.js')
const path=process.argv[1]
const direct=setPATH(path,false,{PATH:'/usr/bin:/bin'}).PATH
const args=make({path,args:[],cmd:'owned-parity-no-execution',env:{PATH:'/usr/bin:/bin'},event:'start',stdio:'pipe'})
process.stdout.write(JSON.stringify({direct,spawn:args[2].env.PATH,cwd:args[2].cwd}))
'''
result=json.loads(subprocess.check_output(['/usr/bin/node','--max-old-space-size=128','-e',js,str(m.a.APP)],env={'PATH':'/usr/bin:/bin','HOME':str(ROOT/'home')},timeout=10))
assert result['direct']==result['spawn']==expected,'npm-spawn-helper-parity'
assert result['cwd']==str(m.a.APP)
run=Path('/usr/lib/node_modules/npm/lib/commands/run.js').read_text()
assert 'await runScript({' in run and 'binPaths' not in run,'npm-run-binpaths-context'
pkg=Path('/usr/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/run-script-pkg.js').read_text()
assert 'binPaths = false' in pkg and 'binPaths,' in pkg,'npm-pkg-binpaths-context'
# Harmless metadata survives; changed value fails the exact common oracle.
def parity(value):assert value['direct']==value['spawn']==expected,'npm-spawn-helper-parity'
parity({**result,'harmless':'comment'})
changed={**result,'spawn':'/usr/bin:/bin'}
try:parity(changed)
except AssertionError as error:assert str(error)=='npm-spawn-helper-parity'
else:raise AssertionError('parity-oracle-missed')
(ROOT/'npm-context.json').write_text(json.dumps({'directHelperEqualsPython':True,'makeSpawnArgsEqualsPython':True,'runSuppliesNoBinPaths':True,'pkgDefaultBinPaths':False,'derivedPathSha256':hashlib.sha256(expected.encode()).hexdigest(),'harmlessSurvives':True,'wrongPathRefuses':'npm-spawn-helper-parity','limits':['No npm command, shell script, script spawn or actual startup. Inspected pinned run.js call and run-script-pkg default establish this fixed context.']},indent=2)+'\n')
print(json.dumps({'directAndSpawnParity':True,'binPaths':False}))
