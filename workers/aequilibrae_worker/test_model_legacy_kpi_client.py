"""Legacy KPI identities, receipt completeness and uncertain request recovery."""
import copy
import unittest
from unittest.mock import Mock
import model_legacy_kpi_command as kpi
import model_command_client as client
import model_command_journal as journal
import model_command_recovery as recovery
import test_model_publication_client as helpers
IDS, URL = helpers.IDS, helpers.URL


class LegacyKpiTests(unittest.TestCase):
    setUp = helpers.PublicationClientTests.setUp
    deliver = helpers.PublicationClientTests.deliver
    response = helpers.PublicationClientTests.response

    def payload(self):
        return dict(run_id=IDS[1],stage_id=IDS[2],kpi_name='daily_vmt',kpi_label='Daily VMT',kpi_category='assignment',value=12.5,unit='vehicle-miles/day',geometry_ref=None,breakdown_json={'source':'synthetic'})

    def prepare(self,payload=None,name='daily_vmt',deployment='synthetic'):
        return kpi.prepare(self.root/'journal',IDS[3],self.payload() if payload is None else payload,name=name,base_url=URL,deployment_id=deployment)

    def receipt(self,cmd):
        return {**{key:value for key,value in cmd['arguments']['payload'].items() if key!='stage_id'},'attempt_id':None}

    def test_slot_identity_refuses_changed_payload_even_after_resolution(self):
        cmd=self.prepare();self.assertEqual(self.prepare(),cmd)
        self.assertNotEqual(self.prepare(name='other')['request_id'],cmd['request_id'])
        self.assertNotEqual(self.prepare(deployment='other')['request_id'],cmd['request_id'])
        changed=self.payload();changed['value']=13.5
        with self.assertRaisesRegex(ValueError,'identity reused'):self.prepare(changed)
        journal.resolve(self.root/'journal',cmd,self.receipt(cmd))
        with self.assertRaisesRegex(ValueError,'identity reused'):self.prepare(changed)
        with self.assertRaises(ValueError):self.prepare(name='../unsafe')

    def test_lost_reply_recovery_uses_exact_saved_request(self):
        cmd=self.prepare();expected=self.receipt(cmd);observed={}
        def lose(url,**kwargs):
            observed.update(url=url,body=kwargs['json'],pending=journal.pending(self.root/'journal',cmd['destination']))
            raise TimeoutError()
        with self.assertRaises(client.DeliveryUnconfirmed):self.deliver(cmd,Mock(side_effect=lose))
        self.assertEqual(observed['url'],URL+'/rest/v1/rpc/record_legacy_model_kpi')
        self.assertEqual(observed['pending'][0]['command'],cmd)
        self.assertEqual(observed['body'],{'p_workspace':IDS[3],'p_payload':cmd['arguments']['payload']})
        self.assertEqual(recovery.pending_summaries(self.root/'journal',base_url=URL,deployment_id='synthetic'),[dict(request_id=cmd['request_id'],operation=cmd['operation'],run_id=IDS[1],stage_id=IDS[2])])
        post=Mock(return_value=self.response(expected))
        result=recovery.recover_request(self.root/'journal',cmd['request_id'],base_url=URL,deployment_id='synthetic',service_key='synthetic-private',post=post)
        self.assertEqual(result,expected);self.assertEqual(self.deliver(cmd,post),expected)
        self.assertEqual(post.call_count,1);self.assertEqual(post.call_args.kwargs['json'],observed['body'])

    def test_receipts_preserve_null_and_numeric_equivalence(self):
        for i,value in enumerate((None,0,1,1.25)):
            payload=self.payload();payload['value']=value;payload['breakdown_json']=None
            cmd=self.prepare(payload,name='slot'+str(i));receipt=self.receipt(cmd)
            if type(value) is int:receipt['value']=float(value)
            self.assertEqual(kpi.check_receipt(cmd,receipt),receipt)
            if value is None:
                receipt['value']=0
                with self.assertRaises(ValueError):kpi.check_receipt(cmd,receipt)

    def test_mismatched_or_missing_receipts_stay_pending(self):
        edits=[('id',IDS[4]),('run_id',IDS[4]),('attempt_id',IDS[4]),('kpi_name','other'),('kpi_label','other'),('kpi_category','general'),('value',True),('value',13),('unit','other'),('geometry_ref','other'),('breakdown_json',None)]
        cmd=self.prepare()
        bad_rows=[]
        for key,value in edits:
            bad=self.receipt(cmd);bad[key]=value;bad_rows.append(bad)
        for key in self.receipt(cmd):
            bad=self.receipt(cmd);bad.pop(key);bad_rows.append(bad)
        for i,bad in enumerate(bad_rows):
            with self.subTest(case=i):
                directory=self.root/str(i)
                with self.assertRaises(client.DeliveryUnconfirmed):self.deliver(cmd,Mock(return_value=self.response(bad)),directory)
                self.assertEqual(len(journal.pending(directory,cmd['destination'])),1)

    def test_scope_and_numeric_guards_reject_changed_command(self):
        for key in ('run_id','stage_id'):
            cmd=copy.deepcopy(self.prepare());cmd['arguments'][key]=IDS[4]
            with self.assertRaises(ValueError):client.validate_command(cmd)
        cmd=copy.deepcopy(self.prepare());cmd['arguments']['payload']['value']=2**53+1
        with self.assertRaises(ValueError):client.validate_command(cmd)

    def test_invalid_values_never_send(self):
        edits=[('value',True),('value',2**53+1),('value',float('inf')),('value','12.5'),('kpi_category','other'),('kpi_label',' '),('unit',None),('geometry_ref',{}),('breakdown_json',[]),('run_id','bad')]
        for i,(key,value) in enumerate(edits):
            cmd=copy.deepcopy(self.prepare());cmd['arguments']['payload'][key]=value;post=Mock()
            with self.subTest(key=key,value=value),self.assertRaises(ValueError):self.deliver(cmd,post,self.root/('invalid'+str(i)))
            post.assert_not_called()
        for key in kpi.FIELDS:
            cmd=copy.deepcopy(self.prepare());cmd['arguments']['payload'].pop(key)
            with self.assertRaises(ValueError):client.validate_command(cmd)

if __name__=='__main__':unittest.main()
