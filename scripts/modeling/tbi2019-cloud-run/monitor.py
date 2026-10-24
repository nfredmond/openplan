"""Retain process RSS, aggregate cgroup counters and engine step labels."""
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import threading
import time

CGROUP = Path('/sys/fs/cgroup')


def counters():
    result = {}
    for name in ['memory.current', 'memory.peak', 'memory.max', 'memory.swap.current', 'memory.events']:
        try: result[name] = (CGROUP/name).read_text().strip()
        except OSError: result[name] = None
    return result


def run_stage(command, env, folder, state):
    folder.mkdir()
    start = time.monotonic(); done = threading.Event(); stages = {}; labels = {}
    proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, bufsize=1, env=env, start_new_session=True)
    state['active_pid'] = proc.pid
    failure = []

    def sample():
        try:
            with (folder/'memory.jsonl').open('x', buffering=1) as out:
                while not done.is_set():
                    row = {'elapsed_seconds':time.monotonic()-start, **counters(), 'processes':{}}
                    for path in Path('/proc').glob('[0-9]*/status'):
                        try:
                            lines = path.read_text().splitlines()
                            values = {x.split(':')[0]:int(x.split()[1])*1024 for x in lines
                                      if x.startswith(('VmRSS:', 'VmHWM:', 'RssAnon:', 'RssFile:'))}
                            pid = path.parent.name
                            row['processes'][pid] = {'name':labels.get(pid,'unlabelled'),
                                                    'step':stages.get(pid,'startup'), **values}
                        except (OSError, ValueError): pass
                    out.write(json.dumps(row)+'\n')
                    state['memory'] = {k:v for k,v in row.items() if k.startswith('memory.')}
                    # Preserve controller headroom when observable. This cannot survive SIGKILL.
                    limit = row['memory.max']
                    if limit and limit != 'max' and int(row['memory.current']) > int(limit)*0.96:
                        failure.append('memory headroom guard: exceeded 96 percent of container limit')
                        os.killpg(proc.pid, signal.SIGTERM)
                        return
                    done.wait(1)
        except Exception:
            failure.append('memory telemetry failed')
            try: os.killpg(proc.pid, signal.SIGTERM)
            except ProcessLookupError: pass

    thread = threading.Thread(target=sample); thread.start()
    try:
        with (folder/'engine.log').open('x',buffering=1) as log:
            for line in proc.stdout:
                log.write(line)
                match = re.match(r'\[[^]]+\] (\d+) (\S+) \w+: (.*)',line)
                if match:
                    pid, name, message = match.groups(); labels[pid] = name
                    if (message.startswith(('#run_model running ', 'Running ', 'Coalesc', 'coalesc', 'Apportion'))
                            and not message.startswith(('Running chunk', 'Running compute_logsums'))):
                        stages[pid] = message; state['engine_step'] = message
            code = proc.wait()
    finally:
        if proc.poll() is None:
            os.killpg(proc.pid, signal.SIGTERM)
            try: proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL); proc.wait()
        done.set(); thread.join(); state.pop('active_pid',None)
    result = {'exit_code':code,'elapsed_seconds':time.monotonic()-start,
              'last_step':state.get('engine_step'),'cgroup':counters(),'monitor_errors':failure}
    (folder/'health.json').write_text(json.dumps(result,indent=2)+'\n')
    if code or failure:
        raise RuntimeError(f'engine stage failed: exit {code}; '+('; '.join(failure)))
    return result
