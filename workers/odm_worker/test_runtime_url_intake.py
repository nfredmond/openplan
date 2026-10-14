"""Original supplied settings and source/preparation composition, not live authority."""
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import time
import unittest
from unittest.mock import patch
import zipfile

import runtime_url_intake as module
from runtime_url_intake import Intake
from runtime_admission import Runtime
import test_runtime_preparation as fixture


class Checks(unittest.TestCase):
    def setUp(self):
        self.fixture=fixture.Checks();self.fixture.setUp();self.runtime=self.fixture.runtime
        self.request=self.fixture.request;self.raw=self.fixture.raw;self.calls=[];self.supplied=[];self.jobs=[]
        self.spec={key:copy.deepcopy(self.fixture.spec[key]) for key in module.SETTINGS}
        self.source_root=self.fixture.base/'url-source';self.root=self.folder(self.runtime.root,self.request['requestId'])
        self.intake=Intake(self.runtime,self.source_root,'synthetic-local-target',self.supply,self.fetch,timeout=4)
        def pipeline(job):self.jobs.append(job);self.intake(job)
        self.runtime.pipeline=pipeline

    def tearDown(self):self.fixture.tearDown()

    @staticmethod
    def folder(root,request_id):return root/('url-intake-'+hashlib.sha256(request_id.encode()).hexdigest())

    def supply(self,entry):self.supplied.append(entry);return self.spec

    def fetch(self,url,output,remaining,deadline):
        self.calls.append(url);raw=self.raw[0] if url.endswith('a.jpg') else self.raw[1]
        output.write(raw);return len(raw)

    def start(self):return self.fixture.start()

    def resume(self):
        with self.runtime.owner():self.start();return self.intake.resume(self.request['requestId'])

    @staticmethod
    def read(path):return json.loads(path.read_bytes())

    @staticmethod
    def restore(path,raw):path.write_bytes(raw);path.chmod(0o600)

    def test_actual_owned_queue_freezes_original_settings_and_holds_next_job(self):
        later=copy.deepcopy(self.request);later['requestId']='synthetic-later';self.runtime.submit(later)
        with self.runtime.owner():
            self.assertIs(self.runtime.run_one(),True);self.assertIs(self.runtime.run_one(),False,'Original prepared start must hold the next job')
        plan=self.read(self.root/'plan.json');result=self.read(self.root/'prepared.json')
        self.assertEqual(plan['settings'],self.spec,'Every original preparation setting must be saved')
        self.assertEqual(plan['binding']['request'],self.request)
        self.assertEqual(plan['binding']['admission'],self.fixture.entry.admission)
        self.assertEqual(plan['binding']['originalContext']['originalActorId'],'synthetic-original-actor')
        self.assertEqual(result['preparation'],self.jobs[0]['preparation'])
        self.assertEqual(self.jobs[0]['state'],'prepared')
        self.assertEqual(result['authorityVerification'],'unassessed','URL intake cannot promote authority')
        self.assertIs(result['engineTransportPermission'],False,'URL intake cannot permit engine transport')
        self.assertIs(result['preparation']['engineTransportPermission'],False)
        self.assertFalse(list((self.fixture.folder/'engine').glob('*.intent.json')))
        self.assertEqual(len(self.supplied),1)

    def test_settings_and_context_saved_before_first_fetch(self):
        fetch=self.intake.fetch
        def inspect(url,output,remaining,deadline):
            self.assertTrue((self.root/'plan.json').exists(),'Original settings must be durable before the first fetch')
            plan=self.read(self.root/'plan.json');self.assertEqual(plan['settings']['engine'],self.spec['engine'])
            self.assertEqual(plan['binding']['originalContext']['originalActorId'],'synthetic-original-actor')
            return fetch(url,output,remaining,deadline)
        self.intake.fetch=inspect;self.resume()

    def test_supplier_input_is_detached_from_original_admission(self):
        def supply(entry):entry.request['missionTitle']='Changed supplier copy';return self.spec
        self.intake.supply=supply;self.resume()
        self.assertEqual(self.read(self.root/'plan.json')['binding']['request'],self.request,'Supplier cannot change the original request')

    def test_settings_alias_mutation_during_fetch_cannot_change_preparation(self):
        original=copy.deepcopy(self.spec);fetch=self.intake.fetch
        def mutate(url,output,remaining,deadline):
            self.spec['engine']['instanceId']='Changed during download';self.spec['options'][0]['value']=False
            self.spec['applicationJob']['created_by']='Changed actor';self.spec['maxBytes']=1
            return fetch(url,output,remaining,deadline)
        self.intake.fetch=mutate;self.resume()
        self.assertEqual(self.read(self.root/'plan.json')['settings'],original,'Saved settings cannot alias the supplier')
        engine=self.read(self.fixture.folder/'engine/plan.json')
        self.assertEqual(engine['engine'],original['engine'],'Preparation must use the original engine settings')
        self.assertEqual(engine['options'],original['options'])

    def test_completed_replay_never_supplies_or_fetches_and_keeps_task(self):
        first=self.resume();task=first['preparation']['taskUuid'];plan=(self.root/'plan.json').read_bytes()
        self.intake.supply=lambda entry:(_ for _ in ()).throw(AssertionError('Completed intake called changed supplier'))
        self.intake.fetch=lambda *args:(_ for _ in ()).throw(AssertionError('Completed intake refetched'))
        with self.runtime.owner():self.assertEqual(self.intake.resume(self.request['requestId']),first)
        self.assertEqual(first['preparation']['taskUuid'],task);self.assertEqual((self.root/'plan.json').read_bytes(),plan)

    def test_partial_intake_uses_saved_settings_and_only_missing_original_slot(self):
        original=copy.deepcopy(self.spec);fetch=self.intake.fetch
        def partial(url,output,remaining,deadline):
            if url.endswith('b.jpg'):output.write(self.raw[1][:3]);raise OSError('Synthetic interrupted second slot')
            return fetch(url,output,remaining,deadline)
        self.intake.fetch=partial
        with self.runtime.owner():
            self.start()
            with self.assertRaisesRegex(OSError,'Synthetic interrupted second slot'):self.intake.resume(self.request['requestId'])
            self.assertFalse(self.fixture.folder.exists(),'Partial source intake cannot create a preparation task')
            self.spec['engine']['instanceId']='Changed after interruption';self.spec['applicationJob']['created_by']='Changed actor'
            self.intake.supply=lambda entry:(_ for _ in ()).throw(AssertionError('Partial recovery called changed supplier'))
            self.calls.clear();self.intake.fetch=fetch;result=self.intake.resume(self.request['requestId'])
        self.assertEqual(self.calls,[self.request['imagery']['photos'][1]['url']],'Recovery must fetch only the missing original slot')
        self.assertEqual(self.read(self.root/'plan.json')['settings'],original)
        self.assertEqual(self.read(self.fixture.folder/'engine/plan.json')['engine'],original['engine'])
        self.assertIs(result['engineTransportPermission'],False)

    def test_relocated_two_roots_keep_original_settings_and_no_refetch(self):
        result=self.resume();runtime_root=self.fixture.base/'restored-runtime';source_root=self.fixture.base/'restored-source'
        shutil.copytree(self.runtime.root,runtime_root);shutil.copytree(self.source_root,source_root)
        runtime=Runtime(runtime_root,'synthetic-installation',max_queued=0,pipeline=lambda job:None)
        intake=Intake(runtime,source_root,'synthetic-local-target',lambda *args:(_ for _ in ()).throw(AssertionError('Restored intake resupplied')),
            lambda *args:(_ for _ in ()).throw(AssertionError('Restored intake refetched')),timeout=4)
        with runtime.owner():self.assertEqual(intake.resume(self.request['requestId']),result)
        self.assertEqual(self.read(self.folder(runtime_root,self.request['requestId'])/'plan.json'),self.read(self.root/'plan.json'))

    def test_invalid_constructor_adapters_target_timeout_or_roots(self):
        for changes in ({'runtime':object()},{'supply':None},{'fetch':None},{'cancelled':None},{'target_id':''},{'target_id':'x'*257},
            {'timeout':True},{'timeout':float('nan')},{'timeout':0},{'source_root':self.runtime.root},{'source_root':self.runtime.root/'child'},{'source_root':self.runtime.root.parent}):
            args={'runtime':self.runtime,'source_root':self.source_root,'target_id':'synthetic-local-target','supply':self.supply,'fetch':self.fetch,'timeout':4,**changes}
            with self.subTest(changes=changes),patch('runtime_url_intake.Preparation'),self.assertRaises(ValueError):Intake(**args)

    def interrupt_before_preparation(self):
        with self.runtime.owner():
            self.start()
            with patch.object(module.Preparation,'resume',side_effect=OSError('Synthetic interrupted preparation')):
                with self.assertRaisesRegex(OSError,'Synthetic interrupted preparation'):self.intake.resume(self.request['requestId'])
        self.assertTrue((self.root/'sources.json').exists())
        self.assertFalse(self.fixture.folder.exists())

    def mapping(self):
        entry=self.runtime.journal.get(self.request['requestId']);settings,context=self.intake._settings(entry,self.spec)
        plan_hash=hashlib.sha256((self.root/'plan.json').read_bytes()).hexdigest()
        return self.read(self.root/'sources.json'),(plan_hash,entry,settings,context)

    def test_partial_source_records_require_original_settings_plan(self):
        fetch=self.intake.fetch
        def partial(url,output,remaining,deadline):
            if url.endswith('b.jpg'):output.write(b'x');raise OSError('Partial source boundary')
            return fetch(url,output,remaining,deadline)
        self.intake.fetch=partial
        with self.runtime.owner():
            self.start()
            with self.assertRaisesRegex(OSError,'Partial source boundary'):self.intake.resume(self.request['requestId'])
        path=self.root/'plan.json';raw=path.read_bytes();path.unlink()
        self.intake.supply=lambda entry:(_ for _ in ()).throw(AssertionError('Partial source records resupplied missing settings'))
        try:
            with self.runtime.owner(),self.assertRaisesRegex(ValueError,'records require their original plan'):self.intake.resume(self.request['requestId'])
        finally:self.restore(path,raw)

    def test_missing_started_source_installation_never_refetches(self):
        with self.runtime.owner():
            self.start()
            with patch('runtime_url_intake.publish',side_effect=lambda root,name,raw:module.json_bytes(None) if name!='plan.json' else self.stop_after_plan(root,name,raw)):
                with self.assertRaisesRegex(OSError,'Saved settings boundary'):self.intake.resume(self.request['requestId'])
        held=self.fixture.base/'held-source';self.source_root.rename(held)
        try:
            with self.runtime.owner(),patch('runtime_url_intake.UrlSources',side_effect=AssertionError('Missing started installation recreated')):
                with self.assertRaisesRegex(ValueError,'requires its original source installation'):self.intake.resume(self.request['requestId'])
        finally:held.rename(self.source_root)

    @staticmethod
    def stop_after_plan(root,name,raw):
        from retained_source import publish
        publish(root,name,raw);raise OSError('Saved settings boundary')

    def test_original_mapping_precedes_preparation(self):
        original=module.Preparation.resume
        def inspect(preparer,request_id):
            self.assertTrue((self.root/'sources.json').exists(),'Original URL source mapping must precede preparation')
            mapping,args=self.mapping();self.intake._mapping(mapping,*args)
            return original(preparer,request_id)
        with patch.object(module.Preparation,'resume',inspect):self.resume()

    def test_completed_source_manifest_hash_checked_before_mapping(self):
        prepare=module.UrlSources.prepare
        def wrong(source,request_id,job):
            result=prepare(source,request_id,job);return {**result,'manifestSha256':'a'*64}
        with self.runtime.owner():
            self.start()
            with patch.object(module.UrlSources,'prepare',wrong),patch.object(self.intake,'_mapping',side_effect=AssertionError('Changed completed source hash reached mapping')):
                with self.assertRaisesRegex(ValueError,'^Completed URL source manifest hash differs$'):self.intake.resume(self.request['requestId'])

    def test_mapped_recovery_uses_original_bytes_without_supplier_or_fetch(self):
        self.interrupt_before_preparation();mapping=(self.root/'sources.json').read_bytes()
        self.intake.supply=lambda entry:(_ for _ in ()).throw(AssertionError('Mapped recovery resupplied'))
        self.intake.fetch=lambda *args:(_ for _ in ()).throw(AssertionError('Mapped recovery refetched'))
        with self.runtime.owner():result=self.intake.resume(self.request['requestId'])
        self.assertEqual((self.root/'sources.json').read_bytes(),mapping)
        self.assertEqual(self.read(self.fixture.folder/'engine/plan.json')['engine'],self.spec['engine'])
        self.assertIs(result['engineTransportPermission'],False)

    def test_completed_retained_bytes_replay_without_download_root(self):
        first=self.resume();held=self.fixture.base/'held-source';self.source_root.rename(held)
        self.intake.fetch=lambda *args:(_ for _ in ()).throw(AssertionError('Completed retained replay refetched missing source root'))
        self.intake.supply=lambda *args:(_ for _ in ()).throw(AssertionError('Completed retained replay resupplied'))
        try:
            with self.runtime.owner(),patch('runtime_url_intake.UrlSources',side_effect=AssertionError('Completed replay recreated source installation')):
                self.assertEqual(self.intake.resume(self.request['requestId']),first)
            self.assertFalse(self.source_root.exists(),'Complete recovery must not recreate a missing source root')
        finally:held.rename(self.source_root)

    def test_missing_mapping_after_preparation_refuses_before_source(self):
        self.resume();path=self.root/'sources.json';raw=path.read_bytes();path.unlink()
        try:
            with self.runtime.owner(),patch('runtime_url_intake.UrlSources',side_effect=AssertionError('Missing prepared mapping accessed source')):
                with self.assertRaisesRegex(ValueError,'requires its original source mapping'):self.intake.resume(self.request['requestId'])
        finally:self.restore(path,raw)

    def test_mapped_bytes_unavailable_never_refetch(self):
        self.interrupt_before_preparation();held=self.fixture.base/'held-source';self.source_root.rename(held)
        self.intake.fetch=lambda *args:(_ for _ in ()).throw(AssertionError('Unavailable mapped bytes refetched'))
        try:
            with self.runtime.owner(),patch.object(module.Preparation,'resume',side_effect=AssertionError('Unavailable mapped bytes reached preparation')):
                with self.assertRaises(FileNotFoundError):self.intake.resume(self.request['requestId'])
        finally:held.rename(self.source_root)

    def test_mapping_wrapper_shape_version_and_settings_hash(self):
        self.interrupt_before_preparation();mapping,args=self.mapping()
        for value in ([],{**mapping,'extra':True},{**mapping,'format':'changed'},{**mapping,'intakePlanSha256':'a'*64}):
            with self.subTest(value=value),self.assertRaisesRegex(ValueError,'^Original runtime URL source mapping differs$'):self.intake._mapping(value,*args)

    def test_mapping_manifest_shape_flags_count_and_whole_byte_limit(self):
        self.interrupt_before_preparation();mapping,args=self.mapping();original=mapping['manifest']
        variants=[[],{**original,'extra':True},{**original,'format':'changed'},{**original,'planSha256':'x'},
            {**original,'sources':[]},{**original,'totalBytes':True},{**original,'totalBytes':-1},
            {**original,'totalBytes':4097},{**original,'localSourceBytesComplete':False},
            {**original,'authorityVerification':'accepted'},{**original,'engineTransportPermission':True}]
        for value in variants:
            with self.subTest(value=value),self.assertRaisesRegex(ValueError,'^Original runtime URL source manifest differs$'):self.intake._mapping({**mapping,'manifest':value},*args)

    def test_mapping_source_plan_hash_binds_original_context_and_metadata(self):
        self.interrupt_before_preparation();mapping,args=self.mapping();mapping['manifest']['planSha256']='a'*64
        for row in mapping['manifest']['sources']:row['planSha256']='a'*64
        with self.assertRaisesRegex(ValueError,'^Original mapped URL source plan differs$'):self.intake._mapping(mapping,*args)

    def test_mapping_slot_shape_paths_hashes_and_order(self):
        self.interrupt_before_preparation();mapping,args=self.mapping();row=mapping['manifest']['sources'][0]
        variants=[[],{**row,'extra':True},{**row,'format':'changed'},{**row,'planSha256':'a'*64},{**row,'slot':True},
            {**row,'slot':1},{**row,'objectRelativePath':'../outside.bin'},{**row,'objectRelativePath':'objects/source-00001-'+'a'*32+'.bin'},
            {**row,'bytes':True},{**row,'bytes':-1},{**row,'sha256':'x'}]
        for value in variants:
            changed=copy.deepcopy(mapping);changed['manifest']['sources'][0]=value
            with self.subTest(value=value),self.assertRaisesRegex(ValueError,'^Original runtime URL source slot differs$'):self.intake._mapping(changed,*args)

    def test_mapping_slot_original_declarations_stay_required(self):
        self.interrupt_before_preparation();mapping,args=self.mapping()
        for key,value in (('bytes',0),('sha256','a'*64)):
            changed=copy.deepcopy(mapping);changed['manifest']['sources'][0][key]=value
            changed['manifest']['totalBytes']=sum(row['bytes'] for row in changed['manifest']['sources'])
            with self.subTest(key=key),self.assertRaisesRegex(ValueError,'^URL source bytes differ from original declarations$'):self.intake._mapping(changed,*args)

    def test_mapping_total_must_equal_actual_slot_sum(self):
        self.interrupt_before_preparation();mapping,args=self.mapping();mapping['manifest']['totalBytes']+=1
        with self.assertRaisesRegex(ValueError,'^Original runtime URL source total differs$'):self.intake._mapping(mapping,*args)

    def test_changed_mapped_bytes_refuse_before_preparation(self):
        self.interrupt_before_preparation();mapping,args=self.mapping();row=mapping['manifest']['sources'][0]
        path=self.source_root/('request-'+hashlib.sha256(self.request['requestId'].encode()).hexdigest())/row['objectRelativePath'];raw=path.read_bytes()
        self.restore(path,b'x'*len(raw))
        try:
            with self.runtime.owner(),patch.object(module.Preparation,'resume',side_effect=AssertionError('Changed mapped bytes reached preparation')):
                with self.assertRaisesRegex(ValueError,'^Original mapped URL source bytes differ$'):self.intake.resume(self.request['requestId'])
        finally:self.restore(path,raw)

    def test_mapping_without_original_declarations_still_checks_saved_byte_hash(self):
        request=copy.deepcopy(self.request);request['requestId']='synthetic-undeclared-source'
        for photo in request['imagery']['photos']:photo.pop('checksumSha256');photo.pop('sizeBytes')
        self.request=request;self.fixture.request=request;self.fixture.entry,_=self.runtime.submit(request)
        self.spec['applicationJob']['request_id']=request['requestId'];self.root=self.folder(self.runtime.root,request['requestId'])
        self.fixture.folder=self.runtime.root/('preparation-'+hashlib.sha256(request['requestId'].encode()).hexdigest())
        self.interrupt_before_preparation();mapping,args=self.mapping();row=mapping['manifest']['sources'][0]
        path=self.source_root/('request-'+hashlib.sha256(request['requestId'].encode()).hexdigest())/row['objectRelativePath'];raw=path.read_bytes();self.restore(path,b'x'*len(raw))
        try:
            with self.runtime.owner(),patch.object(module.Preparation,'resume',side_effect=AssertionError('Undeclared changed bytes reached preparation')):
                with self.assertRaisesRegex(ValueError,'^Original mapped URL source bytes differ$'):self.intake.resume(request['requestId'])
        finally:self.restore(path,raw)

    def test_cancellation_after_mapping_refuses_before_preparation(self):
        publish=module.publish
        def cancel(root,name,raw):
            result=publish(root,name,raw)
            if name=='sources.json':self.intake.cancelled=lambda:True
            return result
        with self.runtime.owner():
            self.start()
            with patch('runtime_url_intake.publish',side_effect=cancel),patch.object(module.Preparation,'resume',side_effect=AssertionError('Cancelled mapping reached preparation')):
                with self.assertRaisesRegex(InterruptedError,'^Original runtime URL intake cancelled$'):self.intake.resume(self.request['requestId'])

    def test_late_intake_publication_cannot_report_success(self):
        publish=module.publish
        def cancel(root,name,raw):
            result=publish(root,name,raw)
            if name=='prepared.json':self.intake.cancelled=lambda:True
            return result
        with self.runtime.owner():
            self.start()
            with patch('runtime_url_intake.publish',side_effect=cancel),self.assertRaisesRegex(InterruptedError,'^Original runtime URL intake cancelled$'):
                self.intake.resume(self.request['requestId'])

    def test_owner_required_before_supplier_or_fetch(self):
        with self.runtime.owner():self.start()
        self.intake.supply=lambda entry:(_ for _ in ()).throw(AssertionError('Unowned intake reached supplier'))
        with self.assertRaisesRegex(ValueError,'requires its lifetime owner'):self.intake.resume(self.request['requestId'])
        self.assertEqual(self.supplied,[]);self.assertEqual(self.calls,[])

    def test_original_started_admission_required(self):
        self.intake.supply=lambda entry:(_ for _ in ()).throw(AssertionError('Unstarted intake reached supplier'))
        with self.runtime.owner(),self.assertRaisesRegex(ValueError,'Original owned start'):self.intake.resume(self.request['requestId'])
        self.assertEqual(self.supplied,[])

    def test_settings_shape_and_original_target_refuse_before_fetch(self):
        for changes in ({'targetId':'changed'},{'extra':True},{'maxBytes':0},{'applicationJob':{**self.spec['applicationJob'],'created_by':None}},
            {'applicationJob':{**self.spec['applicationJob'],'workspace_id':'changed'}},{'options':[{'name':'x','value':float('nan')}]},{'filenames':['one.jpg']}):
            with self.subTest(changes=changes),self.runtime.owner():
                self.start();self.intake.supply=lambda entry:{**self.spec,**changes}
                if 'extra' in changes or 'targetId' in changes:
                    with patch.object(module.Preparation,'_spec',side_effect=AssertionError('Invalid intake settings reached validator')):
                        with self.assertRaises(ValueError):self.intake.resume(self.request['requestId'])
                else:
                    with self.assertRaises(ValueError):self.intake.resume(self.request['requestId'])
                self.assertEqual(self.calls,[],'Invalid settings cannot fetch')
                self.assertFalse((self.root/'plan.json').exists(),'Invalid settings cannot publish a plan')

    def test_missing_saved_plan_with_prepared_record_cannot_resupply(self):
        self.resume();path=self.root/'plan.json';raw=path.read_bytes();path.unlink()
        self.intake.supply=lambda entry:(_ for _ in ()).throw(AssertionError('Missing plan resupplied'))
        try:
            with self.runtime.owner(),self.assertRaisesRegex(ValueError,'records require their original plan'):self.intake.resume(self.request['requestId'])
        finally:self.restore(path,raw)

    def test_saved_plan_format_and_fields_refuse_before_publication(self):
        self.resume();path=self.root/'plan.json';raw=path.read_bytes();original=json.loads(raw)
        variants=[[],{**original,'format':'changed'},{**original,'extra':True}]
        try:
            for value in variants:
                self.restore(path,module.json_bytes(value))
                with self.subTest(value_type=type(value).__name__),self.runtime.owner(),patch('runtime_url_intake.publish',side_effect=AssertionError('Malformed saved settings reached publication')):
                    with self.assertRaises(ValueError):self.intake.resume(self.request['requestId'])
        finally:self.restore(path,raw)

    def test_saved_plan_original_binding_refuses_before_mapping(self):
        self.resume();path=self.root/'plan.json';raw=path.read_bytes();original=json.loads(raw);variants=[]
        changed=copy.deepcopy(original);changed['binding']['request']['missionTitle']='changed';variants.append(changed)
        changed=copy.deepcopy(original);changed['binding']['originalContext']['originalActorId']='changed';variants.append(changed)
        try:
            for value in variants:
                self.restore(path,module.json_bytes(value))
                with self.runtime.owner(),patch.object(self.intake,'_mapping',side_effect=AssertionError('Changed original binding reached mapping')):
                    with self.assertRaises(ValueError):self.intake.resume(self.request['requestId'])
        finally:self.restore(path,raw)

    def test_pre_cancelled_and_implicit_cancellation_refuse(self):
        for value,kind in ((True,InterruptedError),('no',ValueError)):
            self.supplied.clear();self.calls.clear()
            self.intake.cancelled=lambda:value
            with self.subTest(value=value),self.runtime.owner():
                self.start()
                with self.assertRaises(kind):self.intake.resume(self.request['requestId'])
                self.assertEqual(self.supplied,[]);self.assertEqual(self.calls,[])

    def test_shared_deadline_clamps_nested_fetch_deadline(self):
        original=module.UrlSources;seen=[];shared=[];original_check=self.intake._check
        def check(request_id,deadline):shared.append(deadline);return original_check(request_id,deadline)
        def source(*args,**kwargs):
            time.sleep(.03);result=original(*args,**kwargs);fetch=result.fetch
            result.fetch=lambda url,output,remaining,deadline:fetch(url,output,remaining,deadline+.1)
            return result
        def fetch(url,output,remaining,deadline):seen.append(deadline);return self.fetch(url,output,remaining,deadline)
        self.intake.fetch=fetch
        with patch('runtime_url_intake.UrlSources',side_effect=source),patch.object(self.intake,'_check',side_effect=check):self.resume()
        self.assertTrue(shared,'Intake must expose its actual shared deadline');self.assertTrue(seen)
        self.assertLessEqual(max(seen),shared[0],'Nested fetch cannot extend the original intake deadline')

    def test_expired_plan_publication_refuses_before_source_creation(self):
        publish=module.publish;self.intake.timeout=.03
        def slow(root,name,raw):result=publish(root,name,raw);time.sleep(.05);return result
        with self.runtime.owner(),patch.object(module.UrlSources,'prepare',side_effect=AssertionError('Expired settings reached source intake')):
            self.start()
            with patch('runtime_url_intake.publish',side_effect=slow),self.assertRaisesRegex(TimeoutError,'Original runtime URL intake deadline exceeded'):
                self.intake.resume(self.request['requestId'])
        self.assertEqual(self.calls,[])
        self.assertFalse((self.source_root/('request-'+hashlib.sha256(self.request['requestId'].encode()).hexdigest())).exists(),'Expired plan cannot start source byte intake')

    def test_late_fetch_and_cancellation_keep_plan_without_preparation(self):
        fetch=self.intake.fetch
        def late(url,output,remaining,deadline):
            result=fetch(url,output,remaining,deadline);self.intake.cancelled=lambda:True;return result
        self.intake.fetch=late
        with self.runtime.owner():
            self.start()
            with self.assertRaisesRegex(InterruptedError,'Original runtime URL intake cancelled'):self.intake.resume(self.request['requestId'])
        self.assertTrue((self.root/'plan.json').exists());self.assertFalse(self.fixture.folder.exists(),'Cancelled intake cannot prepare an engine task')

    def test_cancellation_after_preparation_refuses_intake_completion(self):
        preparation=module.Preparation.resume
        def cancelled(preparer,request_id):
            result=preparation(preparer,request_id);self.intake.cancelled=lambda:True;return result
        with self.runtime.owner():
            self.start()
            with patch.object(module.Preparation,'resume',cancelled),self.assertRaisesRegex(InterruptedError,'Original runtime URL intake cancelled'):
                self.intake.resume(self.request['requestId'])
        self.assertFalse((self.root/'prepared.json').exists(),'Cancelled preparation cannot publish intake completion')
        self.assertTrue((self.fixture.folder/'prepared.json').exists(),'Previously retained local preparation stays available')

    def test_pipeline_identity_rejects_changed_reference_request_or_admission(self):
        job={'request':copy.deepcopy(self.request),'job_reference':self.fixture.entry.job_reference,'accepted_callback':copy.deepcopy(self.fixture.entry.admission),'state':'accepted'}
        for key in ('request','job_reference','accepted_callback'):
            changed=copy.deepcopy(job)
            if key=='job_reference':changed[key]='changed'
            elif key=='request':changed[key]['missionTitle']='changed'
            else:changed[key]['jobReference']='changed'
            with self.subTest(key=key),self.runtime.owner():
                self.start()
                with self.assertRaisesRegex(ValueError,'Pipeline URL intake identity differs'):self.intake(changed)
                self.assertEqual(self.supplied,[]);self.assertEqual(self.calls,[])

    def test_zip_source_and_derived_slots_keep_original_settings(self):
        archive=self.fixture.base/'input.zip'
        with zipfile.ZipFile(archive,'w') as zipped:
            for name,raw in zip(('a.jpg','b.jpg'),self.raw):zipped.writestr(name,raw)
        raw=archive.read_bytes();request=copy.deepcopy(self.request);request['requestId']='synthetic-runtime-url-zip';request['schemaVersion']='natford-aerial-processing.v1'
        request['imagery']={'type':'zip_url','url':'http://127.0.0.1:1/input.zip','imageCount':2,'sizeBytes':len(raw)}
        entry,_=self.runtime.submit(request);spec=copy.deepcopy(self.spec);spec['applicationJob'].update(request_id=request['requestId'],imagery_type='zip_url')
        spec.update(filenames=None,zipLimits={'max_expanded_bytes':4096,'max_entries':10,'max_directory_bytes':4096})
        calls=[]
        def fetch(url,output,remaining,deadline):calls.append(url);output.write(raw);return len(raw)
        intake=Intake(self.runtime,self.source_root,'synthetic-local-target',lambda entry:spec,fetch,timeout=4)
        with self.runtime.owner():
            self.runtime.journal.start(request['requestId'],entry.job_reference,self.runtime.context);result=intake.resume(request['requestId'])
        folder=self.fixture.folder.parent/('preparation-'+hashlib.sha256(request['requestId'].encode()).hexdigest())
        engine=self.read(folder/'engine/plan.json')
        self.assertEqual(len(calls),1,'ZIP intake must consume only one original archive')
        self.assertEqual(len(engine['uploads']),2,'Original ZIP must produce its complete derived image slots')
        self.assertEqual([row['sha256'] for row in engine['uploads']],[hashlib.sha256(row).hexdigest() for row in self.raw])
        self.assertIs(result['engineTransportPermission'],False)


if __name__=='__main__':unittest.main()
