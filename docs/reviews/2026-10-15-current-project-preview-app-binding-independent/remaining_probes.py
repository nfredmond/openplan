"""Run bounded review probes serially, retaining each private output."""
import json
import os
from pathlib import Path
import subprocess

HERE=Path(__file__).resolve().parent
ROOT=Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-independent-20261015')

def main():
    os.umask(0o077)
    commands=[('input-audit-01',['audit.py']),('small-01',['replay.py','small']),
              ('boundary-01',['replay.py','boundary']),('boundary-independent-01',['boundary_probe.py']),
              ('health-01',['health_probe.py']),('inventory-assay-01',['preservation.py','assay'])]
    for name,parts in commands:
        with (ROOT/(name+'.log')).open('xb') as log:
            result=subprocess.run(['/usr/bin/python3','-B',str(HERE/parts[0]),*parts[1:]],stdout=log,stderr=subprocess.STDOUT,timeout=120)
        assert result.returncode==0,name+':probe-failed'
        print(json.dumps({'probe':name,'exit':result.returncode}),flush=True)

if __name__=='__main__':main()
