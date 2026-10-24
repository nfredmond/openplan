"""Record the owned scope peak while the scope still exists after engine exit."""
import json,resource,subprocess,sys,time
from pathlib import Path
health=Path(sys.argv[1]);command=sys.argv[2:];start=time.monotonic()
run=subprocess.run(command)
cgroup=next(line.split(':',2)[2] for line in Path('/proc/self/cgroup').read_text().splitlines() if line.startswith('0::'))
root=Path('/sys/fs/cgroup')/cgroup.lstrip('/')
record={'exit_code':run.returncode,'elapsed_seconds':time.monotonic()-start,'command':command,
        'peak_child_rss_kib':resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,
        'scope':{name:(root/name).read_text().strip() for name in ['memory.peak','memory.max','memory.swap.max','memory.events']}}
health.write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record),flush=True)
sys.exit(run.returncode)
