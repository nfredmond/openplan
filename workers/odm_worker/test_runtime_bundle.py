"""Explicit real adapter assembly without credential reads or engine effects."""
import copy
import unittest
from unittest.mock import patch

from native_engine_attestation import IMAGE
from runtime_configuration import NAME
import test_runtime_configuration as configuration_fixtures
from test_worker_http import zip_request
import runtime_bundle as module


class Connection:
    def __init__(self):self.timeout=None
    def gettimeout(self):return self.timeout
    def settimeout(self,value):self.timeout=value


class Checks(unittest.TestCase):
    def setUp(self):
        self.f=configuration_fixtures.Checks();self.f.setUp();self.addCleanup(self.f.doCleanups)
        self.root=self.f.root;self.value=copy.deepcopy(self.f.value)
        self.value['engine']['instanceId']='c'*64;self.value['engine']['imageId']=IMAGE
        self.calls=[]
        def credentials(reference):self.calls.append(reference);raise AssertionError('Assembly cannot resolve credentials before transport')
        self.arguments={'max_queued':4,'application_credentials':credentials,'engine_credentials':credentials,
            'callback_credentials':credentials,'options':lambda request:[{'name':'dsm','value':True}]}
    def build(self):return module.Bundle(self.root,self.value,**self.arguments)
    def test_real_graph_is_registered_without_credentials_or_network(self):
        bundle=self.build()
        self.assertIs(bundle.runtime.pipeline,bundle.pipeline,'Assembly registers original pipeline')
        self.assertIs(bundle.runtime.recovery,bundle.recovery,'Assembly registers original recovery')
        self.assertIs(bundle.execution.runtime,bundle.runtime,'Execution retains original runtime')
        self.assertIs(bundle.download.access,bundle.access,'HTTP download uses original artifact access')
        self.assertEqual(self.calls,[],'Assembly cannot resolve credentials')
        self.assertTrue((self.root/NAME).exists(),'Assembly seals explicit settings before use')
    def test_owned_empty_graph_is_idle_without_external_effects(self):
        bundle=self.build()
        with bundle.owner():self.assertEqual(bundle.step()['state'],'idle','Empty assembled graph remains idle')
        self.assertEqual(self.calls,[],'Idle assembly cannot resolve credentials')
    def test_admission_follows_configuration_seal(self):
        bundle=self.build();path=self.root/NAME;raw=path.read_bytes();inode=path.stat().st_ino
        with bundle.owner():reply=bundle.submit(zip_request('new-original-assembly-admission'))
        self.assertEqual(reply[0].request['requestId'],'new-original-assembly-admission','Assembly retains exact admitted request')
        self.assertEqual(path.read_bytes(),raw,'Admission retains original operator bytes')
        self.assertEqual(path.stat().st_ino,inode,'Admission retains original seal inode')
        self.assertEqual(self.calls,[],'Admission cannot resolve engine or application credentials')
    def test_unowned_admission_refuses_before_journal_write(self):
        bundle=self.build()
        with patch.object(bundle.runtime,'submit',side_effect=AssertionError('Unowned assembly cannot admit original request')):
            with self.assertRaisesRegex(ValueError,'reads require lifetime'):bundle.submit(zip_request('unowned-assembly-request'))
    def test_changed_seal_refuses_before_execution(self):
        bundle=self.build();bundle.binding.value['targetId']='changed-target'
        with patch.object(bundle.execution,'step',side_effect=AssertionError('Changed assembly configuration cannot execute stage')):
            with self.assertRaisesRegex(ValueError,'Bound operator configuration changed'):
                with bundle.owner():bundle.step()
    def test_replaced_components_refuse_before_private_reads(self):
        bundle=self.build();old=bundle.execution
        with bundle.runtime.owner(),patch.object(bundle,'execution',object()),patch.object(bundle.binding,'check',side_effect=AssertionError('Changed assembly component cannot read configuration')):
            with self.assertRaisesRegex(ValueError,'components changed'):bundle._check()
        self.assertIs(bundle.execution,old,'Component replacement fixture restores original')
    def test_unsupported_engine_refuses_before_operator_seal(self):
        self.value['engine']['imageId']='sha256:'+'a'*64
        with self.assertRaisesRegex(ValueError,'supported image'):self.build()
        self.assertFalse((self.root/NAME).exists(),'Unsupported assembly cannot publish operator settings')
    def test_noncallable_adapter_refuses_before_root_construction(self):
        for key in self.arguments:
            if key=='max_queued':continue
            with self.subTest(key=key),patch.dict(self.arguments,{key:None}),patch.object(module,'Runtime',side_effect=AssertionError('Invalid adapter cannot construct runtime')):
                with self.assertRaisesRegex(ValueError,'credential and option adapters'):self.build()
    def test_cancellation_requires_exact_boolean(self):
        self.arguments['cancelled']=lambda:1;bundle=self.build()
        with bundle.owner(),self.assertRaisesRegex(ValueError,'cancellation must be boolean'):bundle._cancelled()
    def test_true_cancellation_is_forwarded(self):
        self.arguments['cancelled']=lambda:True;bundle=self.build()
        with bundle.owner():self.assertIs(bundle._cancelled(),True,'Assembly forwards cancellation')

    def test_original_photo_extensions_survive_settings_projection(self):
        bundle=self.build();request=zip_request('original-photo-settings')
        request['schemaVersion']='natford-aerial-processing.v1.1'
        request['imagery']={'type':'photo_manifest','photos':[{'url':'https://photos.example/a.png','filename':'a.png'},{'url':'https://photos.example/b.tiff','filename':'b.tiff'}]}
        from types import SimpleNamespace
        entry=SimpleNamespace(request=request)
        row={key:'original-'+key for key in module.JOB_FIELDS}
        with bundle.owner(),patch.object(bundle.dispatch,'load',return_value={'applicationJob':row}):
            settings=bundle._settings(entry)
        self.assertEqual(settings['filenames'],['image-00000.png','image-00001.tiff'],'Assembly retains declared photo types')
        self.assertIsNone(settings['zipLimits'],'Photo inputs have no invented ZIP derivation')
    def test_unknown_photo_extension_refuses_before_preparation(self):
        bundle=self.build();request=zip_request('unknown-photo-settings')
        request['imagery']={'type':'photo_manifest','photos':[{'url':'https://photos.example/a.raw','filename':'a.raw'}]}
        from types import SimpleNamespace
        row={key:'original-'+key for key in module.JOB_FIELDS}
        with bundle.owner(),patch.object(bundle.dispatch,'load',return_value={'applicationJob':row}),self.assertRaisesRegex(ValueError,'photo extension is unsupported'):
            bundle._settings(SimpleNamespace(request=request))
    def test_zip_settings_keep_original_scope_engine_and_bounds(self):
        bundle=self.build();request=zip_request('original-zip-settings')
        from types import SimpleNamespace
        row={key:'original-'+key for key in module.JOB_FIELDS}
        with bundle.owner(),patch.object(bundle.dispatch,'load',return_value={'applicationJob':row}):settings=bundle._settings(SimpleNamespace(request=request))
        self.assertEqual(settings['applicationJob'],row,'Assembly retains original application projection')
        self.assertEqual(settings['targetId'],self.value['targetId'],'Assembly retains original target')
        self.assertEqual(settings['engine'],self.value['engine'],'Assembly retains original engine')
        self.assertEqual(settings['maxBytes'],self.value['bounds']['sourceMaxBytes'],'Assembly retains original source bound')
        self.assertEqual(settings['zipLimits'],{'max_expanded_bytes':16384,'max_entries':10,'max_directory_bytes':4096},'Assembly retains original ZIP bounds')
        self.assertIsNone(settings['filenames'],'ZIP names come from retained derivation')

    def test_replaced_attestor_refuses_before_original_commands(self):
        bundle=self.build()
        with bundle.runtime.owner(),patch.object(bundle,'attest',lambda *a,**k:True),patch.object(bundle.binding,'check',side_effect=AssertionError('Changed native attestor cannot read configuration')):
            with self.assertRaisesRegex(ValueError,'components changed'):bundle._check()
    def test_changed_native_daemon_refuses_before_execution(self):
        bundle=self.build()
        with bundle.runtime.owner(),patch.object(bundle.native_attest,'socket_path',str(self.f.base/'another.sock')),patch.object(bundle.execution,'step',side_effect=AssertionError('Changed native daemon cannot execute stage')):
            with self.assertRaisesRegex(ValueError,'native attestation settings changed'):bundle.step()

    def test_invalid_output_range_refuses_before_configuration_seal(self):
        self.value['bounds']['archiveMaxBytes']=2**63
        with self.assertRaisesRegex(ValueError,'transport range'):self.build()
        self.assertFalse((self.root/NAME).exists(),'Invalid output range cannot seal unusable operator settings')
    def test_direct_download_refuses_changed_access_before_headers(self):
        bundle=self.build()
        from types import SimpleNamespace
        responses=[];handler=SimpleNamespace(connection=Connection(),close_connection=False,_send_json=lambda status,body:responses.append((status,body)))
        with bundle.owner(),patch.object(bundle.download,'access',object()),patch.object(module.Download,'__call__',side_effect=AssertionError('Changed download access cannot serve original bytes')):
            bundle.download(handler)
        self.assertEqual([x[0] for x in responses],[503],'Changed direct download access receives refusal')
        self.assertTrue(handler.close_connection,'Changed direct download closes connection')
    def test_native_attestation_receives_cancellation_aware_ownership(self):
        decision=[False];self.arguments['cancelled']=lambda:decision[0];bundle=self.build()
        def inspect(attestor,engine,deadline,*,owned):
            self.assertIs(owned(),True,'Initial native observation remains owned')
            decision[0]=True
            self.assertIs(owned(),False,'Native observation stops when cancellation arrives')
            return False
        with bundle.owner(),patch.object(module.Attestor,'__call__',inspect):
            self.assertIs(bundle.attest(self.value['engine'],__import__('time').monotonic()+4,owned=lambda:True),False)

    def test_direct_download_refuses_changed_runtime_before_headers(self):
        bundle=self.build()
        from types import SimpleNamespace
        responses=[];handler=SimpleNamespace(connection=Connection(),close_connection=False,_send_json=lambda status,body:responses.append((status,body)))
        with bundle.owner(),patch.object(bundle.download,'runtime',object()),patch.object(module.Download,'__call__',side_effect=AssertionError('Changed download runtime cannot serve original bytes')):
            bundle.download(handler)
        self.assertEqual([x[0] for x in responses],[503],'Changed direct download runtime receives refusal')
    def test_access_refuses_replaced_authority_before_base_read(self):
        bundle=self.build()
        with bundle.runtime.owner(),patch.object(bundle.access,'authorize',lambda *a,**k:True),patch.object(module.ArtifactAccess,'_check',side_effect=AssertionError('Changed download authority cannot read original bytes')):
            with self.assertRaisesRegex(ValueError,'components changed'):bundle.access._check('unread-original',__import__('time').monotonic()+2)

    def test_early_download_refusal_bounds_write_and_restores_timeout(self):
        bundle=self.build()
        from types import SimpleNamespace
        connection=Connection();connection.timeout=7
        def send(status,body):self.assertEqual(connection.timeout,bundle.download.write_timeout,'Early refusal installs actual socket bound before output')
        handler=SimpleNamespace(connection=connection,close_connection=False,_send_json=send)
        with bundle.owner(),patch.object(bundle.download,'access',object()):bundle.download(handler)
        self.assertEqual(connection.timeout,7,'Early refusal restores previous socket timeout')
    def test_early_download_refusal_contains_io_failure(self):
        bundle=self.build()
        from types import SimpleNamespace
        connection=Connection();connection.timeout=7
        def send(status,body):raise OSError('Simulated closed refusal socket')
        handler=SimpleNamespace(connection=connection,close_connection=False,_send_json=send)
        with bundle.owner(),patch.object(bundle.download,'access',object()):bundle.download(handler)
        self.assertEqual(connection.timeout,7,'Failed refusal output restores prior timeout')

    def test_changed_application_endpoint_refuses_before_credential_resolution(self):
        bundle=self.build()
        with bundle.owner(),patch.object(bundle.application_http,'url','https://another-application.example/rest/v1'):
            with self.assertRaises(ValueError):
                bundle.application_http({'p_request':'unread','p_installation':'original-installation','p_target':'original-target'},__import__('time').monotonic()+2,owned=lambda:True)
        self.assertEqual(self.calls,[],'Changed application endpoint cannot resolve original credentials')
    def test_changed_source_policy_refuses_before_fetch(self):
        bundle=self.build()
        from io import BytesIO
        with bundle.owner(),patch.object(bundle.source_http,'ports',(8001,)),patch.object(module.SourceHttp,'_check',side_effect=AssertionError('Changed source policy cannot enter source transport')):
            with self.assertRaisesRegex(ValueError,'source transport settings changed'):
                bundle.source_http('https://photos.example/a.jpg',BytesIO(),100,__import__('time').monotonic()+2)
    def test_replaced_application_transport_refuses_before_credentials(self):
        bundle=self.build()
        with bundle.runtime.owner(),patch.object(bundle.reader,'transport',object()),patch.object(bundle.binding,'check',side_effect=AssertionError('Changed application transport cannot read configuration')):
            with self.assertRaisesRegex(ValueError,'components changed'):bundle._check()
    def test_changed_draft_resolver_refuses_before_original_transport(self):
        bundle=self.build()
        with bundle.runtime.owner(),patch.object(bundle.draft_http,'credentials',lambda ref:None):
            with self.assertRaisesRegex(ValueError,'draft transport settings changed'):bundle._check()

    def test_replaced_commit_authority_refuses_before_transport(self):
        bundle=self.build()
        with bundle.runtime.owner(),patch.object(bundle.pipeline.commit,'authorize',lambda *a,**k:True),patch.object(bundle.binding,'check',side_effect=AssertionError('Changed processing authority cannot read configuration')):
            with self.assertRaisesRegex(ValueError,'components changed'):bundle._check()
    def test_replaced_draft_authority_refuses_before_transport(self):
        bundle=self.build()
        with bundle.runtime.owner(),patch.object(bundle.pipeline.inputs.pipeline,'authorize',lambda *a,**k:True),patch.object(bundle.binding,'check',side_effect=AssertionError('Changed draft authority cannot read configuration')):
            with self.assertRaisesRegex(ValueError,'components changed'):bundle._check()
    def test_changed_lease_bound_refuses_before_stage(self):
        bundle=self.build()
        with bundle.runtime.owner(),patch.object(bundle.pipeline.coordinator,'lease_seconds',86400),patch.object(bundle.execution,'step',side_effect=AssertionError('Changed lease bound cannot execute stage')):
            with self.assertRaisesRegex(ValueError,'persistent settings changed'):bundle.step()
    def test_changed_output_budget_refuses_before_stage(self):
        bundle=self.build();output=bundle.pipeline.coordinator.plan.inspection.products.intake
        with bundle.runtime.owner(),patch.object(output,'_limits',tuple((key,1000000) for key in output.limits)),patch.object(bundle.execution,'step',side_effect=AssertionError('Changed output budget cannot execute stage')):
            with self.assertRaisesRegex(ValueError,'persistent settings changed'):bundle.step()
    def test_changed_source_root_refuses_before_stage(self):
        bundle=self.build();intake=bundle.pipeline.inputs.pipeline.intake
        with bundle.runtime.owner(),patch.object(intake,'source_root',self.f.base/'another-source'),patch.object(bundle.execution,'step',side_effect=AssertionError('Changed source root cannot execute stage')):
            with self.assertRaisesRegex(ValueError,'persistent settings changed'):bundle.step()

    def test_rejected_write_timeout_uses_fixed_refusal_bound(self):
        from types import SimpleNamespace
        bundle=self.build()
        for timeout in [None,100000,-1,float('inf')]:
            with self.subTest(timeout=timeout):
                connection=Connection();connection.timeout=7
                def send(status,body):self.assertEqual(connection.timeout,.25,'Rejected timeout cannot widen early refusal bound')
                handler=SimpleNamespace(connection=connection,close_connection=False,_send_json=send)
                with bundle.owner(),patch.object(bundle.download,'write_timeout',timeout):bundle.download(handler)
                self.assertEqual(connection.timeout,7,'Rejected timeout refusal restores original connection state')

    def test_active_native_observer_child_stops_after_bundle_cancellation(self):
        import os,threading,time
        import native_engine_attestation as native
        import test_native_engine_attestation as fixtures
        engine,container,network=fixtures.fixture(self.f.base)
        path=self.f.base/'native.sock';daemon=fixtures.Daemon(path,engine,container,network);daemon.stall=True
        self.addCleanup(daemon.close)
        self.value['engine']=engine;self.value['daemonSocket']=str(path);self.value['daemonUid']=os.getuid()
        cancelled=threading.Event();self.arguments['cancelled']=cancelled.is_set;bundle=self.build()
        children=[];popen=native.subprocess.Popen
        def start(*args,**kwargs):
            process=popen(*args,**kwargs);children.append(process);return process
        def cancel():daemon.inspect_started.wait(timeout=2);cancelled.set()
        thread=threading.Thread(target=cancel,daemon=True);thread.start()
        try:
            with bundle.owner(),patch.object(native.subprocess,'Popen',start),self.assertRaisesRegex(InterruptedError,'observation owner ended'):
                bundle.attest(engine,time.monotonic()+2,owned=lambda:True)
            self.assertTrue(daemon.inspect_started.is_set(),'Native cancellation reaches actual Unix daemon GET')
            self.assertEqual(len(children),1,'Native cancellation owns one actual supervised child')
            self.assertIsNotNone(children[0].poll(),'Native cancellation stops and reaps owned observer child')
        finally:daemon.release.set();thread.join(timeout=3)
