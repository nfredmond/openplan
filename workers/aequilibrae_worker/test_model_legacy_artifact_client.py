"""Legacy artifact identity, uncertain delivery and exact receipt checks."""
import copy
import unittest
from unittest.mock import Mock
import model_legacy_artifact_command as artifact
import model_command_client as client
import model_command_journal as journal
import model_command_recovery as recovery
import test_model_publication_client as helpers
IDS, URL = helpers.IDS, helpers.URL


class LegacyArtifactTests(unittest.TestCase):
    setUp = helpers.PublicationClientTests.setUp
    deliver = helpers.PublicationClientTests.deliver
    response = helpers.PublicationClientTests.response

    def payload(self):
        return dict(id=IDS[0], run_id=IDS[1], stage_id=IDS[2], artifact_type='link_volumes',
                    file_url='local://synthetic', file_size_bytes=2, content_hash='a'*64, metadata_json={'count':1})

    def prepare(self, payload=None, deployment='synthetic'):
        return artifact.prepare(self.root/'journal', IDS[3], self.payload() if payload is None else payload,
                                base_url=URL, deployment_id=deployment)

    def test_named_artifact_slot_reuses_identity_and_refuses_changed_bytes(self):
        payload=self.payload();payload.pop('id')
        def prepare(value=payload,name='demand.omx'):
            return artifact.prepare_named(self.root/'journal',IDS[3],value,name=name,base_url=URL,deployment_id='synthetic')
        first=prepare();self.assertEqual(prepare(),first)
        self.assertNotEqual(prepare(name='skim.omx')['request_id'],first['request_id'])
        changed={**payload,'content_hash':'b'*64}
        with self.assertRaisesRegex(ValueError,'identity reused'):prepare(changed)
        with self.assertRaises(ValueError):prepare(name='../demand.omx')
        with self.assertRaises(ValueError):prepare(self.payload())

    def test_stable_identity_and_conflicting_request(self):
        cmd=self.prepare()
        self.assertEqual(self.prepare(),cmd)
        self.assertNotEqual(self.prepare(deployment='other')['request_id'],cmd['request_id'])
        changed=self.payload();changed['file_url']='local://changed'
        with self.assertRaisesRegex(ValueError,'identity reused'):self.prepare(changed)
        journal.resolve(self.root/'journal',cmd,{**self.payload(),'attempt_id':None})
        with self.assertRaisesRegex(ValueError,'identity reused'):self.prepare(changed)

    def test_loss_recovery_and_cached_receipt(self):
        cmd=self.prepare();expected={**self.payload(),'attempt_id':None}
        observed={}
        def lose(url,**kwargs):
            observed.update(url=url,body=kwargs['json'],pending=journal.pending(self.root/'journal',cmd['destination']))
            raise TimeoutError()
        with self.assertRaises(client.DeliveryUnconfirmed):self.deliver(cmd,Mock(side_effect=lose))
        self.assertEqual(observed['url'],URL+'/rest/v1/rpc/record_legacy_model_artifact')
        self.assertEqual(observed['pending'][0]['command'],cmd)
        self.assertEqual(observed['body'],{'p_workspace':IDS[3],'p_payload':self.payload()})
        self.assertEqual(recovery.pending_summaries(self.root/'journal',base_url=URL,deployment_id='synthetic'),[dict(request_id=cmd['request_id'],operation=cmd['operation'],run_id=IDS[1],stage_id=IDS[2])])
        post=Mock(return_value=self.response(expected))
        actual=recovery.recover_request(self.root/'journal',cmd['request_id'],base_url=URL,deployment_id='synthetic',service_key='synthetic-private',post=post)
        self.assertEqual(actual,expected)
        self.assertEqual(self.deliver(cmd,post),expected)
        self.assertEqual(post.call_args.kwargs['json'],{'p_workspace':IDS[3],'p_payload':self.payload()})
        self.assertEqual(post.call_count,1)
        self.assertEqual(journal.pending(self.root/'journal',cmd['destination']),[])

    def test_mismatched_receipts_stay_pending(self):
        edits=[('id',IDS[4]),('run_id',IDS[4]),('stage_id',IDS[4]),('attempt_id',IDS[4]),('content_hash','b'*64),('file_size_bytes',True),('metadata_json',{'count':True}),('artifact_type','different'),('file_url','local://other')]
        for i,(key,value) in enumerate(edits):
            with self.subTest(key=key):
                cmd=self.prepare();bad={**self.payload(),'attempt_id':None};bad[key]=value
                directory=self.root/str(i)
                with self.assertRaises(client.DeliveryUnconfirmed):self.deliver(cmd,Mock(return_value=self.response(bad)),directory)
                self.assertEqual(len(journal.pending(directory,cmd['destination'])),1)
        with self.assertRaises(ValueError):artifact.check_receipt(self.prepare(),self.payload())

    def test_invalid_commands_never_send(self):
        edits=[lambda a:a.update(extra=True),lambda a:a.update(run_id=IDS[4]),lambda a:a.update(workspace_id='bad'),lambda a:a['payload'].update(extra=True),lambda a:a['payload'].update(file_url=' '),lambda a:a['payload'].update(file_size_bytes=True),lambda a:a['payload'].update(file_size_bytes=2**63),lambda a:a['payload'].update(content_hash='bad'),lambda a:a['payload'].update(metadata_json=[])]
        for i,edit in enumerate(edits):
            cmd=copy.deepcopy(self.prepare());edit(cmd['arguments']);post=Mock()
            with self.subTest(case=i):
                error=None
                try:self.deliver(cmd,post,self.root/('invalid'+str(i)))
                except Exception as failure:error=failure
                post.assert_not_called()
                self.assertIsInstance(error,ValueError)

if __name__=='__main__':unittest.main()
