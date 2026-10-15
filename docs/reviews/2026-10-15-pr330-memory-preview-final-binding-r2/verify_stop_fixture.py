"""One failed fake user unit tests durable streams/ExecStopPost. No app/helper."""
import hashlib
import json
import os
from pathlib import Path
import types
import uuid

HERE=Path(__file__).resolve().parent
PRIVATE=Path('/home/nathaniel/.local/state/openplan/pr330-memory-preview-20261015-r2')


def main():
    os.umask(0o077)
    root=PRIVATE/'fixtures'/('stop-'+uuid.uuid4().hex);root.mkdir(mode=0o700)
    source=(HERE/'journal.py').read_text()
    m=types.ModuleType('journal_fixture');exec(compile(source,'journal-fixture','exec'),m.__dict__);m.DURABLE=root
    copy=source.replace("Path('/home/nathaniel/.local/state/openplan/pr330-memory-preview-20261015-r2')",'Path('+repr(str(root))+')')
    controller=root/'journal-copy.py';controller.write_text(copy)
    unit='openplan-pr330-r2-fake-stop-'+uuid.uuid4().hex[:12]
    out=root/'journal/unit-start/web-stdout.bin';err=root/'journal/unit-start/web-stderr.bin'
    argv=['/usr/bin/systemd-run','--user','--wait','--collect','--unit='+unit,
        '-p','MemoryMax=512M','-p','MemorySwapMax=0','-p','CPUQuota=50%','-p','UMask=0077','-p','RuntimeMaxSec=15',
        '-p','StandardOutput=append:'+str(out),'-p','StandardError=append:'+str(err),
        '-p','ExecStopPost=/usr/bin/python3 -B '+str(controller)+' stopped-web',
        '/bin/sh','-c','echo fake-start; echo fake-error >&2; exit 9']
    env={'PATH':'/usr/bin:/bin','HOME':str(root),'XDG_RUNTIME_DIR':'/run/user/1000',
         'DBUS_SESSION_BUS_ADDRESS':'unix:path=/run/user/1000/bus','PYTHONDONTWRITEBYTECODE':'1'}
    result=m.execute('unit-start',argv,env=env,timeout=30)
    assert result.returncode!=0
    stopped=json.loads((root/'journal/unit-start/web-exit.json').read_text())
    assert stopped['exitCode']=='exited' and stopped['exitStatus']=='9'
    assert out.read_bytes()==b'fake-start\n' and err.read_bytes()==b'fake-error\n'
    assert (root/'journal/unit-start/intent.json').is_file()
    assert all(stopped['streams'][p.name]==hashlib.sha256(p.read_bytes()).hexdigest() for p in [out,err])
    assert not Path('/dev/shm/openplan-pr330-preview-20261015').exists()
    record={'preparedOnly':True,'fakeUnit':unit,'actualApplication':False,'actualHelper':False,
        'managerReturncode':result.returncode,'stopCode':stopped['exitCode'],'stopStatus':stopped['exitStatus'],
        'durableIntentBeforeRequest':True,'exactPrivateStreamsAndStopHashes':True,
        'sourceUnchanged':(HERE/'journal.py').read_text()==source,
        'boundary':'One failed fake unit only. Not web startup, readiness, tmpfs/native application or recovery acceptance.'}
    (PRIVATE/'records/fake-stop-control.json').write_text(json.dumps(record,indent=2)+'\n')
    (HERE/'fake-stop-control.json').write_text(json.dumps(record,indent=2)+'\n')
    print(json.dumps({'fakeStopStatus':stopped['exitStatus'],'durableStreams':True}))


if __name__=='__main__':main()
