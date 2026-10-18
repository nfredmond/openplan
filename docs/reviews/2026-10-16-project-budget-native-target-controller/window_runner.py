"""ONE pure window, unexecuted without root's separately published grant."""
from copy import deepcopy
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import traceback

ROOT=Path('/home/nathaniel/.local/state/openplan/project-budget-native-target-controller-20261016')
REPO=Path('/home/nathaniel/.t3/worktrees/openplan/t3-fab3cf74')


def observe():
    relative=Path('/proc/self/cgroup').read_text().strip().split('::',1)[1].lstrip('/')
    group=Path('/sys/fs/cgroup')/relative
    return {'limits':{name:(group/name).read_text().strip() for name in
        ('memory.max','memory.swap.max','cpu.max','pids.max','memory.peak','memory.events')},
        'mounts':{line.split()[4]:line.split()[5].split(',') for line in
                  Path('/proc/self/mountinfo').read_text().splitlines() if line.split()[4] in ('/',str(ROOT))},
        'network':str(Path('/proc/self/ns/net').readlink())}


def gate(value,host):
    for key,expected in {'memory.max':'536870912','memory.swap.max':'0',
                         'cpu.max':'50000 100000','pids.max':'64'}.items():
        if value['limits'].get(key)!=expected:
            raise AssertionError('resource-'+key)
    if 'ro' not in value['mounts'].get('/',[]):
        raise AssertionError('resource-root-ro')
    if 'rw' not in value['mounts'].get(str(ROOT),[]):
        raise AssertionError('resource-private-rw')
    if not host.startswith('net:[') or value['network']==host:
        raise AssertionError('resource-unshared-net')


def main():
    os.umask(0o077)
    started=time.monotonic()
    try:
        before=observe()
        (ROOT/'resources-before.json').write_text(json.dumps(before,indent=2)+'\n')
        host=(ROOT/'host-netns.txt').read_text().strip()
        gate(before,host)
        harmless=deepcopy(before); harmless['comment']='harmless supplied observation'
        gate(harmless,host)
        trials=[{'name':'harmless-resource-comment','outcome':'SURVIVED'}]
        for key in ('memory.max','memory.swap.max','cpu.max','pids.max','root-ro','private-rw','unshared-net'):
            changed=deepcopy(before)
            if key in changed['limits']: changed['limits'][key]='wrong'
            elif key=='unshared-net': changed['network']=host
            else: changed['mounts'].pop('/' if key=='root-ro' else str(ROOT))
            try:
                gate(changed,host)
            except AssertionError as error:
                if str(error)!='resource-'+key: raise
                trials.append({'name':key,'outcome':'KILLED','assertion':str(error)})
            else:
                raise AssertionError('resource-control-survived:'+key)
        (ROOT/'resource-controls.json').write_text(json.dumps(trials,indent=2)+'\n')
        sys.path.insert(0,str(ROOT))
        import controls
        controls.main()
        # Separate actual nested direction, not run through the inert process.
        result=subprocess.run(['/usr/bin/npm','run','product:direction:check'],cwd=REPO/'openplan',
            env={'PATH':'/usr/bin:/bin','HOME':str(ROOT/'home'),'TMPDIR':str(ROOT/'tmp'),
                 'XDG_CACHE_HOME':str(ROOT/'cache'),'npm_config_cache':str(ROOT/'npm-cache'),
                 'npm_config_update_notifier':'false','npm_config_audit':'false','npm_config_fund':'false'},
            stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=60)
        (ROOT/'direction.stdout').write_bytes(result.stdout)
        (ROOT/'direction.stderr').write_bytes(result.stderr)
        (ROOT/'direction.json').write_text(json.dumps({'argv':['/usr/bin/npm','run','product:direction:check'],
            'cwd':str(REPO/'openplan'),'returncode':result.returncode})+'\n')
        if result.returncode:
            raise AssertionError('nested-direction-nonzero')
    except BaseException:
        (ROOT/'unexpected-failure.txt').write_text(traceback.format_exc())
        raise
    finally:
        after=observe(); after['elapsedSeconds']=time.monotonic()-started
        (ROOT/'resources-after.json').write_text(json.dumps(after,indent=2)+'\n')


if __name__=='__main__':
    main()
