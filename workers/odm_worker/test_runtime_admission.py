"""Opt-in actual HTTP/journal checks with controlled pipelines, no engine."""
from concurrent.futures import ThreadPoolExecutor
import copy
import hashlib
import http.client
import json
import os
from pathlib import Path
import shutil
import tempfile
import threading
import unittest
from unittest.mock import patch

from admission_journal import FILENAME, IdentityConflict, QueueFull, Journal
import admission_journal
import sqlite3
import runtime_admission as module
from runtime_admission import Runtime
from retained_source import json_bytes, writer
import test_worker_http as fixture
import main

TASK = '12345678-1234-4234-8234-123456789abc'


class Checks(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='odm-runtime-');self.base = Path(self.temporary.name)
        self.root = self.base/'worker';self.root.mkdir(mode=0o700);self.calls = []
        self.args = {'root':self.root,'installation_id':'synthetic-installation','max_queued':2,'pipeline':self.terminal}
        self.request = fixture.zip_request('synthetic-original-request')
        self.config = dict(main.CONFIG);self.original_admissions=main.ADMISSIONS;main.CONFIG['worker_token']='worker-secret'
        self.servers = []

    def tearDown(self):
        for server, thread in self.servers:
            server.shutdown();server.server_close();thread.join(2)
            self.assertFalse(thread.is_alive())
        main.CONFIG.clear();main.CONFIG.update(self.config);main.ADMISSIONS=self.original_admissions;self.temporary.cleanup()

    def terminal(self, job):
        self.calls.append(job['request']['requestId']);job['state']='failed'
        job['reportedEngineTerminal']={'taskUuid':TASK,'statusCode':30}

    def open(self, **changes): return Runtime(**{**self.args,**changes})

    def server(self, runtime):
        server=main.build_server('127.0.0.1',0,admissions=runtime)
        thread=threading.Thread(target=lambda:server.serve_forever(poll_interval=.01),daemon=True);thread.start()
        self.servers.append((server,thread));return server.server_address[1]

    def post(self, port, body=None, token='worker-secret'):
        return fixture.request(port,'POST','/api/v1/processing-requests',self.request if body is None else body,token=token)

    def test_original_receipt_replays_before_capacity_and_payload_conflicts(self):
        runtime=self.open();entry,first=runtime.submit(self.request);self.assertIs(first,True)
        runtime.max_queued=0
        replay,first=runtime.submit(copy.deepcopy(self.request));self.assertIs(first,False)
        self.assertEqual(replay,entry,'original receipt and reference must survive exact replay')
        changed=copy.deepcopy(self.request);changed['missionTitle']='Changed'
        with self.assertRaises(IdentityConflict):runtime.submit(changed)
        another=copy.deepcopy(self.request);another['requestId']='synthetic-another-request'
        with self.assertRaises(QueueFull):runtime.submit(another)

    def test_fifo_starts_once_and_terminal_records_stay_unassessed(self):
        runtime=self.open()
        for request_id in ('synthetic-z-first','synthetic-a-second'):
            request=copy.deepcopy(self.request);request['requestId']=request_id;runtime.submit(request)
        with runtime.owner():
            self.assertIs(runtime.run_one(),True);self.assertIs(runtime.run_one(),True);self.assertIs(runtime.run_one(),False)
        self.assertEqual(self.calls,['synthetic-z-first','synthetic-a-second'],'original admission insertion order must survive')
        self.assertEqual(runtime.status()['localTerminal'],2)
        for entry in runtime.journal.started():
            outcome=runtime._outcome(entry)
            self.assertEqual(outcome['reportedEngineTerminal'],{'taskUuid':TASK,'statusCode':30})
            for key in ('callbackDeliveryVerification','sourceCustodyVerification','engineCustodyVerification'):
                self.assertEqual(outcome[key],'unassessed','local terminal state cannot promote custody')

    def test_missing_terminal_and_local_failure_hold_accepted_queue(self):
        for terminal in (False,True):
            with self.subTest(terminal=terminal):
                root=self.base/('held-'+str(terminal));root.mkdir(mode=0o700)
                def incomplete(job): self.calls.append(job['request']['requestId']);job.update(state='failed' if terminal else 'accepted')
                runtime=self.open(root=root,pipeline=incomplete)
                runtime.submit(self.request);other=copy.deepcopy(self.request);other['requestId']='synthetic-held-next';runtime.submit(other)
                with runtime.owner():
                    self.assertIs(runtime.run_one(),True);self.assertIs(runtime.run_one(),False,'uncertain engine start must hold later accepted work')
                self.assertEqual(runtime.status()['heldStarted'],1);self.assertEqual(runtime.status()['accepted'],1)

    def test_pipeline_exception_keeps_original_start_and_queue_hold(self):
        def crash(_job):raise RuntimeError('synthetic interruption')
        runtime=self.open(pipeline=crash);runtime.submit(self.request)
        with runtime.owner():
            with self.assertRaisesRegex(RuntimeError,'synthetic interruption'):runtime.run_one()
            self.assertEqual(runtime.journal.get(self.request['requestId']).phase,'started','start must precede uncertain pipeline entry')
            self.assertIs(runtime.run_one(),False)

    def test_execution_requires_lifetime_owner_and_competing_owner_refuses(self):
        runtime=self.open();runtime.submit(self.request)
        with self.assertRaisesRegex(ValueError,'lifetime owner'):runtime.run_one()
        with runtime.owner():
            with self.assertRaises(TimeoutError):
                with writer(runtime.root,__import__('time').monotonic()+.01): pass

    def test_second_runtime_cannot_take_owned_root(self):
        runtime=self.open()
        with runtime.owner(),self.assertRaises(TimeoutError):self.open(timeout=.01)

    def test_concurrent_pipeline_calls_cannot_overlap(self):
        entered=threading.Event();release=threading.Event()
        def paused(job):entered.set();release.wait(2);self.terminal(job)
        runtime=self.open(pipeline=paused);runtime.submit(self.request)
        with runtime.owner(),ThreadPoolExecutor(max_workers=1) as pool:
            future=pool.submit(runtime.run_one)
            try:
                self.assertTrue(entered.wait(1))
                with patch.object(runtime.journal,'started',side_effect=AssertionError('Concurrent execution reached journal before exclusion')):
                    self.assertIs(runtime.run_one(),False,'one owned runtime cannot overlap pipelines')
            finally:release.set()
            self.assertIs(future.result(2),True)
        self.assertEqual(self.calls,[self.request['requestId']])

    def test_installation_seal_and_private_root_refuse_changed_identity(self):
        self.open()
        for changes in ({'installation_id':'another-installation'},{'installation_id':''},{'installation_id':'x'*257},{'max_queued':True},{'max_queued':-1},{'pipeline':None},{'root':Path('relative')}):
            with self.subTest(changes=changes),self.assertRaises(ValueError):self.open(**changes)
        self.root.chmod(0o755)
        with patch.object(module,'Journal',side_effect=AssertionError('Public runtime root reached journal')),self.assertRaises(ValueError):self.open()
        self.root.chmod(0o700)
        alias=self.base/'alias';alias.symlink_to(self.root)
        with self.assertRaises(ValueError):self.open(root=alias)

    def test_saved_installation_change_refuses_before_admission_or_pipeline(self):
        runtime=self.open();path=self.root/'runtime-installation.json';value=json.loads(path.read_bytes());value['installationId']='changed';path.write_bytes(json_bytes(value))
        for action in (lambda:runtime.submit(self.request),runtime.status):
            with self.assertRaisesRegex(ValueError,'installation identity differs'):action()
        with self.assertRaisesRegex(ValueError,'installation identity differs'):
            with runtime.owner(): pass

    def test_invalid_reported_terminal_types_and_states_refuse(self):
        for observed in ({'taskUuid':TASK,'statusCode':True},{'taskUuid':TASK,'statusCode':20},{'taskUuid':'changed','statusCode':30}, {'taskUuid':TASK,'statusCode':30,'extra':1}):
            with self.subTest(observed=observed),self.assertRaisesRegex(ValueError,'terminal observation differs'):Runtime._terminal('failed',observed)
        for state,code in (('succeeded',30),('canceled',40)):
            with self.assertRaisesRegex(ValueError,'terminal observation differs'):Runtime._terminal(state,{'taskUuid':TASK,'statusCode':code})

    def test_changed_terminal_binding_and_grade_refuse(self):
        runtime=self.open();runtime.submit(self.request)
        with runtime.owner():runtime.run_one()
        entry=runtime.journal.get(self.request['requestId']);path=self.root/runtime._name(entry);original=path.read_bytes()
        for change in (lambda p:p['binding'].update(jobReference='changed'),lambda p:p.update(callbackDeliveryVerification='verified'),lambda p:p.update(extra=1),lambda p:p.update(state='running')):
            try:
                value=json.loads(original);change(value);path.write_bytes(json_bytes(value))
                with self.assertRaisesRegex(ValueError,'terminal record differs'):runtime.status()
            finally:path.write_bytes(original)

    def test_terminal_publication_interruption_does_not_repeat_pipeline(self):
        runtime=self.open();runtime.submit(self.request);publish=module.publish
        def interrupted(root,name,value):
            if name.startswith('pipeline-outcome-'):raise OSError('synthetic lost terminal write')
            return publish(root,name,value)
        with runtime.owner():
            with patch.object(module,'publish',interrupted),self.assertRaisesRegex(OSError,'lost terminal write'):runtime.run_one()
            self.assertIs(runtime.run_one(),False,'failed terminal publication cannot repeat started work')
        self.assertEqual(self.calls,[self.request['requestId']])

    def test_copied_root_replays_original_receipt_and_holds_uncertain_start(self):
        runtime=self.open(pipeline=lambda job:None);entry,_first=runtime.submit(self.request)
        with runtime.owner():runtime.run_one()
        moved=self.base/'moved';shutil.copytree(self.root,moved)
        restored=self.open(root=moved,max_queued=0);replayed,first=restored.submit(self.request)
        self.assertIs(first,False);self.assertEqual(replayed.admission,entry.admission,'copied root must preserve original accepted receipt')
        with restored.owner():self.assertIs(restored.run_one(),False,'copied started work cannot repeat')
        self.assertEqual(restored.status()['heldStarted'],1)

    def test_http_both_shapes_original_receipt_conflict_and_queue_full(self):
        runtime=self.open();port=self.server(runtime)
        status,receipt=self.post(port);self.assertEqual(status,202)
        self.assertEqual(self.post(port),(200,receipt),'actual HTTP replay must preserve original receipt')
        changed=copy.deepcopy(self.request);changed['missionTitle']='Changed'
        self.assertEqual(self.post(port,changed)[0],409,'changed HTTP payload must refuse the original ID')
        manifest=fixture.manifest_request('synthetic-manifest-request');self.assertEqual(self.post(port,manifest)[0],202)
        extra=copy.deepcopy(self.request);extra['requestId']='synthetic-extra-request'
        self.assertEqual(self.post(port,extra)[0],503)
        self.assertEqual(len(runtime.journal.accepted()),2)

    def test_http_authentication_and_contract_checks_precede_durable_admission(self):
        runtime=self.open();port=self.server(runtime)
        with patch.object(runtime,'submit',side_effect=AssertionError('Unauthenticated or invalid request reached journal')):
            self.assertEqual(self.post(port,token=None)[0],401,'authentication must precede durable admission');self.assertEqual(self.post(port,token='wrong')[0],401)
            bad=copy.deepcopy(self.request);bad['schemaVersion']='natford-aerial-processing.v1.1'
            self.assertEqual(self.post(port,bad)[0],422,'contract validation must precede durable admission')
        self.assertEqual(runtime.journal.accepted(),[])

    def test_http_journal_failure_does_not_fall_back_to_memory(self):
        runtime=self.open();port=self.server(runtime)
        with patch.object(runtime,'submit',side_effect=OSError('synthetic private journal failure')):
            status,body=self.post(port)
        self.assertEqual(status,503,'journal failure cannot answer an accepted receipt')
        self.assertEqual(body['error'],'admission_unavailable');self.assertEqual(runtime.journal.accepted(),[])
        self.assertEqual(main.JOB_QUEUE.qsize(),0)

    def test_http_health_reads_durable_queue_and_preserves_unavailable(self):
        runtime=self.open();runtime.submit(self.request);port=self.server(runtime)
        with patch('nodeodm_client.NodeODMClient.info',side_effect=RuntimeError('synthetic engine unassessed')):
            status,body=fixture.request(port,'GET','/healthz');self.assertEqual(status,200)
            self.assertEqual(body['queued'],1,'health must count durable accepted work')
            self.assertEqual(body['admission']['heldStarted'],0)
            with patch.object(runtime,'status',side_effect=ValueError('synthetic unavailable')):
                status,body=fixture.request(port,'GET','/healthz')
                self.assertIsNone(body['queued'],'unavailable journal count cannot become zero');self.assertIs(body['admission']['available'],False)

    def test_managed_configuration_requires_explicit_mode(self):
        with patch.dict(os.environ,{'ODM_WORKER_MANAGED_ADMISSION':'0'}):self.assertIs(main.config()['managed_admission'],False)
        with patch.dict(os.environ,{'ODM_WORKER_MANAGED_ADMISSION':'1','ODM_WORKER_INSTALLATION_ID':'synthetic-installation','ODM_WORKER_MANAGED_STATE_DIR':str(self.root)}):
            config=main.config();self.assertIs(config['managed_admission'],True);self.assertEqual(config['installation_id'],'synthetic-installation')
        with patch.dict(os.environ,{'ODM_WORKER_MANAGED_ADMISSION':'yes'}),self.assertRaisesRegex(ValueError,'must be 0 or 1'):main.config()

    def test_pipeline_cannot_replace_original_request_or_reference(self):
        for key,value in (('job_reference','changed'),('request',fixture.zip_request('synthetic-changed-request')),('nested','changed')):
            root=self.base/('changed-'+key);root.mkdir(mode=0o700)
            def changed(job):
                self.terminal(job)
                if key=='nested':job['request']['missionTitle']=value
                else:job[key]=value
            runtime=self.open(root=root,pipeline=changed);runtime.submit(self.request)
            with runtime.owner(),self.assertRaisesRegex(ValueError,'Pipeline changed original ODM identity'):runtime.run_one()
            self.assertEqual(runtime.status()['heldStarted'],1)
            self.assertEqual(runtime.journal.get(self.request['requestId']).request,self.request)

    def test_changed_installation_refuses_before_journal_reads(self):
        self.open()
        with patch.object(module.Journal,'accepted',side_effect=AssertionError('Changed installation accessed journal')):
            with self.assertRaisesRegex(ValueError,'^Existing source custody record differs$'):self.open(installation_id='another-installation')

    def test_invalid_configuration_refuses_before_root_access(self):
        for changes in ({'installation_id':''},{'installation_id':'x'*257},{'max_queued':True},{'max_queued':-1},{'pipeline':None}):
            with self.subTest(changes=changes),patch.object(module,'absolute',side_effect=AssertionError('Invalid runtime configuration reached root')):
                with self.assertRaises(ValueError):self.open(**changes)

    def test_actual_main_attaches_runtime_and_owns_root_before_serving(self):
        runtime=self.open();runtime.submit(self.request)
        (self.base/'scratch').mkdir(mode=0o700)
        class Stop(BaseException):pass
        class Thread:
            def __init__(self,*_args,**_kwargs):pass
            def start(self):pass
        original_build=main.build_server;servers=[]
        def build():
            self.assertIsNotNone(main.ADMISSIONS,'main must attach durable runtime before serving')
            self.assertEqual(main.ADMISSIONS.root,self.root.resolve(),'main must reopen the declared original state, not scratch')
            server=original_build('127.0.0.1',0);servers.append(server)
            self.assertIs(server.admissions,main.ADMISSIONS,'server must use the actual durable runtime')
            def serve():
                self.assertIs(main.ADMISSIONS._owned,True,'main must hold durable runtime owner while serving')
                main.worker_loop()
            server.serve_forever=serve
            return server
        try:
            with patch.dict(main.CONFIG,{'work_dir':str(self.base/'scratch'),'managed_state_dir':str(self.root),'managed_admission':True,'installation_id':'synthetic-installation','callback_token':'synthetic-callback'}),patch.object(main,'PIPELINE',self.terminal),patch.object(main,'build_server',build),patch.object(main.threading,'Thread',Thread),patch.object(main.time,'sleep',side_effect=Stop),patch.object(main.JOB_QUEUE,'get',side_effect=AssertionError('Managed loop reached memory queue')):
                with self.assertRaises(Stop):main.main()
            self.assertEqual(self.calls,[self.request['requestId']],'actual managed loop must consume durable accepted work')
            self.assertIs(main.ADMISSIONS._owned,False,'main exit must release its lifetime owner')
        finally:
            for server in servers:server.server_close()

    def restore_file(self, original, held, label):
        if original.exists():original.rename(self.base/('unexpected-'+label))
        held.rename(original)

    def test_missing_original_database_refuses_without_recreating_registry(self):
        runtime=self.open();runtime.submit(self.request);database=self.root/'admissions'/FILENAME;held=self.base/'held-database';database.rename(held)
        try:
            for action in (runtime.status,lambda:runtime.submit(self.request),self.open):
                with self.assertRaises(OSError):action()
                self.assertFalse(database.exists(),'missing original admission database cannot become a new registry')
        finally:self.restore_file(database,held,'database')
        self.assertEqual(runtime.journal.get(self.request['requestId']).request,self.request)

    def test_missing_original_journal_directory_is_not_recreated(self):
        runtime=self.open();runtime.submit(self.request);directory=self.root/'admissions';held=self.base/'held-journal-directory';directory.rename(held)
        try:
            with self.assertRaises(OSError):runtime.status()
            self.assertFalse(directory.exists(),'existing installation cannot recreate its missing journal directory')
        finally:
            if directory.exists():directory.rename(self.base/'unexpected-journal-directory')
            held.rename(directory)

    def test_database_disappearing_at_open_is_not_recreated(self):
        runtime=self.open();runtime.submit(self.request);database=self.root/'admissions'/FILENAME;held=self.base/'held-open-database';private=admission_journal.private
        def removed(path,directory):
            private(path,directory)
            if path==database:database.rename(held)
        try:
            error=None
            with patch.object(admission_journal,'private',removed):
                try:runtime.status()
                except Exception as caught:error=caught
            self.assertFalse(database.exists(),'existing journal connection must not recreate a disappeared file')
            self.assertIsInstance(error,sqlite3.OperationalError)
        finally:self.restore_file(database,held,'open-database')

    def test_missing_original_seal_refuses_populated_journal(self):
        runtime=self.open();runtime.submit(self.request);seal=self.root/'runtime-installation.json';held=self.base/'held-seal';seal.rename(held)
        try:
            with self.assertRaisesRegex(ValueError,'admissions require their original installation seal'):self.open(installation_id='another-installation')
            self.assertFalse(seal.exists(),'missing original seal cannot bind populated admissions to another installation')
        finally:self.restore_file(seal,held,'seal')

    def test_missing_seal_with_retained_records_refuses_before_journal_read(self):
        runtime=self.open();extra=self.root/'retained.bin';extra.write_bytes(b'Synthetic retained record');extra.chmod(0o600)
        seal=self.root/'runtime-installation.json';held=self.base/'held-record-seal';seal.rename(held)
        try:
            with patch.object(module.Journal,'accepted',side_effect=AssertionError('Unsealed retained records accessed journal')):
                with self.assertRaisesRegex(ValueError,'runtime records require their original installation seal'):self.open()
        finally:self.restore_file(seal,held,'record-seal')
        self.assertEqual(extra.read_bytes(),b'Synthetic retained record')

    def test_empty_original_database_is_not_initialized_as_new(self):
        runtime=self.open();runtime.submit(self.request);database=self.root/'admissions'/FILENAME;held=self.base/'held-empty-database';database.rename(held)
        database.write_bytes(b'');database.chmod(0o600)
        try:
            with self.assertRaisesRegex(ValueError,'Original ODM admission journal is not initialized'):self.open()
            self.assertEqual(database.stat().st_size,0,'restoration cannot initialize an empty original database')
        finally:self.restore_file(database,held,'empty-database')

    def test_existing_journal_mode_requires_exact_boolean(self):
        for value in (None,0,1,'1'):
            with self.subTest(value=value),self.assertRaisesRegex(ValueError,'existing journal mode must be boolean'):Journal(self.root/'admissions',require_existing=value)

    def test_existing_pipeline_retains_reported_terminal_before_local_result(self):
        runtime=self.open();entry,_first=runtime.submit(self.request)
        job={'request':entry.request,'job_reference':entry.job_reference,'state':'accepted'}
        images=self.base/'images';images.mkdir();(images/'a.jpg').write_bytes(b'Synthetic ordinary bytes')
        class Client:
            def create_task(self,*_args):return TASK
            def upload_image(self,*_args):pass
            def commit_task(self,*_args):pass
            def task_info(self,*_args):return {'status':{'code':30,'errorMessage':'Synthetic failure'}}
        with patch.dict(main.CONFIG,{'work_dir':str(self.root)}):
            main.process_job(job,make_client=Client,prepare=lambda *_args:str(images),send=lambda *_args,**_kwargs:True)
        self.assertEqual(job['state'],'failed')
        self.assertEqual(job.get('reportedEngineTerminal'),{'taskUuid':TASK,'statusCode':30},'pipeline must retain original task and terminal report')


if __name__=='__main__':unittest.main()
