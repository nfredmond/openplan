"""Targeted refusal controls for read-only guard recovery, restoring source bytes."""
import json
from verify_owner_guard_controls import run

suite='test_owner_guard_recovery.OwnerGuardRecoveryTests.'
records=[run('harmless','model_engine_recovery.py',None,None,'test_owner_guard_recovery')]
checks=[
 ('missing-required-record',"if 'owner_guard_unit' in launch:raise ValueError('Required owner guard record missing')",'pass','test_missing_required_guard_record_is_refused'),
 ('foreign-launch',"if {k:v for k,v in guard_record.items() if k!='guard'}!=launch:", 'if False:','test_foreign_guard_launch_is_refused'),
 ('foreign-owner',"if 'owner_guard_unit' in launch and (launch['owner_guard_unit']!=guard['unit'] or launch.get('supervisor_pid')!=guard['owner_pid']):",'if False:','test_foreign_guard_owner_is_refused'),
 ('foreign-boot',"if scope.get('boot_id')!=guard['boot_id']:raise ValueError('Owner guard boot differs from engine')",'pass','test_foreign_guard_boot_is_refused'),
]
for name,old,new,test in checks:
    records.append(run(name,'model_engine_recovery.py',old,new,suite+test,'ValueError not raised'))
records.append(run('invalid-shape','model_owner_guard_recovery.py','def validate_guard(identity):','def validate_guard(identity):\n    return',suite+'test_invalid_guard_identity_is_refused','ValueError not raised'))
records.append(run('directory-replacement','model_owner_guard_recovery.py',"if (info.st_dev,info.st_ino)!=(identity['cgroup_device'],identity['cgroup_inode']):",'if False:',suite+'test_guard_directory_replacement_is_refused','ValueError not raised'))
records.append(run('invocation-replacement','model_owner_guard_recovery.py',"if state.get('InvocationID')!=identity['invocation_id'] or state.get('ControlGroup')!=identity['cgroup']:",'if False:',suite+'test_replaced_guard_invocation_is_refused','ValueError not raised'))
records.append(run('false-empty-on-race','model_owner_guard_recovery.py',"{'outcome':'guard_observation_unconfirmed','guard_has_live_processes':None}","{'outcome':'guard_observation_unconfirmed','guard_has_live_processes':False}",suite+'test_guard_removal_race_remains_unconfirmed','False is not None'))
records.append(run('restored','model_engine_recovery.py',None,None,'test_owner_guard_recovery'))
print(json.dumps({'cases':records,'limits':['Live disposable scopes and private synthetic records','No database recovery decision or model restart','Read-only audits do not authorize termination or continuation']},indent=2))
