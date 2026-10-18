"""Held deadline entry for a later root-prepared pure wrapper. No dispatch code."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import time

HERE=Path(__file__).resolve().parent
PRIVATE=Path('/home/nathaniel/.local/state/openplan/a0-multiset-parent-correlation-correction-20261016')


def write_once(path,value):
    data=(json.dumps(value,sort_keys=True,indent=2)+'\n').encode()
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
    fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)


def run(scratch):
    # The future root wrapper must establish the actual finite resources first.
    scratch=Path(scratch)
    if scratch!=PRIVATE/'pure-controls':raise ValueError('fixed-inert-scratch')
    scratch.mkdir(mode=0o700)
    write_once(scratch/'control-entry.json',{'phase':'BEFORE_FIRST_CONTROL_IMPORT','pid':os.getpid(),'uid':os.getuid(),
        'monotonic':time.monotonic(),'nativeOperationGranted':False,'sourceClosureComplete':False,'fixtureLaunchable':False,
        'wrapperResources':'REQUIRES_SEPARATE_ACTUAL_ROOT_AUDIT_NOT_INFERRED'})
    saved=list(sys.path);old=sys.modules.get('a0_parent_focused_controls');present='a0_parent_focused_controls' in sys.modules
    related={name:sys.modules.get(name) for name in ['inert_adapter','inert_fixture']}
    related_present={name for name in related if name in sys.modules}
    try:
        sys.path.insert(0,str(HERE))
        spec=importlib.util.spec_from_file_location('a0_parent_focused_controls',HERE/'controls.py')
        module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module
        spec.loader.exec_module(module);module.main(scratch)
    finally:
        sys.path[:]=saved
        if present:sys.modules['a0_parent_focused_controls']=old
        else:sys.modules.pop('a0_parent_focused_controls',None)
        for name in related:
            if name in related_present:sys.modules[name]=related[name]
            else:sys.modules.pop(name,None)


if __name__=='__main__':raise SystemExit('HELD: no prepared pure wrapper or execution grant')
