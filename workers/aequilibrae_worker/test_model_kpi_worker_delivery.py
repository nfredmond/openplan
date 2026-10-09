"""Normal KPI call sites retain exact requests and propagate uncertain writes."""
import ast
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from worker_import_for_tests import import_worker_main
main=import_worker_main()
RUN='11111111-1111-4111-8111-111111111111'
STAGE='22222222-2222-4222-8222-222222222222'


class WorkerKpiDelivery(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);self.root=Path(temp.name)
        env=patch.dict(main.os.environ,{'OPENPLAN_DEPLOYMENT_ID':'synthetic'});env.start();self.addCleanup(env.stop)
        url=patch.object(main,'SUPABASE_URL','http://127.0.0.1:54321');url.start();self.addCleanup(url.stop)

    def response(self,url,**kwargs):
        self.assertTrue(url.endswith('/rpc/record_legacy_model_kpi'))
        payload=kwargs['json']['p_payload']
        return Mock(status_code=200,json=Mock(return_value={**{k:v for k,v in payload.items() if k!='stage_id'},'attempt_id':None}))

    def test_actual_call_sites_reuse_receipts_and_refuse_changed_values(self):
        calls=[n for n in ast.walk(ast.parse(Path(main.__file__).read_text())) if isinstance(n,ast.Expr) and isinstance(n.value,ast.Call) and getattr(n.value.func,'id',None)=='sb_record_retained_kpi']
        self.assertEqual(len(calls),2)
        with patch.object(main.requests,'post',side_effect=self.response) as post,patch.object(main,'sb_post_kpi') as legacy:
            identities=[]
            for node in calls:
                scope=dict(vars(main),run_id=RUN,stage_id=STAGE,_ws_id=RUN,run_row={'workspace_id':RUN},work_dir=str(self.root),kpi_payload=dict(run_id=RUN,kpi_name='daily_vmt',kpi_label='Daily VMT',kpi_category='assignment',value=10,unit='vehicle-miles/day',breakdown_json={'source':'trip-based'}),kpi_name='activitysim_daily_vmt',kpi_label='ActivitySim VMT',value=20,unit='vehicle-miles/day',provenance='synthetic behavioral assignment')
                code=compile(ast.Module(body=[node],type_ignores=[]),main.__file__,'exec')
                exec(code,scope);request=post.call_args.kwargs['json'];identities.append(request['p_payload']['id'])
                self.assertEqual(request['p_workspace'],RUN);self.assertEqual(request['p_payload']['stage_id'],STAGE)
                exec(code,scope)
                scope['kpi_payload']['value']=11;scope['value']=21
                with self.assertRaises(main.WorkerStateWriteUnconfirmed):exec(code,scope)
            self.assertEqual(len(set(identities)),2);self.assertEqual(post.call_count,2);legacy.assert_not_called()

    def test_defaults_preserve_explicit_nulls_and_transport_loss(self):
        payload=dict(run_id=RUN,kpi_name='unavailable',kpi_label='Unavailable',value=None,breakdown_json=None)
        kwargs=dict(workspace_id=RUN,stage_id=STAGE,journal_dir=str(self.root/'journal'))
        with patch.object(main.requests,'post',side_effect=TimeoutError('private transport detail')):
            with self.assertRaises(main.WorkerStateWriteUnconfirmed) as error:main.sb_record_retained_kpi(payload,**kwargs)
            self.assertNotIn('private transport detail',str(error.exception))
        with patch.object(main.requests,'post',side_effect=self.response) as post:
            receipt=main.sb_record_retained_kpi(payload,**kwargs)
            self.assertIsNone(receipt['value']);self.assertIsNone(receipt['breakdown_json']);self.assertIsNone(receipt['geometry_ref'])
            self.assertEqual(receipt['unit'],'');self.assertEqual(receipt['kpi_category'],'accessibility')
            self.assertEqual(main.sb_record_retained_kpi(payload,**kwargs),receipt);self.assertEqual(post.call_count,1)
            with self.assertRaises(main.WorkerStateWriteUnconfirmed):main.sb_record_retained_kpi({**payload,'stage_id':STAGE},**kwargs)
            self.assertEqual(post.call_count,1)

if __name__=='__main__':unittest.main()
