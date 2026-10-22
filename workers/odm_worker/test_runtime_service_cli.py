"""Private command inputs and actual owned child lifecycle, without processing."""
import copy
from contextlib import redirect_stderr
import http.client
import io
import json
import os
from pathlib import Path
import signal
import select
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from native_engine_attestation import IMAGE
from admission_journal import Journal
from retained_source import json_bytes
import test_runtime_configuration as fixtures
from test_worker_http import zip_request
import runtime_service_cli as module


class Checks(unittest.TestCase):
    def setUp(self):
        self.fixture=fixtures.Checks();self.fixture.setUp();self.addCleanup(self.fixture.doCleanups)
        self.base=self.fixture.base;self.settings=copy.deepcopy(self.fixture.value)
        self.settings['engine'].update(instanceId='c'*64,imageId=IMAGE)
        self.settings['bounds']['pollSeconds']=300
        self.settings['applicationEndpoint']='http://127.0.0.1:1/rest/v1';self.settings['allowApplicationHttp']=True
        self.secrets={'inboundToken':'synthetic-inbound','application':{'application-original':{'apiKey':'synthetic-api','bearerToken':'synthetic-bearer'}},
            'engine':{'engine-original':None},'callback':{'callback-original':'synthetic-callback'}}
        self.presets={key:[{'name':'dsm','value':key!='fast-preview'}] for key in module.contract.PRESET_IDS}
    def file(self,name,value):
        path=self.base/name;path.write_bytes(json_bytes(value));path.chmod(0o600);return path
    def bindings(self):return module.adapters(self.settings,self.secrets,self.presets)
    def arguments(self):
        (self.base/'command-root').mkdir(mode=0o700,exist_ok=True)
        return ['--root',str(self.base/'command-root'),'--configuration',str(self.file('settings.json',self.settings)),
            '--credentials',str(self.file('secrets.json',self.secrets)),'--presets',str(self.file('presets.json',self.presets)),
            '--host','127.0.0.1','--port','0','--max-queued','4']
    def test_private_canonical_document_reads_exactly(self):
        self.assertEqual(module.document(self.file('input.json',{'a':1})),{'a':1},'Canonical private input must load')
    def test_relative_document_refuses(self):
        original=Path.cwd();self.file('relative.json',{})
        try:
            os.chdir(self.base)
            with self.assertRaisesRegex(ValueError,'absolute paths'):module.document(Path('relative.json'))
        finally:os.chdir(original)
    def test_alias_document_refuses(self):
        source=self.file('source.json',{});alias=self.base/'alias.json';alias.symlink_to(source)
        with self.assertRaisesRegex(ValueError,'absolute paths'):module.document(alias)
    def test_hardlinked_document_refuses(self):
        source=self.file('source.json',{});os.link(source,self.base/'alias.json')
        with self.assertRaisesRegex(ValueError,'without aliases'):module.document(source)
    def test_shared_parent_refuses_before_read(self):
        p=self.file('input.json',{});self.base.chmod(0o755)
        try:
            with self.assertRaisesRegex(ValueError,'private and owned'):module.document(p)
        finally:self.base.chmod(0o700)
    def test_shared_file_refuses(self):
        p=self.file('input.json',{});p.chmod(0o644)
        with self.assertRaisesRegex(ValueError,'private and owned'):module.document(p)
    def test_oversized_document_refuses_before_allocation(self):
        p=self.file('input.json',{'a':'x'*(64*1024)})
        from contextlib import contextmanager
        original=module.reader
        @contextmanager
        def guarded(*args):
            with original(*args) as (stream,info):
                with patch.object(stream,'read',side_effect=AssertionError('Oversized command cannot read contents')):yield stream,info
        with patch.object(module,'reader',guarded):
            with self.assertRaisesRegex(ValueError,'exceeds its bound'):module.document(p)
    def test_noncanonical_document_refuses(self):
        p=self.file('input.json',{});p.write_bytes(b'{"a":1,"a":2}\n')
        with self.assertRaisesRegex(ValueError,'complete canonical JSON'):module.document(p)
    def test_short_document_read_refuses(self):
        from contextlib import contextmanager
        from types import SimpleNamespace
        p=self.file('input.json',{'a':1});raw=p.read_bytes()
        @contextmanager
        def short(*args):yield io.BytesIO(raw),SimpleNamespace(st_size=len(raw)+1)
        with patch.object(module,'reader',short):
            with self.assertRaisesRegex(ValueError,'complete canonical JSON'):module.document(p)
    def test_role_graph_resolves_exact_original_values(self):
        inbound,b=self.bindings()
        self.assertEqual(inbound,'synthetic-inbound','Inbound credential must keep explicit value')
        self.assertEqual(b['application_credentials']('application-original'),self.secrets['application']['application-original'],'Application role keeps both original tokens')
        self.assertIsNone(b['engine_credentials']('engine-original'),'Explicit credential-free local engine remains explicit')
        self.assertEqual(b['callback_credentials']('callback-original'),'synthetic-callback','Callback role keeps original token')
    def test_missing_credential_role_refuses(self):
        del self.secrets['callback']
        with self.assertRaisesRegex(ValueError,'roles differ'):self.bindings()
    def test_extra_credential_reference_refuses(self):
        self.secrets['callback']['foreign']='other'
        with self.assertRaisesRegex(ValueError,'reference differs'):self.bindings()
    def test_non_printable_credential_refuses(self):
        self.secrets['inboundToken']='bad\ntoken'
        with self.assertRaisesRegex(ValueError,'credential differs'):self.bindings()
    def test_foreign_runtime_reference_refuses(self):
        _,b=self.bindings()
        with self.assertRaisesRegex(ValueError,'CLI credential reference differs'):b['callback_credentials']('foreign')
    def test_preset_names_must_be_complete(self):
        del self.presets['balanced']
        with self.assertRaisesRegex(ValueError,'preset names differ'):self.bindings()
    def test_duplicate_options_refuse(self):
        self.presets['balanced']*=2
        with self.assertRaisesRegex(ValueError,'option names repeat'):self.bindings()
    def test_nonfinite_options_refuse(self):
        self.presets['balanced'][0]['value']=float('inf')
        with self.assertRaisesRegex(ValueError,'option value differs'):self.bindings()
    def test_invalid_option_shapes_and_bounds_refuse(self):
        invalid=[None,{},[{'name':f'option-{index}','value':True} for index in range(129)],
            [{'name':'dsm','value':True,'unknown':1}],[{'name':'','value':True}],
            [{'name':'x'*129,'value':True}],[{'name':'dsm','value':{}}],
            [{'name':'dsm','value':'x'*4097}]]
        for value in invalid:
            with self.subTest(valueType=type(value).__name__):
                self.presets['balanced']=value
                with self.assertRaises(ValueError,msg='Invalid option input cannot reach service assembly'):self.bindings()
    def test_invalid_role_token_shapes_refuse(self):
        for role,reference,value in [('application','application-original',{'apiKey':'valid','bearerToken':'bad token'}),
                ('engine','engine-original',42),('callback','callback-original',None)]:
            original=copy.deepcopy(self.secrets)
            try:
                self.secrets[role][reference]=value
                with self.assertRaises(ValueError,msg='Invalid role credential cannot reach service assembly'):self.bindings()
            finally:self.secrets=original
    def test_command_passes_exact_private_graph_to_service(self):
        class Fake:
            def __init__(self,*args,**kwargs):
                self.args=args;self.kwargs=kwargs;self.server=self;self.ran=False;self.closed=False;self.stopped=False
            def run(self):self.ran=True
            def stop(self):self.stopped=True
            def server_close(self):self.closed=True
        instances=[]
        def build(*args,**kwargs):
            service=Fake(*args,**kwargs);instances.append(service);return service
        with patch.object(module,'Service',build):module.run(self.arguments())
        self.assertEqual(len(instances),1,'Command constructs one owned service')
        service=instances[0]
        self.assertEqual(service.args,(self.base/'command-root',self.settings),'Command passes exact root and operator settings')
        self.assertEqual((service.kwargs['host'],service.kwargs['port'],service.kwargs['max_queued']),('127.0.0.1',0,4),'Command passes explicit address and queue bound')
        self.assertEqual(service.kwargs['inbound_token'],'synthetic-inbound','Command passes explicit inbound token')
        self.assertEqual(service.kwargs['options']({'presetId':'balanced'}),self.presets['balanced'],'Command uses the explicit preset adapter')
        self.assertTrue(service.ran and service.stopped and service.closed,'Command runs and closes its owned service')
    def test_original_adapter_values_do_not_follow_input_mutation(self):
        _,b=self.bindings();self.presets['balanced'][0]['value']=False
        self.secrets['application']['application-original']['apiKey']='changed'
        self.assertEqual(b['options']({'presetId':'balanced'}),[{'name':'dsm','value':True}],'Original options remain pinned')
        value=b['application_credentials']('application-original');value['apiKey']='foreign'
        self.assertEqual(b['application_credentials']('application-original')['apiKey'],'synthetic-api','Original credential copy stays pinned')
    def test_missing_request_preset_uses_explicit_balanced_options(self):
        _,b=self.bindings();self.assertEqual(b['options']({}),self.presets['balanced'],'Contract default uses explicit balanced options')
    def test_unknown_request_preset_refuses(self):
        _,b=self.bindings()
        with self.assertRaisesRegex(ValueError,'CLI preset differs'):b['options']({'presetId':'foreign'})
    def test_argument_failure_does_not_echo_values(self):
        output=io.StringIO()
        with redirect_stderr(output):status=module.main(self.arguments()+['--foreign-secret=private-sentinel'])
        self.assertEqual(status,2,'Invalid command returns refused status')
        self.assertNotIn('private-sentinel',output.getvalue(),'Command errors cannot echo supplied arguments')
    def test_failure_does_not_echo_provider_or_file_errors(self):
        output=io.StringIO()
        with patch.object(module,'run',side_effect=ValueError('private-sentinel')),redirect_stderr(output):status=module.main([])
        self.assertEqual(status,2,'Failed original run returns refused status')
        self.assertNotIn('private-sentinel',output.getvalue(),'Run errors cannot echo private provider data')
    def test_original_signal_handlers_restore_after_run(self):
        class Fake:
            def __init__(self,*args,**kwargs):self.server=self;self.stopped=False;self.closed=False
            def stop(self):self.stopped=True
            def server_close(self):self.closed=True
            def run(self):raise ValueError('synthetic-run-error')
        before={kind:signal.getsignal(kind) for kind in (signal.SIGINT,signal.SIGTERM)}
        with patch.object(module,'Service',Fake),self.assertRaisesRegex(ValueError,'synthetic-run-error'):module.run(self.arguments())
        self.assertEqual({kind:signal.getsignal(kind) for kind in before},before,'CLI restores original signal handlers')
    def test_signal_handlers_restore_even_when_server_close_fails(self):
        class Fake:
            def __init__(self,*args,**kwargs):self.server=self
            def stop(self):pass
            def server_close(self):raise OSError('synthetic-close-error')
            def run(self):pass
        before={kind:signal.getsignal(kind) for kind in (signal.SIGINT,signal.SIGTERM)}
        try:
            with patch.object(module,'Service',Fake),self.assertRaisesRegex(OSError,'synthetic-close-error'):module.run(self.arguments())
            self.assertEqual({kind:signal.getsignal(kind) for kind in before},before,'Cleanup errors cannot retain CLI signal handlers')
        finally:
            for kind,handler in before.items():signal.signal(kind,handler)
    def test_operator_interruption_is_graceful(self):
        class Fake:
            def __init__(self,*args,**kwargs):self.server=self
            def stop(self):pass
            def server_close(self):pass
            def run(self):
                signal.getsignal(signal.SIGTERM)(signal.SIGTERM,None)
                raise InterruptedError('synthetic-operator-stop')
        failure=None
        try:
            with patch.object(module,'Service',Fake):module.run(self.arguments())
        except Exception as error:failure=error
        self.assertIsNone(failure,'Requested interruption must stop the explicit command gracefully')
    def test_unrequested_interruption_stays_failed(self):
        class Fake:
            def __init__(self,*args,**kwargs):self.server=self
            def stop(self):pass
            def server_close(self):pass
            def run(self):raise InterruptedError('synthetic-unrequested-stop')
        with patch.object(module,'Service',Fake):
            with self.assertRaisesRegex(InterruptedError,'synthetic-unrequested-stop'):module.run(self.arguments())
    def test_operator_stop_does_not_hide_other_errors(self):
        class Fake:
            def __init__(self,*args,**kwargs):self.server=self
            def stop(self):pass
            def server_close(self):pass
            def run(self):
                signal.getsignal(signal.SIGTERM)(signal.SIGTERM,None)
                raise ValueError('synthetic-other-error')
        with patch.object(module,'Service',Fake):
            with self.assertRaisesRegex(ValueError,'synthetic-other-error'):module.run(self.arguments())
    def test_direct_command_help_starts_no_service(self):
        result=subprocess.run([sys.executable,'-B',str(Path(module.__file__).resolve()),'--help'],
            capture_output=True,timeout=3)
        self.assertEqual(result.returncode,0,'Direct command exposes its operator help')
        self.assertIn(b'--configuration',result.stdout,'Direct command help names explicit inputs')
        self.assertEqual(result.stderr,b'','Direct command help emits no private error')
    def test_actual_child_admits_replays_and_stops_without_processing(self):
        args=self.arguments()
        with socket.socket() as reserve:
            reserve.bind(('127.0.0.1',0));port=reserve.getsockname()[1]
        args[args.index('--port')+1]=str(port)
        read_fd,write_fd=os.pipe()
        bootstrap=("import os,sys; import runtime_service_cli as cli; from runtime_bundle import Bundle\n"
            "original=Bundle.step\n"
            "def observed(self):\n"
            "    result=original(self)\n"
            f"    os.write({write_fd},b'.')\n"
            "    return result\n"
            "Bundle.step=observed\n"
            "sys.exit(cli.main())\n")
        process=subprocess.Popen([sys.executable,'-B','-c',bootstrap,*args],stdout=subprocess.PIPE,stderr=subprocess.PIPE,
            pass_fds=(write_fd,),cwd=Path(module.__file__).parent)
        os.close(write_fd)
        self.addCleanup(lambda:os.close(read_fd))
        self.addCleanup(lambda:process.poll() is None and process.kill())
        try:
            self.assertTrue(select.select([read_fd],[],[],5)[0],'Child must finish its first empty scheduler pass')
            self.assertEqual(os.read(read_fd,1),b'.','Child scheduler observation must be exact')
            deadline=time.monotonic()+5
            while True:
                try:
                    connection=http.client.HTTPConnection('127.0.0.1',port,timeout=.2);connection.request('GET','/healthz');response=connection.getresponse()
                    body=json.loads(response.read());connection.close()
                    self.assertEqual(body['verification'],'process_only','Child health does not imply processing')
                    break
                except OSError:
                    if process.poll() is not None or time.monotonic()>=deadline:self.fail('Explicit child must start owned service')
                    time.sleep(.02)
            request=zip_request('explicit-command-admission');replies=[]
            for _ in range(2):
                connection=http.client.HTTPConnection('127.0.0.1',port,timeout=2)
                connection.request('POST','/api/v1/processing-requests',json.dumps(request),{'Authorization':'Bearer synthetic-inbound'})
                response=connection.getresponse();replies.append((response.status,json.loads(response.read())));connection.close()
            self.assertEqual([row[0] for row in replies],[202,200],'Explicit child keeps one original receipt')
            self.assertEqual(replies[0][1],replies[1][1],'Explicit child exact receipt replays')
            process.send_signal(signal.SIGTERM);stdout,stderr=process.communicate(timeout=4)
            self.assertEqual(process.returncode,0,'Explicit child stops through owned service')
            self.assertEqual((stdout,stderr),(b'',b''),'Explicit child emits no credentials or private request')
            entry=Journal(self.base/'command-root'/'admissions',require_existing=True).get(request['requestId'])
            self.assertIsNotNone(entry,'Explicit child must retain its actual admission')
            self.assertEqual(entry.phase,'accepted','Idle child cannot invent a processing start')
            self.assertIsNone(entry.started_context,'Idle child has no started context')
        finally:
            if process.poll() is None:process.kill();process.communicate(timeout=2)


if __name__=='__main__':unittest.main()
