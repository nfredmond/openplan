"""Retain scope memory samples and model-stage log labels even after an OOM kill."""
import json
from pathlib import Path
import resource
import subprocess
import sys
import threading
import time

base = Path(sys.argv[1]); command = sys.argv[2:]
root = Path('/sys/fs/cgroup') / next(x.split(':', 2)[2] for x in Path('/proc/self/cgroup').read_text().splitlines() if x.startswith('0::')).lstrip('/')
start = time.monotonic(); stage = 'startup'; done = threading.Event(); process = None


def sample():
    with base.with_suffix('.memory.jsonl').open('x', buffering=1) as out:
        while not done.is_set():
            record = {'elapsed_seconds': time.monotonic()-start, 'stage': stage}
            for name in ['memory.current', 'memory.peak', 'memory.swap.current', 'memory.events', 'memory.stat']:
                record[name] = (root/name).read_text().strip()
            if process is not None:
                try:
                    fields = Path(f'/proc/{process.pid}/status').read_text().splitlines()
                    record['process_memory_kib'] = {line.split(':')[0]: int(line.split()[1]) for line in fields if line.startswith(('VmRSS:', 'VmHWM:', 'RssAnon:', 'RssFile:'))}
                except FileNotFoundError:
                    pass
            out.write(json.dumps(record)+'\n')
            done.wait(1)


thread = threading.Thread(target=sample); thread.start()
with base.with_suffix('.engine.log').open('x', buffering=1) as log:
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    for line in process.stdout:
        log.write(line)
        if ('Running ' in line and 'Running chunk' not in line and 'Running compute_logsums' not in line) or 'run_model' in line:
            stage = line.strip()
    code = process.wait()
done.set(); thread.join()
record = {'exit_code': code, 'elapsed_seconds': time.monotonic()-start,
          'peak_child_rss_kib': resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,
          'scope': {k: (root/k).read_text().strip() for k in ['memory.peak','memory.max','memory.swap.max','memory.events']}}
base.with_suffix('.health.json').write_text(json.dumps(record, indent=2)+'\n')
sys.exit(code)
