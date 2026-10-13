"""Original private byte receipts with supplied transport, not live authority."""
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import time
import unittest
from unittest.mock import patch

import url_source_custody as module
from url_source_custody import CountedWriter, UrlSources
from retained_source import json_bytes
from runtime_admission import Runtime
import test_runtime_preparation as fixture


class Checks(unittest.TestCase):
    def setUp(self):
        self.fixture=fixture.Checks();self.fixture.setUp();self.runtime=self.fixture.runtime
        self.request=self.fixture.request;self.job=copy.deepcopy(self.fixture.spec['applicationJob'])
        self.raw=list(self.fixture.raw);self.calls=[]
        self.root=self.fixture.base/'url-sources'
        self.source=UrlSources(self.runtime,self.root,'synthetic-local-target',self.fetch,max_bytes=4096,timeout=4)
        self.pack=self.folder(self.request['requestId'])

    def tearDown(self):self.fixture.tearDown()

    def folder(self, request_id):return self.root/('request-'+hashlib.sha256(request_id.encode()).hexdigest())

    def fetch(self,url,output,remaining,deadline):
        self.calls.append(url);index=0 if url.endswith('a.jpg') else 1
        output.write(self.raw[index]);return len(self.raw[index])

    def start(self):return self.fixture.start()

    def unknown(self):
        request=copy.deepcopy(self.request);request['requestId']='synthetic-unknown-checksum'
        for row in request['imagery']['photos']:row.pop('checksumSha256',None);row.pop('sizeBytes',None)
        entry,_=self.runtime.submit(request);self.runtime.journal.start(request['requestId'],entry.job_reference,self.runtime.context)
        job={**self.job,'request_id':request['requestId'],'id':'synthetic-unknown-job'}
        return request,job,self.folder(request['requestId'])

    @staticmethod
    def read(root,name):return json.loads((root/name).read_bytes())

    @staticmethod
    def restore(path,payload):path.write_bytes(payload);path.chmod(0o600)

    def test_original_complete_receipts_bind_context_and_exact_bytes(self):
        with self.runtime.owner():
            self.start();result=self.source.prepare(self.request['requestId'],self.job)
        plan=self.read(self.pack,'plan.json');manifest=self.read(self.pack,'completed.json')
        self.assertEqual(plan['binding']['originalRequest'],self.request)
        self.assertEqual(plan['binding']['originalAdmission'],self.fixture.entry.admission)
        self.assertEqual(plan['binding']['originalApplicationJob'],self.job,'Original supplied application row must be retained')
        self.assertEqual(plan['binding']['originalContext']['originalActorId'],self.job['created_by'])
        self.assertEqual(manifest['totalBytes'],sum(map(len,self.raw)))
        for slot,name in enumerate(result['sources']):
            self.assertEqual((self.pack/name).read_bytes(),self.raw[slot],'Original complete bytes must survive')
            receipt=self.read(self.pack,f'source-{slot:05d}.complete.json')
            self.assertEqual(receipt['sha256'],hashlib.sha256(self.raw[slot]).hexdigest())
            self.assertEqual(receipt['planSha256'],hashlib.sha256(json_bytes(plan)).hexdigest())
            self.assertEqual(os.stat(self.pack/name).st_mode&0o777,0o600)
        self.assertIs(manifest['engineTransportPermission'],False,'Source receipt cannot permit engine transport')
        self.assertIs(result['engineTransportPermission'],False,'Source receipt cannot permit engine transport')
        self.assertEqual(result['authorityVerification'],'unassessed')
        self.assertFalse(self.fixture.folder.exists(),'URL byte intake cannot prepare an engine task')

    def test_complete_replay_never_fetches_changed_remote_bytes(self):
        with self.runtime.owner():
            self.start();first=self.source.prepare(self.request['requestId'],self.job)
            self.calls.clear();self.raw=[b'Changed remote A',b'Changed remote B']
            replay=self.source.prepare(self.request['requestId'],self.job)
        self.assertEqual(replay,first)
        self.assertEqual(self.calls,[],'Complete original bytes cannot refetch changed remote data')

    def test_runtime_owner_required_before_request_records_or_fetch(self):
        with self.runtime.owner():self.start()
        with self.assertRaisesRegex(ValueError,'URL source intake requires its lifetime runtime owner'):
            self.source.prepare(self.request['requestId'],self.job)
        self.assertFalse(self.pack.exists());self.assertEqual(self.calls,[])

    def test_original_started_context_required_before_fetch(self):
        with self.runtime.owner():
            with self.assertRaisesRegex(ValueError,'Original owned URL source start is required'):
                self.source.prepare(self.request['requestId'],self.job)
            self.runtime.journal.start(self.request['requestId'],self.fixture.entry.job_reference,{'installationId':'another-installation'})
            with self.assertRaisesRegex(ValueError,'Original owned URL source start is required'):
                self.source.prepare(self.request['requestId'],self.job)
        self.assertEqual(self.calls,[])

    def test_original_application_actor_and_scope_required_before_fetch(self):
        self.source.fetch=lambda *args:(_ for _ in ()).throw(AssertionError('Invalid application context reached fetch'))
        with self.runtime.owner():
            self.start()
            for change in ({'created_by':None},{'workspace_id':'another-workspace'},{'request_id':'another-request'}):
                with self.subTest(change=change),self.assertRaises(ValueError):
                    self.source.prepare(self.request['requestId'],{**self.job,**change})
        self.assertFalse(self.pack.exists())

    def test_constructor_requires_explicit_adapters_and_finite_configuration(self):
        for index,change in enumerate(({'runtime':None},{'fetch':None},{'cancelled':None},{'target_id':''},{'target_id':'x'*257},{'timeout':True},{'timeout':0},{'timeout':float('nan')},{'max_bytes':True},{'max_bytes':0})):
            arguments={'runtime':self.runtime,'root':self.fixture.base/f'constructor-{index:03d}','target_id':'synthetic-local-target','fetch':self.fetch,'max_bytes':4096,'timeout':4,'cancelled':lambda:False,**change}
            with self.subTest(change=change),self.assertRaises(ValueError):UrlSources(**arguments)

    def test_source_runtime_overlap_refuses_before_root_or_fetch(self):
        for root in (self.runtime.root,self.runtime.root/'inside',self.fixture.base):
            with self.subTest(root=root),self.assertRaisesRegex(ValueError,'URL source and runtime roots must not overlap'):
                UrlSources(self.runtime,root,'synthetic-local-target',self.fetch,max_bytes=4096)
        self.assertFalse((self.runtime.root/'inside').exists())

    def test_source_seal_cannot_rebind_target_or_installation(self):
        with self.assertRaisesRegex(ValueError,'Existing source custody record differs'):
            UrlSources(self.runtime,self.root,'another-target',self.fetch,max_bytes=4096)
        (self.fixture.base/'other-runtime').mkdir(mode=0o700)
        other=Runtime(self.fixture.base/'other-runtime','another-installation',max_queued=0,pipeline=lambda job:None)
        with self.assertRaisesRegex(ValueError,'Existing source custody record differs'):
            UrlSources(other,self.root,'synthetic-local-target',self.fetch,max_bytes=4096)

    def test_missing_source_seal_cannot_adopt_existing_records(self):
        with self.runtime.owner():self.start();self.source.prepare(self.request['requestId'],self.job)
        path=self.root/'source-installation.json';before=path.read_bytes()
        try:
            path.unlink()
            with self.assertRaisesRegex(ValueError,'URL source records require their original installation seal'):
                UrlSources(self.runtime,self.root,'synthetic-local-target',self.fetch,max_bytes=4096)
        finally:self.restore(path,before)

    def test_missing_request_plan_cannot_adopt_existing_bytes(self):
        with self.runtime.owner():
            self.start();self.source.prepare(self.request['requestId'],self.job)
            path=self.pack/'plan.json';before=path.read_bytes()
            try:
                path.unlink();self.source.fetch=lambda *args:(_ for _ in ()).throw(AssertionError('Missing original plan refetched'))
                with self.assertRaisesRegex(ValueError,'URL source records require their original plan'):
                    self.source.prepare(self.request['requestId'],self.job)
            finally:self.restore(path,before)

    def test_actor_budget_and_original_request_cannot_rebind_plan(self):
        with self.runtime.owner():
            self.start();self.source.prepare(self.request['requestId'],self.job)
            self.source.fetch=lambda *args:(_ for _ in ()).throw(AssertionError('Rebound source plan fetched'))
            with self.assertRaisesRegex(ValueError,'Existing source custody record differs'):
                self.source.prepare(self.request['requestId'],{**self.job,'created_by':'another-actor'})
            self.source.max_bytes=8192
            try:
                with self.assertRaisesRegex(ValueError,'Existing source custody record differs'):
                    self.source.prepare(self.request['requestId'],self.job)
            finally:self.source.max_bytes=4096
            changed=copy.deepcopy(self.runtime.journal.get(self.request['requestId']));changed.request['imagery']['photos'][0]['url']='http://127.0.0.1:1/changed.jpg'
            with patch.object(self.runtime.journal,'get',return_value=changed),self.assertRaisesRegex(ValueError,'Existing source custody record differs'):
                self.source.prepare(self.request['requestId'],self.job)

    def test_declared_whole_job_limit_precedes_fetch(self):
        self.source.max_bytes=sum(map(len,self.raw))-1
        self.source.fetch=lambda *args:(_ for _ in ()).throw(AssertionError('Oversized declared set fetched'))
        with self.runtime.owner():
            self.start()
            with self.assertRaisesRegex(ValueError,'Declared URL sources exceed the whole-job limit'):
                self.source.prepare(self.request['requestId'],self.job)
        self.assertFalse(self.pack.exists())

    def test_invalid_source_declarations_refuse_before_fetch(self):
        self.source.fetch=lambda *args:(_ for _ in ()).throw(AssertionError('Invalid source declaration reached fetch'))
        with self.runtime.owner():
            entry=self.start()
            for change in ({'sizeBytes':True},{'sizeBytes':-1},{'checksumSha256':'another'}):
                changed=copy.deepcopy(entry);changed.request['imagery']['photos'][0].update(change)
                with self.subTest(change=change),patch.object(self.runtime.journal,'get',return_value=changed),self.assertRaisesRegex(ValueError,'Original URL source declarations differ'):
                    self.source.prepare(self.request['requestId'],self.job)

    def test_downloaded_size_and_hash_must_match_original_declarations(self):
        with self.runtime.owner():
            self.start()
            for raw in (self.raw[0][:-1],b'X'*len(self.raw[0])):
                self.raw[0]=raw
                with self.subTest(raw=raw),self.assertRaisesRegex(ValueError,'URL source bytes differ from original declarations'):
                    self.source.prepare(self.request['requestId'],self.job)
            self.assertFalse((self.pack/'source-00000.complete.json').exists())

    def test_actual_whole_job_limit_refuses_before_excess_write(self):
        with self.runtime.owner():
            request,job,pack=self.unknown();self.source.max_bytes=sum(map(len,self.raw))-1
            with self.assertRaises(ValueError):self.source.prepare(request['requestId'],job)
        files=list((pack/'objects').glob('source-00001-*.bin'))
        self.assertEqual([p.stat().st_size for p in files],[0],'Budget must refuse before writing excess bytes')
        self.assertTrue((pack/'source-00000.complete.json').exists())
        self.assertFalse((pack/'completed.json').exists())

    def test_nonbyte_chunks_cannot_become_complete(self):
        with self.runtime.owner():
            self.start()
            for mode in ('bytearray','string'):
                def fetch(url,output,remaining,deadline):
                    raw=self.raw[0] if url.endswith('a.jpg') else self.raw[1]
                    output.write(bytearray(raw) if mode=='bytearray' else 'synthetic string');return len(raw)
                self.source.fetch=fetch
                with self.subTest(mode=mode),self.assertRaisesRegex(ValueError,'URL source write requires bytes'):
                    self.source.prepare(self.request['requestId'],self.job)
        self.assertFalse((self.pack/'source-00000.complete.json').exists())

    def test_fetch_count_requires_exact_delivered_integer(self):
        with self.runtime.owner():
            self.start()
            for value in (True,None,-1,999):
                def fetch(url,output,remaining,deadline):self.fetch(url,output,remaining,deadline);return value
                self.source.fetch=fetch
                with self.subTest(value=value),self.assertRaisesRegex(ValueError,'URL source fetch count differs from delivered bytes'):
                    self.source.prepare(self.request['requestId'],self.job)
        self.assertFalse((self.pack/'source-00000.complete.json').exists())

    def test_partial_local_write_cannot_report_complete(self):
        class Output:
            def write(self,chunk):return len(chunk)-1
        with self.assertRaisesRegex(OSError,'URL source object write did not finish'):
            CountedWriter(Output(),10,lambda:None).write(b'original')

    def test_expired_operation_refuses_before_writer_or_fetch(self):
        with self.runtime.owner():
            self.start();count=[0]
            def clock():count[0]+=1;return 10 if count[0]==1 else 100
            with patch('url_source_custody.time.monotonic',side_effect=clock),patch('url_source_custody.writer',side_effect=AssertionError('Expired source operation acquired a writer')):
                with self.assertRaisesRegex(TimeoutError,'Original URL source deadline exceeded'):
                    self.source.prepare(self.request['requestId'],self.job)
        self.assertEqual(self.calls,[])

    def test_pre_cancelled_operation_refuses_before_fetch(self):
        self.source.cancelled=lambda:True
        self.source.fetch=lambda *args:(_ for _ in ()).throw(AssertionError('Precancelled URL source fetched'))
        with self.runtime.owner():
            self.start()
            with self.assertRaisesRegex(InterruptedError,'Original URL source intake cancelled'):
                self.source.prepare(self.request['requestId'],self.job)
        self.assertFalse(self.pack.exists())

    def test_cancellation_during_delivery_refuses_before_source_write(self):
        def fetch(url,output,remaining,deadline):
            self.source.cancelled=lambda:True
            raw=self.raw[0] if url.endswith('a.jpg') else self.raw[1]
            output.write(raw);return len(raw)
        self.source.fetch=fetch
        with self.runtime.owner():
            self.start()
            with self.assertRaisesRegex(InterruptedError,'Original URL source intake cancelled'):
                self.source.prepare(self.request['requestId'],self.job)
        self.assertEqual([p.stat().st_size for p in (self.pack/'objects').glob('*.bin')],[0],'Cancelled delivery cannot write source bytes')
        self.assertFalse((self.pack/'source-00000.complete.json').exists())

    def test_cancellation_adapter_requires_boolean(self):
        with self.runtime.owner():
            self.start()
            for value in (0,1,None):
                self.source.cancelled=lambda:value
                with self.subTest(value=value),self.assertRaisesRegex(ValueError,'URL source cancellation must return a boolean'):
                    self.source.prepare(self.request['requestId'],self.job)

    def test_interrupted_second_source_reuses_first_complete_bytes(self):
        original=self.source.fetch
        def interrupted(url,*args):
            if url.endswith('b.jpg'):raise RuntimeError('Synthetic second-source interruption')
            return original(url,*args)
        self.source.fetch=interrupted
        with self.runtime.owner():
            self.start()
            with self.assertRaisesRegex(RuntimeError,'Synthetic second-source interruption'):
                self.source.prepare(self.request['requestId'],self.job)
            first=self.read(self.pack,'source-00000.complete.json');self.raw[0]=b'Changed remote A';self.calls.clear();self.source.fetch=original
            result=self.source.prepare(self.request['requestId'],self.job)
        self.assertEqual(self.calls,[self.request['imagery']['photos'][1]['url']],'Recovery must fetch only the missing original slot')
        self.assertEqual((self.pack/result['sources'][0]).read_bytes(),self.fixture.raw[0])
        self.assertEqual(self.read(self.pack,'source-00000.complete.json'),first)

    def test_orphan_object_is_not_a_complete_receipt(self):
        original=module.publish
        def omit(pack,name,payload):
            if name=='source-00000.complete.json':raise RuntimeError('Synthetic completion receipt interruption')
            return original(pack,name,payload)
        with self.runtime.owner():
            self.start()
            with patch('url_source_custody.publish',side_effect=omit),self.assertRaisesRegex(RuntimeError,'Synthetic completion receipt interruption'):
                self.source.prepare(self.request['requestId'],self.job)
            orphan=next((self.pack/'objects').glob('*.bin'));before=orphan.read_bytes();self.calls.clear()
            result=self.source.prepare(self.request['requestId'],self.job)
        self.assertEqual(len(self.calls),2,'An orphan filename cannot skip original source fetching')
        self.assertNotEqual(self.pack/result['sources'][0],orphan)
        self.assertEqual(orphan.read_bytes(),before,'Orphan bytes must remain unchanged')

    def test_missing_or_corrupt_complete_bytes_refuse_without_refetch(self):
        with self.runtime.owner():
            request,job,pack=self.unknown();result=self.source.prepare(request['requestId'],job)
            path=pack/result['sources'][0];before=path.read_bytes();self.source.fetch=lambda *args:(_ for _ in ()).throw(AssertionError('Lost complete bytes refetched'))
            try:
                path.unlink()
                with self.assertRaises(FileNotFoundError):self.source.prepare(request['requestId'],job)
                self.restore(path,b'X'*len(before))
                with self.assertRaisesRegex(ValueError,'Retained complete URL source bytes differ'):
                    self.source.prepare(request['requestId'],job)
            finally:self.restore(path,before)

    def test_missing_completed_receipt_cannot_fetch_again(self):
        with self.runtime.owner():
            self.start();self.source.prepare(self.request['requestId'],self.job)
            path=self.pack/'source-00000.complete.json';before=path.read_bytes()
            try:
                path.unlink();self.source.fetch=lambda *args:(_ for _ in ()).throw(AssertionError('Completed source data cannot refetch'))
                with self.assertRaisesRegex(ValueError,'Completed URL sources require every original receipt'):
                    self.source.prepare(self.request['requestId'],self.job)
            finally:self.restore(path,before)

    def test_complete_set_rebuild_uses_only_retained_receipts(self):
        with self.runtime.owner():
            self.start();first=self.source.prepare(self.request['requestId'],self.job)
            path=self.pack/'completed.json'
            self.assertTrue(path.exists(),'Completed source set must be durably published')
            before=path.read_bytes();path.unlink();self.calls.clear()
            replay=self.source.prepare(self.request['requestId'],self.job)
        self.assertTrue(path.exists(),'Completed source set must be durably published')
        self.assertEqual(path.read_bytes(),before);self.assertEqual(replay,first)
        self.assertEqual(self.calls,[])

    def test_receipt_shape_mapping_and_plan_hash_refuse(self):
        with self.runtime.owner():
            self.start();self.source.prepare(self.request['requestId'],self.job)
            path=self.pack/'source-00000.complete.json';before=path.read_bytes();original=json.loads(before)
            completed=self.pack/'completed.json';saved=completed.read_bytes();completed.unlink()
            try:
                for change in ({'format':'another'},{'planSha256':'a'*64},{'slot':True},{'bytes':True},{'sha256':'another'},{'objectRelativePath':'../another.bin'},{'extra':True}):
                    try:
                        self.restore(path,json_bytes({**original,**change}))
                        with self.subTest(change=change),self.assertRaisesRegex(ValueError,'Original complete URL source receipt differs'):
                            self.source.prepare(self.request['requestId'],self.job)
                    finally:
                        self.restore(path,before)
                        if completed.exists():completed.unlink()
            finally:self.restore(completed,saved)

    def test_changed_installation_seal_refuses_before_fetch(self):
        path=self.root/'source-installation.json';before=path.read_bytes()
        try:
            self.restore(path,json_bytes({**json.loads(before),'targetId':'another-target'}))
            with self.runtime.owner():
                self.start()
                with self.assertRaisesRegex(ValueError,'Original URL source installation differs'):
                    self.source.prepare(self.request['requestId'],self.job)
        finally:self.restore(path,before)
        self.assertEqual(self.calls,[])

    def test_original_plan_predates_fetch_and_detaches_supplied_alias(self):
        original=self.source.fetch
        def fetch(url,*args):
            self.assertTrue((self.pack/'plan.json').exists(),'Original source plan must predate fetching')
            self.assertEqual(self.read(self.pack,'plan.json')['binding']['originalApplicationJob']['created_by'],'synthetic-original-actor')
            self.job['created_by']='another-caller-alias'
            return original(url,*args)
        self.source.fetch=fetch
        with self.runtime.owner():
            self.start();self.source.prepare(self.request['requestId'],self.job)
            self.assertEqual(self.read(self.pack,'plan.json')['binding']['originalApplicationJob']['created_by'],'synthetic-original-actor')
            with self.assertRaisesRegex(ValueError,'Existing source custody record differs'):
                self.source.prepare(self.request['requestId'],self.job)

    def test_actual_runtime_preparation_receives_exact_complete_sources(self):
        def pipeline(job):
            result=self.source.prepare(job['request']['requestId'],self.job)
            self.fixture.spec.update(sourceRoot=result['sourceRoot'],sources=result['sources'])
            self.fixture.preparation(job)
        self.runtime.pipeline=pipeline
        with self.runtime.owner():
            self.assertIs(self.runtime.run_one(),True)
            self.assertIs(self.runtime.run_one(),False)
            self.assertEqual(self.runtime.status()['heldStarted'],1)
        for slot,raw in enumerate(self.raw):self.assertEqual((self.fixture.folder/f'retained/objects/source-{slot:05d}.bin').read_bytes(),raw,'Actual preparation must retain each complete original URL slot')
        self.assertFalse((self.fixture.folder/'engine/command-00000.intent.json').exists(),'Source preparation cannot issue engine initialization')

    def test_relocated_source_and_runtime_copies_replay_without_fetch(self):
        with self.runtime.owner():self.start();first=self.source.prepare(self.request['requestId'],self.job)
        copied_runtime=self.fixture.base/'copied-runtime';copied_sources=self.fixture.base/'copied-sources'
        shutil.copytree(self.runtime.root,copied_runtime);shutil.copytree(self.root,copied_sources)
        runtime=Runtime(copied_runtime,'synthetic-installation',max_queued=0,pipeline=lambda job:None)
        source=UrlSources(runtime,copied_sources,'synthetic-local-target',lambda *args:(_ for _ in ()).throw(AssertionError('Copied complete URL bytes refetched')),max_bytes=4096)
        with runtime.owner():replay=source.prepare(self.request['requestId'],self.job)
        self.assertEqual(replay['manifestSha256'],first['manifestSha256'])
        self.assertEqual(replay['sources'],first['sources'])
        for slot,name in enumerate(replay['sources']):self.assertEqual((replay['sourceRoot']/name).read_bytes(),self.raw[slot])

    def test_late_fetch_return_cannot_publish_completion(self):
        self.source.timeout=0.02
        def fetch(url,output,*args):output.write(self.raw[0]);time.sleep(0.05);return len(self.raw[0])
        self.source.fetch=fetch
        with self.runtime.owner():
            self.start()
            with self.assertRaisesRegex(TimeoutError,'Original URL source deadline exceeded'):
                self.source.prepare(self.request['requestId'],self.job)
        self.assertFalse((self.pack/'source-00000.complete.json').exists())

    def test_new_source_root_synchronizes_parent_entry(self):
        root=self.fixture.base/'new-source-root'
        with patch('url_source_custody.synchronize',wraps=module.synchronize) as sync:
            UrlSources(self.runtime,root,'synthetic-local-target',self.fetch,max_bytes=4096)
        self.assertIn(unittest.mock.call(root.parent),sync.call_args_list,'Private URL source root entry must synchronize its parent')

    def test_bypassed_writer_cannot_hide_stored_byte_count(self):
        def fetch(url,output,*args):
            raw=self.raw[0] if url.endswith('a.jpg') else self.raw[1]
            output.output.write(raw);return 0
        self.source.fetch=fetch
        with self.runtime.owner():
            self.start()
            with self.assertRaisesRegex(ValueError,'URL source stored byte count differs'):
                self.source.prepare(self.request['requestId'],self.job)
        self.assertFalse((self.pack/'source-00000.complete.json').exists())

    def test_retained_receipt_set_cannot_exceed_original_aggregate_budget(self):
        with self.runtime.owner():
            request,job,pack=self.unknown();self.source.max_bytes=sum(map(len,self.raw))
            result=self.source.prepare(request['requestId'],job)
            data=pack/result['sources'][0];receipt=pack/'source-00000.complete.json';completed=pack/'completed.json'
            before=data.read_bytes();saved=receipt.read_bytes();manifest=completed.read_bytes()
            try:
                raw=b'X'*(len(before)+5);self.restore(data,raw)
                self.restore(receipt,json_bytes({**json.loads(saved),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}));completed.unlink()
                with self.assertRaisesRegex(ValueError,'Retained URL source set exceeds the whole-job limit'):
                    self.source.prepare(request['requestId'],job)
            finally:self.restore(data,before);self.restore(receipt,saved);self.restore(completed,manifest)

    def test_zip_request_retains_one_exact_archive_before_preparation(self):
        request=copy.deepcopy(self.request);request['schemaVersion']='natford-aerial-processing.v1';request['requestId']='synthetic-original-zip'
        raw=b'Synthetic original archive bytes'
        request['imagery']={'type':'zip_url','url':'http://127.0.0.1:1/archive.zip','sizeBytes':len(raw),'imageCount':2}
        job={**self.job,'id':'synthetic-zip-job','request_id':request['requestId'],'imagery_type':'zip_url'}
        def fetch(url,output,*args):self.calls.append(url);output.write(raw);return len(raw)
        self.source.fetch=fetch
        with self.runtime.owner():
            entry,_=self.runtime.submit(request);self.runtime.journal.start(request['requestId'],entry.job_reference,self.runtime.context)
            result=self.source.prepare(request['requestId'],job)
        self.assertEqual(len(result['sources']),1,'ZIP custody must retain exactly one original archive')
        self.assertEqual((result['sourceRoot']/result['sources'][0]).read_bytes(),raw)
        self.assertEqual(self.calls,[request['imagery']['url']])

    def test_orphan_storage_bytes_refuse_without_fetch_or_removal(self):
        self.source.max_bytes=sum(map(len,self.raw))
        with self.runtime.owner():
            self.start();self.source.prepare(self.request['requestId'],self.job)
            orphan=self.pack/'objects'/('source-00000-'+'a'*32+'.bin');raw=b'X'*(self.source.max_bytes+1);self.restore(orphan,raw)
            self.source.fetch=lambda *args:(_ for _ in ()).throw(AssertionError('Exhausted attempt storage fetched'))
            with self.assertRaisesRegex(ValueError,'URL source attempt storage exceeds its original limit'):
                self.source.prepare(self.request['requestId'],self.job)
        self.assertEqual(orphan.read_bytes(),raw,'Storage refusal must preserve unaccepted evidence')

    def test_exhausted_attempt_count_cannot_start_another_object(self):
        with self.runtime.owner():
            self.start();request,job,pack=self.unknown()
            original=self.source.fetch
            self.source.fetch=lambda *args:(_ for _ in ()).throw(RuntimeError('Synthetic empty interruption'))
            for _ in range(4):
                with self.assertRaisesRegex(RuntimeError,'Synthetic empty interruption'):
                    self.source.prepare(request['requestId'],job)
            self.source.fetch=lambda *args:(_ for _ in ()).throw(AssertionError('Exhausted attempt count fetched'))
            with self.assertRaisesRegex(ValueError,'URL source attempt count limit reached'):
                self.source.prepare(request['requestId'],job)
        self.assertEqual(len(list((pack/'objects').iterdir())),4,'Attempt refusal must not create another orphan')

    def test_fetch_adapter_cannot_expand_original_whole_job_budget(self):
        with self.runtime.owner():
            request,job,pack=self.unknown();self.source.max_bytes=sum(map(len,self.raw))-1
            original=self.source.fetch
            def fetch(url,*args):
                count=original(url,*args);self.source.max_bytes*=2;return count
            self.source.fetch=fetch
            with self.assertRaisesRegex(ValueError,'URL source bytes exceed the remaining whole-job limit'):
                self.source.prepare(request['requestId'],job)
        self.assertFalse((pack/'source-00001.complete.json').exists(),'Changing an adapter alias cannot expand the frozen source budget')


if __name__=='__main__':unittest.main()
