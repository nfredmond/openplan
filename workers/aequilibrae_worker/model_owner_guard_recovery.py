"""Read-only observation of retained owner-guard identity; never signal or launch."""
import os
from pathlib import Path
import re
import subprocess
import uuid
from model_engine_supervision import current_boot_id,SupervisionUnavailable


def validate_guard(identity):
    if not isinstance(identity,dict) or identity.get('schema')!='openplan.owner-guard.v1':
        raise ValueError('Invalid retained owner guard')
    unit=identity.get('unit','');group=identity.get('cgroup','')
    if not isinstance(unit,str) or not re.fullmatch(r'openplan-owner-[0-9a-f]{32}\.scope',unit):
        raise ValueError('Invalid retained owner guard unit')
    invocation=identity.get('invocation_id','')
    if not isinstance(invocation,str) or not re.fullmatch(r'[0-9a-f]{32}',invocation):
        raise ValueError('Invalid retained owner guard invocation')
    for field in ('pid','owner_pid','cgroup_device','cgroup_inode'):
        if type(identity.get(field)) is not int or identity[field]<=0:
            raise ValueError('Invalid retained owner guard numeric identity')
    prefix=f'/user.slice/user-{os.getuid()}.slice/user@{os.getuid()}.service/'
    if not isinstance(group,str) or not group.startswith(prefix) or '..' in Path(group).parts or not group.endswith('/'+unit):
        raise ValueError('Invalid retained owner guard cgroup')
    boot=identity.get('boot_id')
    if not isinstance(boot,str) or str(uuid.UUID(boot))!=boot:
        raise ValueError('Invalid retained owner guard boot')


def inspect_guard(identity):
    validate_guard(identity)
    if identity['boot_id']!=current_boot_id():
        return {'outcome':'different_host_boot','guard_has_live_processes':None}
    result=subprocess.run(['systemctl','--user','show',identity['unit'],'-p','LoadState','-p','ActiveState','-p','InvocationID','-p','ControlGroup'],
        capture_output=True,text=True,timeout=5)
    if result.returncode:raise SupervisionUnavailable('Retained owner guard could not be queried')
    state=dict(line.split('=',1) for line in result.stdout.splitlines() if '=' in line)
    directory=Path('/sys/fs/cgroup')/identity['cgroup'].lstrip('/')
    if state.get('LoadState')=='not-found' and state.get('ActiveState')=='inactive' and not directory.exists():
        return {'outcome':'guard_absent_observed','guard_has_live_processes':False}
    if state.get('InvocationID')!=identity['invocation_id'] or state.get('ControlGroup')!=identity['cgroup']:
        raise ValueError('Retained owner guard differs from current scope')
    try:descriptor=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    except FileNotFoundError:return {'outcome':'guard_observation_unconfirmed','guard_has_live_processes':None}
    try:
        info=os.fstat(descriptor)
        if (info.st_dev,info.st_ino)!=(identity['cgroup_device'],identity['cgroup_inode']):
            raise ValueError('Retained owner guard directory identity differs')
        event=os.open('cgroup.events',os.O_RDONLY|os.O_NOFOLLOW,dir_fd=descriptor)
        with os.fdopen(event) as stream:events=dict(line.split() for line in stream)
    finally:os.close(descriptor)
    if events.get('populated') not in ('0','1'):raise ValueError('Retained owner guard population is unconfirmed')
    populated=events['populated']=='1'
    return {'outcome':'guard_populated' if populated else 'guard_empty_observed','guard_has_live_processes':populated}
