"""Actual owned runtime and private input preparation, without transport."""
import copy
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

import retained_source
import runtime_preparation as module
from runtime_admission import Runtime
from retained_source import json_bytes


class Checks(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='odm-runtime-preparation-')
        self.base = Path(self.temporary.name)
        self.root = self.base/'runtime';self.root.mkdir(mode=0o700)
        self.input = self.base/'input';self.input.mkdir(mode=0o700)
        self.raw = [b'Synthetic original A', b'Synthetic original B']
        for name, raw in zip(('a.jpg', 'b.jpg'), self.raw):
            path = self.input/name;path.write_bytes(raw);path.chmod(0o600)
        self.request = {'schemaVersion':'natford-aerial-processing.v1.1',
            'requestId':'synthetic-original-request', 'callbackUrl':'http://127.0.0.1:1/never',
            'externalRef':{'system':'openplan','workspaceId':'synthetic-workspace','missionId':'synthetic-mission'},
            'missionTitle':'Original synthetic mission', 'presetId':'balanced',
            'imagery':{'type':'photo_manifest','imageCount':2,'photos':[
                {'url':'http://127.0.0.1:1/'+name,'filename':name,'sizeBytes':len(raw),
                 'checksumSha256':hashlib.sha256(raw).hexdigest()} for name,raw in zip(('a.jpg','b.jpg'),self.raw)]}}
        self.spec = {'applicationJob':{'id':'synthetic-application-job','request_id':self.request['requestId'],
            'workspace_id':'synthetic-workspace','mission_id':'synthetic-mission','created_by':'synthetic-original-actor',
            'preset_id':'balanced','imagery_type':'photo_manifest'},'targetId':'synthetic-local-target',
            'sourceRoot':self.input,'sources':['a.jpg','b.jpg'],'maxBytes':4096,
            'engine':{'instanceId':'synthetic-engine','endpoint':'http://127.0.0.1:1',
                'api':'nodeodm-2.2.4-draft','version':'2.2.4','imageId':'sha256:'+'a'*64,
                'configurationSha256':'b'*64,'credentialReference':'synthetic-no-secret'},
            'options':[{'name':'synthetic-flag','value':True}],
            'filenames':['image-a.jpg','image-b.jpg'],'zipLimits':None}
        self.runtime = Runtime(self.root,'synthetic-installation',max_queued=2,pipeline=lambda job:None)
        self.preparation = module.Preparation(self.runtime,lambda entry:self.spec,timeout=4)
        self.runtime.pipeline = self.preparation
        self.entry,_ = self.runtime.submit(self.request)
        self.folder = self.root/('preparation-'+hashlib.sha256(self.request['requestId'].encode()).hexdigest())

    def tearDown(self): self.temporary.cleanup()

    def start(self):
        return self.runtime.journal.start(self.request['requestId'],self.entry.job_reference,self.runtime.context)[0]

    def read(self,name):return json.loads((self.folder/name).read_bytes())

    def test_actual_owned_runtime_prepares_once_and_holds_next_job(self):
        second=copy.deepcopy(self.request);second['requestId']='synthetic-second-request'
        self.runtime.submit(second)
        with self.runtime.owner():
            self.assertIs(self.runtime.run_one(),True)
            self.assertIs(self.runtime.run_one(),False,'prepared start must hold the next queued request')
            self.assertEqual(self.runtime.status()['accepted'],1)
            self.assertEqual(self.runtime.status()['heldStarted'],1)
        plan=self.read('engine/plan.json');record=self.read('prepared.json')
        self.assertEqual(plan['binding']['originalRequest'],self.request,'engine plan must bind original runtime request')
        self.assertEqual(plan['binding']['originalAdmission'],self.entry.admission)
        self.assertEqual(plan['binding']['originalContext']['originalActorId'],'synthetic-original-actor','actor must come from supplied application record')
        for i,raw in enumerate(self.raw):self.assertEqual((self.folder/f'retained/objects/source-{i:05d}.bin').read_bytes(),raw)
        self.assertFalse(record['engineTransportPermission'],'local preparation cannot permit engine transport')
        self.assertEqual(record['enginePlanSha256'],hashlib.sha256((self.folder/'engine/plan.json').read_bytes()).hexdigest())
        for name in ('authorityVerification','engineCustodyVerification','callbackDeliveryVerification'):
            self.assertEqual(record[name],'unassessed','preparation cannot promote '+name)
        self.assertEqual(sorted(p.name for p in (self.folder/'engine').iterdir()),['plan.json','writer.lock'],'preparation cannot issue engine commands')

    def test_owner_required_before_journal_or_source_access(self):
        with patch.object(self.runtime.journal,'get',side_effect=AssertionError('Unowned preparation accessed journal')):
            with self.assertRaisesRegex(ValueError,'^Runtime preparation requires its lifetime owner$'):self.preparation.resume(self.request['requestId'])

    def test_accepted_or_other_installation_start_cannot_prepare(self):
        with self.runtime.owner():
            with patch.object(self.preparation,'supply',side_effect=AssertionError('Unstarted preparation accessed supplier')):
                with self.assertRaisesRegex(ValueError,'^Original owned start is required before preparation$'):self.preparation.resume(self.request['requestId'])
            self.runtime.journal.start(self.request['requestId'],self.entry.job_reference,{'installationId':'another'})
            with patch.object(self.preparation,'supply',side_effect=AssertionError('Unstarted preparation accessed supplier')):
                with self.assertRaisesRegex(ValueError,'^Original owned start is required before preparation$'):self.preparation.resume(self.request['requestId'])
        self.assertFalse(self.folder.exists(),'unbound start cannot create preparation records')

    def test_missing_actor_or_incomplete_original_row_refuses_before_source(self):
        with self.runtime.owner():
            self.start()
            for row in ({**self.spec['applicationJob'],'created_by':None},{**self.spec['applicationJob'],'extra':True}):
                self.spec['applicationJob']=row
                with patch.object(module,'prepare',side_effect=AssertionError('Missing actor accessed source')),patch.object(module,'publish',side_effect=AssertionError('Missing actor accessed source')):
                    with self.assertRaisesRegex(ValueError,'^Original application job and actor are required$'):self.preparation.resume(self.request['requestId'])

    def test_original_application_scope_refuses_before_source(self):
        original=copy.deepcopy(self.spec['applicationJob'])
        with self.runtime.owner():
            self.start()
            for field in ('request_id','workspace_id','mission_id','preset_id','imagery_type'):
                self.spec['applicationJob']={**original,field:'another'}
                with self.subTest(field=field),patch.object(module,'prepare',side_effect=AssertionError('Changed scope accessed source')),patch.object(module,'publish',side_effect=AssertionError('Changed scope accessed source')):
                    with self.assertRaisesRegex(ValueError,'^Original application job scope differs$'):self.preparation.resume(self.request['requestId'])

    def test_exact_supplier_shape_and_detached_entry(self):
        def supplier(entry):
            entry.request['missionTitle']='Changed supplier alias'
            return self.spec
        self.preparation.supply=supplier
        with self.runtime.owner():
            self.start();self.preparation.resume(self.request['requestId'])
            self.assertEqual(self.read('plan.json')['request'],self.request,'supplier must not replace original entry through alias')
            self.spec['unexpected']=True
            with self.assertRaisesRegex(ValueError,'^Exact original runtime preparation inputs are required$'):self.preparation.resume(self.request['requestId'])

    def test_invalid_constructor_refuses_without_source(self):
        for runtime,supply,timeout in ((None,lambda entry:{},1),(self.runtime,None,1),(self.runtime,lambda entry:{},True),(self.runtime,lambda entry:{},0),(self.runtime,lambda entry:{},float('nan'))):
            with self.subTest(timeout=timeout),self.assertRaises(ValueError):module.Preparation(runtime,supply,timeout=timeout)

    def test_source_mapping_and_count_refuse_before_retention(self):
        with self.runtime.owner():
            self.start()
            for names in (['../a.jpg','b.jpg'],['a.jpg','a.jpg'],['a.jpg'],[[], 'b.jpg']):
                self.spec['sources']=names
                with self.subTest(names=names),patch.object(module,'prepare',side_effect=AssertionError('Invalid source mapping accessed retention')),patch.object(module,'publish',side_effect=AssertionError('Invalid source mapping accessed retention')):
                    with self.assertRaises(ValueError):self.preparation.resume(self.request['requestId'])

    def test_limits_options_and_photo_filenames_refuse_before_retention(self):
        original=copy.deepcopy(self.spec)
        variants=[('maxBytes',True),('options',[{'name':'flag','value':float('inf')}]),('options',[{'name':'flag','value':1},{'name':'flag','value':2}]),('filenames',['../a.jpg','b.jpg']),('filenames',['a.jpg','a.jpg']),('zipLimits',{})]
        with self.runtime.owner():
            self.start()
            for key,value in variants:
                self.spec={**original,key:value}
                with self.subTest(key=key),patch.object(module,'prepare',side_effect=AssertionError('Invalid settings accessed retention')),patch.object(module,'publish',side_effect=AssertionError('Invalid settings accessed retention')):
                    with self.assertRaises(ValueError):self.preparation.resume(self.request['requestId'])

    def test_input_root_overlap_refuses_before_retention(self):
        with self.runtime.owner():
            self.start()
            for root in (self.root,self.base,self.root/'inside'):
                self.spec['sourceRoot']=root
                with self.subTest(root=root),patch.object(module,'prepare',side_effect=AssertionError('Overlapping input accessed retention')),patch.object(module,'publish',side_effect=AssertionError('Overlapping input accessed retention')):
                    with self.assertRaisesRegex(ValueError,'^Runtime input and retained roots must not overlap$'):self.preparation.resume(self.request['requestId'])

    def test_original_uuid_and_identity_survive_repeat_preparation(self):
        with self.runtime.owner():
            self.start();first=self.preparation.resume(self.request['requestId']);snapshot=self.read('plan.json')
            with patch.object(module.uuid,'uuid4',side_effect=AssertionError('Original task UUID regenerated')):
                second=self.preparation.resume(self.request['requestId'])
            self.assertEqual(first,second,'original prepared receipt must replay exactly')
            self.assertEqual(snapshot,self.read('plan.json'))

    def test_actor_target_engine_options_and_limits_cannot_rebind_saved_plan(self):
        original=copy.deepcopy(self.spec)
        with self.runtime.owner():
            self.start();self.preparation.resume(self.request['requestId'])
            variants=[{'applicationJob':{**original['applicationJob'],'created_by':'another'}},
                      {'targetId':'another'},{'engine':{**original['engine'],'instanceId':'another'}},
                      {'options':[]},{'maxBytes':8192},{'filenames':['other-a.jpg','other-b.jpg']}]
            for change in variants:
                self.spec={**original,**change}
                with self.subTest(change=change),patch.object(module,'prepare',side_effect=AssertionError('Changed original plan accessed source')):
                    with self.assertRaisesRegex(ValueError,'^Existing source custody record differs$'):self.preparation.resume(self.request['requestId'])

    def test_changed_retained_bytes_refuse_and_restore(self):
        with self.runtime.owner():
            self.start();self.preparation.resume(self.request['requestId'])
            path=self.folder/'retained/objects/source-00000.bin';original=path.read_bytes()
            try:
                path.write_bytes(b'X'*len(original))
                with self.assertRaisesRegex(ValueError,'^Retained source slot differs$'):self.preparation.resume(self.request['requestId'])
            finally:path.write_bytes(original)
            self.preparation.resume(self.request['requestId'])

    def test_pipeline_job_identity_refuses_before_supplier(self):
        with self.runtime.owner():
            self.start()
            job={'request':copy.deepcopy(self.request),'job_reference':self.entry.job_reference,'accepted_callback':self.entry.admission}
            for change in ({'job_reference':'another'},{'request':{**self.request,'missionTitle':'another'}},{'accepted_callback':{**self.entry.admission,'callbackId':'another'}}):
                with self.subTest(change=change),patch.object(self.preparation,'supply',side_effect=AssertionError('Changed pipeline job accessed supplier')):
                    with self.assertRaisesRegex(ValueError,'^Pipeline preparation identity differs from original admission$'):self.preparation({**job,**change})

    def test_missing_preparation_plan_cannot_adopt_retained_records(self):
        with self.runtime.owner():
            self.start();self.preparation.resume(self.request['requestId'])
            path=self.folder/'plan.json';moved=self.base/'original-preparation-plan';path.rename(moved)
            try:
                with patch.object(module.uuid,'uuid4',side_effect=AssertionError('Missing plan regenerated task identity')):
                    with self.assertRaisesRegex(ValueError,'^Runtime preparation records require their original plan$'):self.preparation.resume(self.request['requestId'])
                self.assertFalse(path.exists(),'missing original plan cannot be regenerated')
            finally:
                if path.exists():path.rename(self.base/'unexpected-replacement-plan')
                moved.rename(path)

    def test_invalid_saved_task_refuses_before_retention_and_restores(self):
        with self.runtime.owner():
            self.start();self.preparation.resume(self.request['requestId'])
            path=self.folder/'plan.json';original=path.read_bytes();value=json.loads(original);value['taskUuid']='bad'
            try:
                path.write_bytes(json_bytes(value))
                with patch.object(module,'prepare',side_effect=AssertionError('Invalid saved task accessed retention')):
                    with self.assertRaisesRegex(ValueError,'^Original runtime preparation task identity differs$'):self.preparation.resume(self.request['requestId'])
            finally:path.write_bytes(original)

    def test_complete_copy_replays_with_missing_original_input(self):
        with self.runtime.owner():self.runtime.run_one();first=self.read('prepared.json')
        restored=self.base/'restored';shutil.copytree(self.root,restored)
        other=Runtime(restored,'synthetic-installation',max_queued=0,pipeline=lambda job:None)
        self.spec['sourceRoot']=self.base/'nonexistent-original-input'
        preparation=module.Preparation(other,lambda entry:self.spec,timeout=4)
        with other.owner():
            result=preparation.resume(self.request['requestId'])
            self.assertEqual(result,first,'relocation must preserve original task and exact prepared receipt')
            self.assertIs(other.run_one(),False,'copied prepared start must stay held')

    def test_interrupted_slot_resumes_from_original_plan_and_bytes(self):
        actual=retained_source.digest
        def interrupt(root,name,limit,deadline,output=None):
            if output is not None and name=='b.jpg':raise RuntimeError('Synthetic second-slot interruption')
            return actual(root,name,limit,deadline,output)
        prepare=module.prepare
        def verified_prepare(**arguments):
            self.assertTrue((self.folder/'plan.json').exists(),'Original preparation plan must precede source retention')
            return prepare(**arguments)
        with self.runtime.owner():
            self.start()
            with patch.object(module,'prepare',side_effect=verified_prepare),patch.object(retained_source,'digest',side_effect=interrupt),self.assertRaisesRegex(RuntimeError,'Synthetic second-slot interruption'):self.preparation.resume(self.request['requestId'])
            task=self.read('plan.json')['taskUuid']
            self.assertEqual((self.folder/'retained/objects/source-00000.bin').read_bytes(),self.raw[0])
            self.assertFalse((self.folder/'engine').exists(),'interrupted source cannot reach engine plan')
            result=self.preparation.resume(self.request['requestId'])
            self.assertEqual(result['taskUuid'],task,'interrupted preparation must retain original task UUID')

    def test_zip_pipeline_derives_original_slots_before_engine_plan(self):
        archive=self.input/'original.zip'
        with zipfile.ZipFile(archive,'w') as out:
            out.writestr('z/a.jpg',self.raw[1]);out.writestr('a/a.JPG',self.raw[0])
        archive.chmod(0o600)
        self.request['schemaVersion']='natford-aerial-processing.v1';self.request['requestId']='synthetic-zip-request';self.request['imagery']={'type':'zip_url','url':'http://127.0.0.1:1/never.zip'}
        self.spec['applicationJob'].update(request_id=self.request['requestId'],imagery_type='zip_url')
        self.spec.update(sources=['original.zip'],filenames=None,zipLimits={'max_expanded_bytes':4096,'max_entries':100,'max_directory_bytes':1048576})
        self.root=self.base/'zip-runtime';self.root.mkdir(mode=0o700)
        self.runtime=Runtime(self.root,'synthetic-installation',max_queued=1,pipeline=lambda job:None)
        self.preparation=module.Preparation(self.runtime,lambda entry:self.spec,timeout=4)
        self.runtime.pipeline=self.preparation
        self.entry,_=self.runtime.submit(self.request);self.folder=self.root/('preparation-'+hashlib.sha256(self.request['requestId'].encode()).hexdigest())
        with self.runtime.owner():
            self.assertIs(self.runtime.run_one(),True);record=self.read('prepared.json')
        plan=self.read('engine/plan.json')
        self.assertEqual(plan['format'],'openplan.odm-engine-zip-plan.v1','ZIP runtime must use original derived engine plan')
        self.assertEqual([r['archiveMember'] for r in plan['uploads']],['a/a.JPG','z/a.jpg'],'original ZIP members must keep ordered mapping')
        self.assertEqual([r['filename'] for r in plan['uploads']],['image-00000.jpg','image-00001.jpg'])
        self.assertEqual(record['taskUuid'],plan['taskUuid'])
        self.assertFalse(record['engineTransportPermission'])

    def test_zip_limits_refuse_before_source(self):
        request=copy.deepcopy(self.request);request['imagery']={'type':'zip_url','url':'http://127.0.0.1:1/never.zip'}
        entry=copy.deepcopy(self.entry);entry.request['imagery']=request['imagery'];self.spec['applicationJob']['imagery_type']='zip_url';self.spec['sources']=['original.zip']
        for filenames,limits in (([],{'max_expanded_bytes':1,'max_entries':1,'max_directory_bytes':1}),(None,{}),(None,{'max_expanded_bytes':True,'max_entries':1,'max_directory_bytes':1})):
            self.spec.update(filenames=filenames,zipLimits=limits)
            with self.subTest(limits=limits),self.assertRaises(ValueError):self.preparation._spec(entry)

    def test_changed_installation_refuses_before_supplier(self):
        with self.runtime.owner():
            self.start();path=self.root/'runtime-installation.json';original=path.read_bytes()
            value=json.loads(original);value['installationId']='another'
            try:
                path.write_bytes(json_bytes(value))
                with patch.object(self.preparation,'supply',side_effect=AssertionError('Changed installation accessed supplier')):
                    with self.assertRaisesRegex(ValueError,'^Saved ODM installation identity differs$'):self.preparation.resume(self.request['requestId'])
            finally:path.write_bytes(original)

    def test_invalid_engine_identity_refuses_before_retention(self):
        with self.runtime.owner():
            self.start();self.spec['engine']['version']='another'
            with patch.object(module,'prepare',side_effect=AssertionError('Invalid engine accessed retention')),patch.object(module,'publish',side_effect=AssertionError('Invalid engine accessed retention')):
                with self.assertRaisesRegex(ValueError,'^Engine protocol or immutable digest is unsupported$'):self.preparation.resume(self.request['requestId'])

    def test_timeout_before_source_retention_refuses(self):
        offset=[0];clock=SimpleNamespace(monotonic=lambda:time.monotonic()+offset[0]);publish=module.publish
        def delayed_publish(root,name,payload):
            publish(root,name,payload)
            if name=='plan.json':offset[0]=10
        with self.runtime.owner():
            self.start()
            with patch.object(module,'time',clock),patch.object(module,'publish',side_effect=delayed_publish),patch.object(module,'prepare',side_effect=AssertionError('Expired preparation accessed retention')):
                with self.assertRaisesRegex(TimeoutError,'^Runtime preparation deadline exceeded$'):self.preparation.resume(self.request['requestId'])

    def test_timeout_before_prepared_record_refuses_publication(self):
        offset=[0];clock=SimpleNamespace(monotonic=lambda:time.monotonic()+offset[0]);effects=module.Effects
        def delayed_effects(*args,**kwargs):
            result=effects(*args,**kwargs);offset[0]=10;return result
        with self.runtime.owner():
            self.start()
            with patch.object(module,'time',clock),patch.object(module,'Effects',side_effect=delayed_effects):
                with self.assertRaisesRegex(TimeoutError,'^Runtime preparation deadline exceeded$'):self.preparation.resume(self.request['requestId'])
            self.assertFalse((self.folder/'prepared.json').exists(),'expired preparation cannot publish a completed local record')

    def test_late_prepared_publication_never_reports_success(self):
        offset=[0];clock=SimpleNamespace(monotonic=lambda:time.monotonic()+offset[0]);publish=module.publish
        def delayed_publish(root,name,payload):
            publish(root,name,payload)
            if name=='prepared.json':offset[0]=10
        with self.runtime.owner():
            self.start()
            with patch.object(module,'time',clock),patch.object(module,'publish',side_effect=delayed_publish):
                with self.assertRaisesRegex(TimeoutError,'^Runtime preparation deadline exceeded$'):self.preparation.resume(self.request['requestId'])
            self.assertTrue((self.folder/'prepared.json').exists(),'late synchronized publication remains for explicit recovery')


if __name__=='__main__':unittest.main()
