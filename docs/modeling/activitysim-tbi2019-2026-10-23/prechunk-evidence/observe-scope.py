"""Observe cgroup counters outside the model scope so an OOM need not kill telemetry."""
import json
from pathlib import Path
import subprocess
import sys
import time

unit, filename = sys.argv[1:]
group = subprocess.check_output(['systemctl','--user','show',unit,'-p','ControlGroup','--value'],text=True).strip()
root = Path('/sys/fs/cgroup')/group.lstrip('/')
start = time.monotonic()
last = None
with Path(filename).open('x',buffering=1) as stream:
    stream.write(json.dumps({'event':'attached','unit':unit,'control_group':group,
        'limits':'Observer starts during this run and sits outside its scope. Counters are kernel lifetime peaks; samples do not guarantee catching the final event before cgroup removal.'})+'\n')
    while root.exists():
        try:
            values = {name:(root/name).read_text().strip() for name in ['memory.peak','memory.events','memory.swap.peak']}
        except FileNotFoundError:
            break
        if values != last:
            stream.write(json.dumps({'elapsed_since_attachment':time.monotonic()-start,**values})+'\n')
            last = values
        time.sleep(0.1)
    stream.write(json.dumps({'event':'cgroup_removed','elapsed_since_attachment':time.monotonic()-start,'last_counters':last})+'\n')
