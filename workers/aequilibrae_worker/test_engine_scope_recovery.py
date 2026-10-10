"""Fresh read-only scope inspection with disposable Linux processes and real records."""
import hashlib,json,os,subprocess,sys,time,uuid
from pathlib import Path
import unittest
from unittest.mock import patch
import model_engine_process as engine
import model_engine_recovery as recovery
import test_engine_scope_cancellation as cancellation

AUDIT='''
import os,runpy,sys
from pathlib import Path
def audit(event,args):
 if event in ('os.kill','os.killpg','socket.connect'):raise RuntimeError('Recovery attempted a side effect')
 if event=='subprocess.Popen' and Path(args[0]).name!='systemctl':raise RuntimeError('Recovery attempted model launch')
 if event=='subprocess.Popen' and args[1][1:3]!=['--user','show']:raise RuntimeError('Recovery attempted manager mutation')
sys.addaudithook(audit)
sys.argv=['model_engine_recovery',*sys.argv[1:]]
runpy.run_module('model_engine_recovery',run_name='__main__')
'''

@unittest.skipUnless(os.environ.get('OPENPLAN_LIVE_ENGINE_SCOPE')=='1','Requires explicit owned Linux user-scope opt-in')
class ScopeRecoveryTests(unittest.TestCase):
    setUp=cancellation.ScopeCancellationTests.setUp
    response=cancellation.ScopeCancellationTests.response
    prepared=cancellation.ScopeCancellationTests.prepared
    start=cancellation.ScopeCancellationTests.start
    alive=cancellation.ScopeCancellationTests.alive
    observed=cancellation.ScopeCancellationTests.observed

    def inspect(self,**extra):
        kwargs=dict(base_url=self.writer.base_url,deployment_id=self.writer.deployment_id,request_id=self.writer.context.claim_request_id);kwargs.update(extra)
        return recovery.inspect_engine(self.writer.files.root,self.directory,**kwargs)

    def fresh(self):
        result=subprocess.run([sys.executable,'-B','-c',AUDIT,'--root',str(self.writer.files.root),'--journal',str(self.directory),
            '--base-url',self.writer.base_url,'--deployment-id',self.writer.deployment_id,'--request-id',self.writer.context.claim_request_id],
            env=dict(os.environ,PYTHONPATH=os.pathsep.join(filter(None,(os.environ.get('PYTHONPATH'),str(Path(__file__).parent))))),capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr+result.stdout)
        return json.loads(result.stdout)

    def test_fresh_process_observes_live_scope_without_signaling(self):
        handle=self.alive();result=self.fresh()
        self.assertEqual(result['outcome'],'scope_populated');self.assertTrue(result['scope_has_live_processes'])
        self.assertFalse(result['signal_sent']);self.assertFalse(result['model_resumed']);self.assertFalse(result['continuation_authorized'])
        self.assertIsNone(handle.process.poll())
        self.assertTrue(result['owner_guard']['guard_has_live_processes'])
        self.assertIn('owner-guard-started.json',result['record_sha256'])

    def test_lost_cancel_receipt_is_inspected_without_resend(self):
        handle=self.alive();record=engine._record
        def fail(descriptor,name,payload):
            if name=='cancellation-signal-written.json':raise OSError('Synthetic missing cancellation receipt')
            return record(descriptor,name,payload)
        with patch.object(engine,'_record',side_effect=fail):
            with self.assertRaisesRegex(OSError,'missing cancellation receipt'):handle.cancel()
        handle.process.wait(timeout=5)
        deadline=time.monotonic()+5
        while handle.scope.state()['ActiveState']!='inactive':
            if time.monotonic()>deadline:raise RuntimeError('Scope not inactive')
            time.sleep(.02)
        before={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in handle.directory.glob('*.json')}
        result=self.fresh();again=self.fresh()
        self.assertEqual(result,again);self.assertEqual(result['outcome'],'scope_absent_observed')
        self.assertTrue(result['cancellation_requested']);self.assertFalse(result['cancellation_signal_written'])
        self.assertFalse(result['cancellation_observed']);self.assertFalse(result['scope_has_live_processes'])
        self.assertFalse(result['signal_sent']);self.assertFalse(result['model_resumed']);self.assertFalse(result['database_status_changed'])
        self.assertEqual(result['termination_cause'],'unconfirmed')
        self.assertEqual(before,{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in handle.directory.glob('*.json')})

    def test_other_boot_is_unassessed_without_manager_query(self):
        handle=self.alive();boot=str(uuid.uuid4())
        for name,key in (('scope-started.json','scope'),('owner-guard-started.json','guard')):
            p=handle.directory/name;record=json.loads(p.read_text());record[key]['boot_id']=boot;p.write_text(json.dumps(record))
        with patch('model_engine_supervision.subprocess.run',side_effect=AssertionError('Foreign boot queried manager')):
            result=self.inspect()
        self.assertEqual(result['outcome'],'different_host_boot');self.assertIsNone(result['scope_has_live_processes'])

    def test_foreign_deployment_is_refused(self):
        self.alive()
        with self.assertRaisesRegex(ValueError,'Retained claim receipt'):self.inspect(deployment_id='foreign')

    def test_hardlinked_scope_record_is_refused(self):
        handle=self.alive();os.link(handle.directory/'scope-started.json',handle.directory/'alias.json')
        with self.assertRaisesRegex(ValueError,'private bounded regular'):self.inspect()

    def test_symlinked_scope_record_is_refused(self):
        handle=self.alive();p=handle.directory/'scope-started.json';p.rename(handle.directory/'original.json');p.symlink_to('original.json')
        with self.assertRaises(OSError):self.inspect()

    def test_missing_startup_record_does_not_infer_execution(self):
        handle=self.alive();(handle.directory/'scope-started.json').rename(handle.directory/'withheld.json')
        with patch('model_engine_supervision.subprocess.run',side_effect=AssertionError('Unconfirmed startup queried manager')):
            result=self.inspect()
        self.assertEqual(result['outcome'],'scope_startup_unconfirmed');self.assertFalse(result['continuation_authorized'])

    def test_foreign_claim_record_is_refused(self):
        handle=self.alive();foreign=str(uuid.uuid4())
        for name in ('launch-reserved.json','scope-started.json'):
            p=handle.directory/name;r=json.loads(p.read_text());r['stage_id']=foreign;p.write_text(json.dumps(r))
        with self.assertRaisesRegex(ValueError,'Engine launch differs from claim'):self.inspect()

    def test_false_signal_receipt_is_refused(self):
        handle=self.alive();handle.cancel();self.observed(handle)
        p=handle.directory/'cancellation-signal-written.json';r=json.loads(p.read_text());r['signal_written']=False;p.write_text(json.dumps(r))
        with self.assertRaisesRegex(ValueError,'Invalid cancellation signal receipt'):self.inspect()

    def test_false_empty_scope_observation_is_refused(self):
        handle=self.alive();handle.cancel();self.observed(handle)
        p=handle.directory/'cancellation-observed.json';r=json.loads(p.read_text());r['scope']['observed_scope_empty']=False;p.write_text(json.dumps(r))
        with self.assertRaisesRegex(ValueError,'Invalid empty scope observation'):self.inspect()

    def test_nonobject_startup_scope_is_refused(self):
        handle=self.alive();p=handle.directory/'scope-started.json';r=json.loads(p.read_text());r['scope']=[];p.write_text(json.dumps(r))
        with self.assertRaisesRegex(ValueError,'Invalid startup scope record'):self.inspect()

    def test_nonobject_cancellation_scope_is_refused(self):
        handle=self.alive();handle.cancel();self.observed(handle)
        p=handle.directory/'cancellation-requested.json';r=json.loads(p.read_text());r['scope']=[];p.write_text(json.dumps(r))
        with self.assertRaisesRegex(ValueError,'Invalid cancellation scope record'):self.inspect()

    def test_saved_directory_identity_change_is_refused(self):
        handle=self.alive();p=handle.directory/'scope-started.json';r=json.loads(p.read_text());r['scope']['cgroup_inode']+=1;p.write_text(json.dumps(r))
        with self.assertRaisesRegex(ValueError,'directory identity differs'):self.inspect()

    def test_current_scope_replacement_is_refused(self):
        self.alive()
        wrong=subprocess.CompletedProcess([],0,'LoadState=loaded\nActiveState=active\nInvocationID='+'0'*32+'\nControlGroup=/other\n','')
        with patch('model_engine_supervision.subprocess.run',return_value=wrong):
            with self.assertRaisesRegex(ValueError,'differs from current scope'):self.inspect()

if __name__=='__main__':unittest.main()
