"""Live retained guard inspection and refusal, without signal or restart authority."""
import json,os,unittest,uuid,subprocess
from unittest.mock import patch
import model_owner_guard_recovery as guard_recovery
import test_engine_scope_recovery as fixtures

@unittest.skipUnless(os.environ.get('OPENPLAN_LIVE_ENGINE_SCOPE')=='1','Requires explicit owned Linux user-scope opt-in')
class OwnerGuardRecoveryTests(unittest.TestCase):
    setUp=fixtures.ScopeRecoveryTests.setUp
    response=fixtures.ScopeRecoveryTests.response
    prepared=fixtures.ScopeRecoveryTests.prepared
    start=fixtures.ScopeRecoveryTests.start
    alive=fixtures.ScopeRecoveryTests.alive
    observed=fixtures.ScopeRecoveryTests.observed
    inspect=fixtures.ScopeRecoveryTests.inspect
    fresh=fixtures.ScopeRecoveryTests.fresh

    def change(self,field,value):
        handle=self.alive();p=handle.directory/'owner-guard-started.json';record=json.loads(p.read_text())
        record['guard'][field]=value(record['guard'][field]);p.write_text(json.dumps(record))
        return handle

    def test_missing_required_guard_record_is_refused(self):
        handle=self.alive();(handle.directory/'owner-guard-started.json').rename(handle.directory/'withheld-guard.json')
        with self.assertRaisesRegex(ValueError,'Required owner guard record missing'):self.inspect()

    def test_foreign_guard_launch_is_refused(self):
        handle=self.alive();p=handle.directory/'owner-guard-started.json';record=json.loads(p.read_text())
        record['attempt_id']=str(uuid.uuid4());p.write_text(json.dumps(record))
        with self.assertRaisesRegex(ValueError,'Owner guard record differs from launch'):self.inspect()

    def test_foreign_guard_owner_is_refused(self):
        self.change('owner_pid',lambda v:v+1)
        with self.assertRaisesRegex(ValueError,'Owner guard identity differs from launch'):self.inspect()

    def test_foreign_guard_boot_is_refused(self):
        self.change('boot_id',lambda v:str(uuid.uuid4()))
        with self.assertRaisesRegex(ValueError,'Owner guard boot differs from engine'):self.inspect()

    def test_guard_directory_replacement_is_refused(self):
        self.change('cgroup_inode',lambda v:v+1)
        with self.assertRaisesRegex(ValueError,'owner guard directory identity differs'):self.inspect()

    def test_hardlinked_guard_record_is_refused(self):
        handle=self.alive();os.link(handle.directory/'owner-guard-started.json',handle.directory/'guard-alias.json')
        with self.assertRaisesRegex(ValueError,'private bounded regular'):self.inspect()

    def test_stopped_guard_does_not_authorize_recovery(self):
        handle=self.alive();handle.cancel();self.observed(handle)
        result=self.fresh()
        self.assertFalse(result['owner_guard']['guard_has_live_processes'])
        self.assertFalse(result['scope_has_live_processes'])
        self.assertEqual(result['termination_cause'],'unconfirmed')
        self.assertFalse(result['continuation_authorized'])
        self.assertFalse(result['database_status_changed'])

    def test_legacy_missing_guard_remains_unassessed(self):
        handle=self.alive()
        for name in ('launch-reserved.json','scope-started.json'):
            p=handle.directory/name;record=json.loads(p.read_text())
            del record['owner_guard_unit'];del record['supervisor_pid'];p.write_text(json.dumps(record))
        (handle.directory/'owner-guard-started.json').rename(handle.directory/'old-guard.json')
        result=self.fresh()
        self.assertEqual(result['owner_guard'],{'outcome':'guard_record_absent','guard_has_live_processes':None})
        self.assertFalse(result['continuation_authorized'])

    def test_invalid_guard_identity_is_refused(self):
        handle=self.alive();p=handle.directory/'owner-guard-started.json';original=json.loads(p.read_text())
        for field,value in (('pid',-1),('cgroup_device',False),('schema','unknown'),('unit','other.scope'),('invocation_id','invalid'),('cgroup','/other'),('boot_id','invalid')):
            with self.subTest(field=field):
                record=json.loads(json.dumps(original));record['guard'][field]=value;p.write_text(json.dumps(record))
                with self.assertRaises(ValueError):self.inspect()
        p.write_text(json.dumps(original))

    def test_replaced_guard_invocation_is_refused(self):
        handle=self.alive();identity=handle.owner_guard.identity
        wrong=subprocess.CompletedProcess([],0,'LoadState=loaded\nActiveState=active\nInvocationID='+'0'*32+'\nControlGroup='+identity['cgroup']+'\n','')
        with patch.object(guard_recovery.subprocess,'run',return_value=wrong):
            with self.assertRaisesRegex(ValueError,'owner guard differs from current scope'):
                guard_recovery.inspect_guard(identity)

    def test_guard_removal_race_remains_unconfirmed(self):
        handle=self.alive();identity=handle.owner_guard.identity;original=os.open
        def removed(path,*args,**kwargs):
            if str(path)=='/sys/fs/cgroup'+identity['cgroup']:raise FileNotFoundError('Guard disappeared')
            return original(path,*args,**kwargs)
        with patch.object(guard_recovery.os,'open',side_effect=removed):
            result=guard_recovery.inspect_guard(identity)
        self.assertIsNone(result['guard_has_live_processes'])
        self.assertEqual(result['outcome'],'guard_observation_unconfirmed')

if __name__=='__main__':unittest.main()
