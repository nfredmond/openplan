"""Run the pinned engine with allocator reclamation before location logsums."""
import ctypes,gc,hashlib,importlib.metadata,json,runpy,sys
from pathlib import Path
import psutil
root=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(root/'scripts/modeling'))
from activitysim_allocator_reclaim import reclaim_before
from activitysim.abm.models import location_choice
expected='39a8624e73cad1a3b38acfc769fbbb330aa792b115ec16b047c04631fd9e82c5'
if importlib.metadata.version('activitysim')!='1.5.1' or hashlib.sha256(Path(location_choice.__file__).read_bytes()).hexdigest()!=expected:
    raise RuntimeError('Unadmitted ActivitySim location-choice implementation')
libc=ctypes.CDLL(None)
trim=libc.malloc_trim
trim.argtypes=[ctypes.c_size_t]
trim.restype=ctypes.c_int
process=psutil.Process()
def reclaim():
    before=process.memory_info().rss
    collected=gc.collect()
    released=trim(0)
    print(json.dumps({'allocator_reclamation':True,'rss_before':before,'rss_after':process.memory_info().rss,'gc_objects':collected,'malloc_trim_result':released}),flush=True)
location_choice.run_location_logsums=reclaim_before(location_choice.run_location_logsums,reclaim)
sys.argv[0]='activitysim'
runpy.run_module('activitysim',run_name='__main__')
