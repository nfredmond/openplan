"""Sample the complete scope and each PID without changing engine functions."""
import json
from pathlib import Path
import re
import subprocess
import sys
import threading
import time


def main():
    base=Path(sys.argv[1]); command=sys.argv[2:]
    group=next(x.split(':',2)[2] for x in Path('/proc/self/cgroup').read_text().splitlines() if x.startswith('0::'))
    root=Path('/sys/fs/cgroup')/group.lstrip('/')
    start=time.monotonic(); done=threading.Event(); stages={}; labels={}

    def sample():
        with base.with_suffix('.memory.jsonl').open('x',buffering=1) as out:
            while not done.is_set():
                row={'elapsed_seconds':time.monotonic()-start,'processes':{}}
                for name in ['memory.current','memory.peak','memory.swap.current','memory.events']:
                    row[name]=(root/name).read_text().strip()
                for pid in (root/'cgroup.procs').read_text().split():
                    try:
                        lines=Path(f'/proc/{pid}/status').read_text().splitlines()
                        values={x.split(':')[0]:int(x.split()[1]) for x in lines if x.startswith(('VmRSS:','VmHWM:','RssAnon:','RssFile:'))}
                        row['processes'][pid]={'name':labels.get(pid,'unlabelled'), 'stage':stages.get(pid,'startup'),**values}
                    except (FileNotFoundError,ProcessLookupError):
                        continue
                out.write(json.dumps(row)+'\n')
                done.wait(1)

    thread=threading.Thread(target=sample); thread.start()
    with base.with_suffix('.engine.log').open('x',buffering=1) as log:
        proc=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
        for line in proc.stdout:
            log.write(line)
            match=re.match(r'\[[^]]+\] (\d+) (\S+) \w+: (.*)',line)
            if match:
                pid,name,message=match.groups(); labels[pid]=name
                if message.startswith('#run_model running '):
                    stages[pid]=message
                if message.startswith('Running ') and not message.startswith(('Running chunk','Running compute_logsums')):
                    stages[pid]=message
        code=proc.wait()
    done.set(); thread.join()
    base.with_suffix('.health.json').write_text(json.dumps({'exit_code':code,'elapsed_seconds':time.monotonic()-start,
        'scope':{k:(root/k).read_text().strip() for k in ['memory.peak','memory.max','memory.swap.max','memory.events']}},indent=2)+'\n')
    sys.exit(code)


if __name__=='__main__':
    main()
