"""Retain exact common inner namespace failure under the parent outer recipe."""
import json
import os
from pathlib import Path
import subprocess
import types

PUBLIC=Path(__file__).resolve().parent.parent/'2026-10-15-current-project-preview-app-binding'
ROOT=Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-independent-20261015')

def main():
    os.umask(0o077)
    source=(PUBLIC/'templates/app_binding_v1.py').read_bytes();rows=[]
    spec=ROOT/'nested-constructor-01';spec.mkdir(mode=0o700)
    for phase in ['build','start']:
        for label,code in [('harmless comment first',source+b'\n# No behavior change.\n'),('restored source',source)]:
            m=types.ModuleType('nested_specimen');m.__file__=str(spec/'binding.py')
            exec(compile(code,m.__file__,'exec'),vars(m))
            m.CANDIDATE=spec/'candidate';m.APP=m.CANDIDATE/'openplan';m.RUN=spec/'execution';m.DEPS=spec/'donor'
            for path in [m.APP,m.RUN,m.DEPS,m.RUN/'tmp']:path.mkdir(mode=0o700,parents=True,exist_ok=True)
            (m.APP/'.env.local').write_text('specimen')
            args=m.confined_argv(phase);cut=args.index('/usr/bin/npm')
            # No npm, network call, listener or original donor access can occur.
            args=args[:cut]+['/usr/bin/python3','-B','-c','print("child reached")']
            result=subprocess.run(args,env=m.environment({},phase),capture_output=True,timeout=10)
            error=result.stderr.decode()
            assert result.returncode!=0 and 'No permissions to create a new namespace' in error
            rows.append({'phase':phase,'case':label,'exit':result.returncode,'stderr':error,'childReached':bool(result.stdout)})
    with (ROOT/'nested-constructor-01.json').open('x') as f:json.dump(rows,f,indent=2);f.write('\n')
    print(json.dumps({'observations':len(rows),'finding':'both inner constructors refuse under outer wrapper'}))

if __name__=='__main__':main()
