"""Normal artifact-stage preparation retains and binds the primary output."""
import ast
import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from worker_import_for_tests import import_worker_main
main=import_worker_main()
RUN='11111111-1111-4111-8111-111111111111'
STAGE='22222222-2222-4222-8222-222222222222'


class PrimaryOutputPreparation(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        (self.root/'run_output').mkdir();(self.root/'aeq_project').mkdir()
        (self.root/'run_output/link_volumes.csv').write_bytes(b'synthetic volumes\n')
        (self.root/'aeq_project/project_database.sqlite').write_bytes(b'synthetic network fixture')
        self.env=patch.dict(main.os.environ,{'OPENPLAN_DEPLOYMENT_ID':'synthetic'});self.env.start();self.addCleanup(self.env.stop)
        self.url=patch.object(main,'SUPABASE_URL','http://127.0.0.1:54321');self.url.start();self.addCleanup(self.url.stop)

    def prefix(self):
        function=next(n for n in ast.parse(Path(main.__file__).read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='stage_artifacts')
        body=[]
        for statement in function.body:
            if isinstance(statement,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='calibration_result' for t in statement.targets):break
            body.append(statement)
        scope=dict(vars(main),run_id=RUN,stage_id=STAGE,work_dir=str(self.root),setup_result={},assign_result={},package_meta=None)
        with patch.object(main,'validated_convergence_profile',return_value=({}, {}, 'synthetic')),patch.object(main,'assignment_artifact_metadata',return_value={}),patch.object(main,'assignment_engine_stamp',return_value={}):
            scope.update({k:getattr(main,k) for k in ('validated_convergence_profile','assignment_artifact_metadata','assignment_engine_stamp')})
            exec(compile(ast.Module(body=body,type_ignores=[]),main.__file__,'exec'),scope)
        return scope

    def test_actual_stage_prefix_reuses_identity_and_refuses_changed_sources(self):
        first=self.prefix();second=self.prefix()
        self.assertEqual(first['model_output_artifact_id'],second['model_output_artifact_id'])
        self.assertEqual(first['model_output_artifact_id'],first['prepared_output']['output_artifact_id'])
        (self.root/'run_output/link_volumes.csv').write_bytes(b'changed volumes\n')
        with self.assertRaises(main.WorkerStateWriteUnconfirmed):self.prefix()

    def test_binding_keeps_exact_bytes_and_scope(self):
        prepared=self.prefix()['prepared_output'];facts=prepared['source_files']['link_volumes']
        payload=dict(run_id=RUN,stage_id=STAGE,artifact_type='link_volumes',content_hash=facts['sha256'],file_size_bytes=facts['size_bytes'])
        main.bind_prepared_primary_output(prepared,payload)
        self.assertEqual(payload['id'],prepared['output_artifact_id'])
        for key,value in [('run_id',STAGE),('stage_id',RUN),('artifact_type','other'),('content_hash','0'*64),('file_size_bytes',0)]:
            bad=copy.deepcopy(payload);bad[key]=value
            with self.subTest(key=key),self.assertRaises(main.WorkerStateWriteUnconfirmed):main.bind_prepared_primary_output(prepared,bad)

    def test_actual_registration_uses_binding_before_write(self):
        function=next(n for n in ast.parse(Path(main.__file__).read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='stage_artifacts')
        branch=next(n for n in ast.walk(function) if isinstance(n,ast.If) and ast.unparse(n.test)=="atype == 'link_volumes'")
        prepared=self.prefix()['prepared_output'];facts=prepared['source_files']['link_volumes']
        payload=dict(run_id=RUN,stage_id=STAGE,artifact_type='link_volumes',content_hash=facts['sha256'],file_size_bytes=facts['size_bytes'])
        writer=Mock(return_value={'id':prepared['output_artifact_id']})
        scope=dict(vars(main),atype='link_volumes',prepared_output=prepared,artifact_payload=payload,model_output_artifact_id=prepared['output_artifact_id'],_ws_id=RUN,work_dir=str(self.root),stage_id=STAGE,sb_record_retained_artifact=writer)
        exec(compile(ast.Module(body=[branch],type_ignores=[]),main.__file__,'exec'),scope)
        self.assertEqual(payload['id'],prepared['output_artifact_id'])
        writer.assert_called_once_with(payload,workspace_id=RUN,journal_dir=str(self.root/'stage-journals'/STAGE))
        writer.reset_mock()
        payload['content_hash']='0'*64
        with self.assertRaises(main.WorkerStateWriteUnconfirmed):exec(compile(ast.Module(body=[branch],type_ignores=[]),main.__file__,'exec'),scope)
        writer.assert_not_called()
        payload['content_hash']=facts['sha256']
        writer.side_effect=main.WorkerStateWriteUnconfirmed('Synthetic lost reply')
        with self.assertRaises(main.WorkerStateWriteUnconfirmed):exec(compile(ast.Module(body=[branch],type_ignores=[]),main.__file__,'exec'),scope)

    def test_secondary_registration_slots_use_exact_retained_delivery(self):
        function=next(n for n in ast.parse(Path(main.__file__).read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='stage_artifacts')
        branch=next(n for n in ast.walk(function) if isinstance(n,ast.If) and ast.unparse(n.test)=="atype == 'link_volumes'")
        names=[('link_volumes_calibrated.csv','link_volumes_calibrated'),('accepted_network_calibration.json','accepted_network_calibration'),('demand.omx','demand_matrix'),('travel_time_skims.omx','skim_matrix'),('network_setup_summary.json','network_setup_summary')]
        def send(url,**kwargs):
            return Mock(status_code=200,json=Mock(return_value={**kwargs['json']['p_payload'],'attempt_id':None}))
        with patch.object(main.requests,'post',side_effect=send) as post,patch.object(main,'sb_post_artifact') as legacy:
            identities=[]
            for fname,atype in names:
                payload=dict(run_id=RUN,stage_id=STAGE,artifact_type=atype,file_url='local://'+fname,content_hash='a'*64,file_size_bytes=2,metadata_json={})
                scope=dict(vars(main),atype=atype,fname=fname,artifact_payload=payload,_ws_id=RUN,work_dir=str(self.root),stage_id=STAGE)
                for _ in range(2):exec(compile(ast.Module(body=[branch],type_ignores=[]),main.__file__,'exec'),scope)
                identities.append(scope['registered']['id'])
                payload['content_hash']='b'*64
                with self.assertRaises(main.WorkerStateWriteUnconfirmed):exec(compile(ast.Module(body=[branch],type_ignores=[]),main.__file__,'exec'),scope)
            self.assertEqual(len(set(identities)),5)
            self.assertEqual(post.call_count,5)
            legacy.assert_not_called()


    def test_zone_input_registration_reuses_receipt_and_refuses_changed_bytes(self):
        function=next(n for n in ast.parse(Path(main.__file__).read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='stage_artifacts')
        branch=next(n for n in ast.walk(function) if isinstance(n,ast.If) and ast.unparse(n.test)=="os.path.exists(zone_attr_path)")
        path=self.root/'package'/'zone_attributes.csv';path.parent.mkdir()
        path.write_bytes(b'zone,population\n1,10\n')
        def send(url,**kwargs):
            return Mock(status_code=200,json=Mock(return_value={**kwargs['json']['p_payload'],'attempt_id':None}))
        with patch.object(main.requests,'post',side_effect=send) as post,patch.object(main,'sb_post_artifact') as legacy:
            scope=dict(vars(main),run_id=RUN,stage_id=STAGE,zone_attr_path=str(path),_ws_id=RUN,work_dir=str(self.root))
            code=compile(ast.Module(body=[branch],type_ignores=[]),main.__file__,'exec')
            exec(code,scope);exec(code,scope)
            self.assertEqual(post.call_count,1)
            payload=post.call_args.kwargs['json']['p_payload']
            self.assertEqual(payload['file_size_bytes'],len(path.read_bytes()))
            self.assertEqual(payload['content_hash'],main.hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertEqual(payload['artifact_type'],'zone_attributes')
            self.assertEqual(payload['file_url'],'local://'+str(path))
            path.write_bytes(b'zone,population\n1,11\n')
            with self.assertRaises(main.WorkerStateWriteUnconfirmed):exec(code,scope)
            self.assertEqual(post.call_count,1)
            legacy.assert_not_called()


if __name__=='__main__':unittest.main()
