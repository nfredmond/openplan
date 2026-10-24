"""ActivitySim reads only the declared completed producer of its bound run."""
import copy
import unittest
from unittest.mock import Mock, patch
import model_attempt_writer as managed
import model_activitysim_handoff as handoff
import test_model_attempt_writer as fixtures
from test_model_skip_dispatch import activity


class ActivityHandoffTests(unittest.TestCase):
    setUp = fixtures.WriterTests.setUp
    response = fixtures.WriterTests.response

    def configure(self):
        row = self.get.return_value.json.return_value[0]
        row['model_runs'].update({key: None for key in managed.RUN_CONFIGURATION_FIELDS})
        ctx = self.writer.context
        producer = {'id':'11111111-1111-4111-8111-111111111111','run_id':ctx.run_id,
            'stage_name':'Artifact Extraction','sort_order':30,'status':'succeeded',
            'attempt_managed':True,'active_attempt_id':'22222222-2222-4222-8222-222222222222'}
        consumer = {**copy.deepcopy(row),'stage_name':'ActivitySim Bundle & Preflight','sort_order':40}
        stages = [producer, consumer]
        artifacts = [{'id':f'33333333-3333-4333-8333-33333333333{i}', 'run_id':ctx.run_id,
            'stage_id':producer['id'],'attempt_id':producer['active_attempt_id'],
            'artifact_type':kind,'model_run_stages':copy.deepcopy(producer)} for i,kind in enumerate(handoff.KINDS)]
        responses = [Mock(status_code=200,json=Mock(return_value=value)) for value in ([row],stages,artifacts,[row])]
        self.get.side_effect = responses
        return stages, artifacts, responses

    def test_declared_producer_and_exact_projections(self):
        _, artifacts, responses = self.configure()
        with managed.bind(self.writer), patch.object(activity.requests,'get',side_effect=AssertionError('Legacy read')):
            self.assertEqual(activity.sb_get_run_artifacts(self.writer.context.run_id),artifacts)
        for index,table,projection in ((1,'model_run_stages','id,run_id,stage_name,sort_order,status,attempt_managed,active_attempt_id'),(2,'model_run_artifacts','id,run_id,stage_id,attempt_id,artifact_type,file_url,file_size_bytes,content_hash,metadata_json,model_run_stages!inner(id,run_id,status,attempt_managed,active_attempt_id)')):
            call=self.get.call_args_list[index]
            self.assertEqual(call.args[0],self.writer.base_url+'/rest/v1/'+table)
            self.assertEqual(call.kwargs['params'],{'run_id':'eq.'+self.writer.context.run_id,'select':projection})
            self.assertFalse(call.kwargs['allow_redirects'])
        for response in responses:response.close.assert_called_once()
        self.post.assert_not_called()

    def test_revoked_producer_refuses_without_fallback(self):
        stages,_,_=self.configure();stages[0]['active_attempt_id']='44444444-4444-4444-8444-444444444444'
        with managed.bind(self.writer),patch.object(activity.requests,'get',side_effect=AssertionError('Legacy fallback')):
            with self.assertRaises(activity.WorkerStateReadUnconfirmed):activity.sb_get_run_artifacts(self.writer.context.run_id)
        self.assertTrue(self.writer.stopped)

    def test_wrong_run_refuses_before_artifact_read(self):
        self.configure()
        with managed.bind(self.writer):
            with self.assertRaises(activity.WorkerStateReadUnconfirmed):activity.sb_get_run_artifacts('foreign')
        self.get.assert_not_called();self.assertTrue(self.writer.stopped)

    def test_consumer_revoked_after_selection_refuses(self):
        _,_,responses=self.configure()
        final=copy.deepcopy(responses[-1].json.return_value);final[0]['status']='failed'
        responses[-1].json.return_value=final
        with managed.bind(self.writer):
            with self.assertRaises(activity.WorkerStateReadUnconfirmed):activity.sb_get_run_artifacts(self.writer.context.run_id)
        self.assertTrue(self.writer.stopped)

    def test_wrong_producer_stage_refuses(self):
        stages,_,_=self.configure();stages[0]['stage_name']='Network Assignment'
        with managed.bind(self.writer):
            with self.assertRaises(activity.WorkerStateReadUnconfirmed):activity.sb_get_run_artifacts(self.writer.context.run_id)

    def test_managed_consumer_cannot_use_a_changed_dispatch_snapshot(self):
        _,_,responses=self.configure()
        responses[0].json.return_value[0]['stage_name']='ActivitySim Bundle & Preflight'
        actual=responses[0].json.return_value[0]['model_runs']
        dispatched={key:copy.deepcopy(actual[key]) for key in ('id','workspace_id',*managed.RUN_CONFIGURATION_FIELDS)}
        dispatched['corridor_geojson']={'changed':True}
        self.get.side_effect=responses+[responses[0]]
        with managed.bind(self.writer),patch.object(activity.requests,'get',side_effect=AssertionError('Legacy fallback')):
            with self.assertRaises(activity.WorkerStateReadUnconfirmed) as failure:
                activity.sb_get_run_artifacts(self.writer.context.run_id,stage_id=self.writer.context.stage_id,run=dispatched)
        self.assertIn('Actual managed run differs',str(failure.exception.__cause__))
        self.assertTrue(self.writer.stopped)

    def test_foreign_artifact_kind_refuses(self):
        stages,artifacts,_=self.configure();artifacts[0]['artifact_type']='model_package_inputs'
        with self.assertRaisesRegex(ValueError,'Artifact kind differs'):
            handoff.select(self.writer.context,stages,artifacts,'model_package_inputs')

    def configure_population(self):
        stages, artifacts, responses = self.configure()
        source = {'modelRunId':'77777777-7777-4777-8777-777777777777',
            'artifactId':'88888888-8888-4888-8888-888888888888', 'stageId':'99999999-9999-4999-8999-999999999999',
            'attemptId':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'sha256':'a'*64, 'sizeBytes':100}
        responses[0].json.return_value[0]['model_runs']['input_snapshot_json'] = {
            'commonPopulation': {'schema':'openplan.common-population-request.v1','mode':'reuse',
                'custody':'managed_attempt','comparisonPolicy':'fixed_population_auto_trip_change','source':source}}
        producer = {'id':'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','run_id':self.writer.context.run_id,
            'stage_name':'AequilibraE Setup','sort_order':10,'status':'succeeded','attempt_managed':True,
            'active_attempt_id':'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}
        stages.append(producer)
        metadata = {'schema':'openplan.common-population.v1','population_basis':{'supplied':'fixture'},
            'custody':'managed_attempt',
            'population_basis_payload_json':'{"supplied":"fixture"}','population_basis_digest':'d'*64,
            'origin':source,'scientific_acceptance':'unassessed'}
        companions = [{'id':f'55555555-5555-4555-8555-{index:012d}', 'run_id':self.writer.context.run_id,
            'stage_id':producer['id'],'attempt_id':producer['active_attempt_id'],'artifact_type':kind,
            'file_url':'local:///supplied/'+kind,'file_size_bytes':100,'content_hash':'a'*64,
            'metadata_json':copy.deepcopy(metadata),'model_run_stages':copy.deepcopy(producer)}
            for index,kind in enumerate(handoff.POPULATION_KINDS)]
        artifacts += companions
        classified = {'run_id':self.writer.context.run_id,'run_status':'running',
            'outputs':[{'kind':'artifact','ownership_state':'current_completed',
                'record':{key:value for key,value in row.items() if key!='model_run_stages'}} for row in companions]}
        response = Mock(status_code=200,json=Mock(return_value=classified))
        self.post.side_effect = None
        self.post.return_value = response
        return stages, artifacts, companions, classified, response

    def test_common_population_selects_all_seven_setup_companions_and_classifier(self):
        _, artifacts, _, _, response = self.configure_population()
        selected = handoff.read_screening_artifacts(self.writer,self.writer.context.run_id)
        self.assertEqual(selected,artifacts)
        self.post.assert_called_once()
        call = self.post.call_args
        self.assertEqual(call.args[0],self.writer.base_url+'/rest/v1/rpc/read_model_attempt_outputs')
        self.assertEqual(call.kwargs['json'],{'p_run_id':self.writer.context.run_id,'p_workspace_id':self.writer.context.workspace_id})
        self.assertFalse(call.kwargs['allow_redirects'])
        response.close.assert_called_once()

    def test_common_population_rejects_missing_inactive_changed_and_unclassified_outputs(self):
        for fault in ('missing','duplicate','inactive','setup_status','revoked','metadata','schema','classifier_record','classifier_scope','origin','manifest'):
            stages, artifacts, companions, classified, _ = self.configure_population()
            if fault=='missing':artifacts.remove(companions[-1])
            elif fault=='duplicate':artifacts.append(copy.deepcopy(companions[-1]))
            elif fault=='inactive':stages[-1]['active_attempt_id']='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
            elif fault=='setup_status':stages[-1]['status']='running'
            elif fault=='revoked':classified['outputs'][0]['ownership_state']='retained_inactive'
            elif fault=='metadata':companions[-1]['metadata_json']['population_basis_digest']='b'*64
            elif fault=='schema':
                for row in companions:row['metadata_json']['schema']='unknown'
            elif fault=='classifier_record':classified['outputs'][0]['record']['content_hash']='b'*64
            elif fault=='classifier_scope':classified['run_id']='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
            elif fault=='origin':companions[0]['metadata_json']['origin']={}
            else:companions[0]['content_hash']='b'*64
            with self.subTest(fault=fault),self.assertRaises(ValueError):
                handoff.read_screening_artifacts(self.writer,self.writer.context.run_id)

    def test_harmless_classifier_unrelated_output_survives(self):
        _, _, _, classified, _ = self.configure_population()
        classified['outputs'].append({'kind':'kpi','ownership_state':'current_in_progress','record':{'id':'unrelated'}})
        selected = handoff.read_screening_artifacts(self.writer,self.writer.context.run_id)
        self.assertEqual([row['artifact_type'] for row in selected],list(handoff.KINDS+handoff.POPULATION_KINDS))

    def configure_ordinary_population(self):
        stages, artifacts, companions, classified, _ = self.configure_population()
        # Construct the actual parent independently of managed authority.
        request = {'schema':'openplan.common-population-request.v1','mode':'reuse',
            'custody':'legacy_stage_snapshot','comparisonPolicy':'fixed_population_auto_trip_change',
            'source':{**companions[0]['metadata_json']['origin'],'attemptId':None}}
        run = {key:None for key in handoff.RUN_PROJECTION.split(',')}
        run.update(id=self.writer.context.run_id, workspace_id=self.writer.context.workspace_id,
            status='running', attempt_managed=False, input_snapshot_json={'commonPopulation':request})
        for stage in stages:
            stage['attempt_managed'] = False
            stage['active_attempt_id'] = None
        for row in artifacts:
            row['attempt_id'] = None
            row['model_run_stages'] = copy.deepcopy(next(stage for stage in stages if stage['id']==row['stage_id']))
            for field in handoff.ARTIFACT_PROJECTION.split(',model_run_stages!inner')[0].split(','):
                row.setdefault(field, None)
        for row in companions:
            row['metadata_json']['custody'] = 'legacy_stage_snapshot'
            row['metadata_json']['origin'] = copy.deepcopy(request['source'])
        classified['outputs'] = [{'kind':'artifact','ownership_state':'legacy_unknown',
            'record':{key:value for key,value in row.items() if key!='model_run_stages'}} for row in companions]
        responses = [Mock(status_code=200,json=Mock(return_value=value)) for value in
            ([run],stages,artifacts,[copy.deepcopy(run)],copy.deepcopy(stages),copy.deepcopy(artifacts))]
        self.get.side_effect = responses
        self.attestations = []

        def post(url, **kwargs):
            if url.endswith('/read_model_attempt_outputs'):
                return Mock(status_code=200,json=Mock(return_value=classified))
            self.assertTrue(url.endswith('/read_common_population_stage_custody'))
            args = kwargs['json']
            attestation = {'schema':'openplan.common-population-stage-custody.v1',
                'custody':'legacy_stage_snapshot','workspace_id':args['p_workspace'],'run_id':args['p_run'],
                'stage_id':args['p_stage'],'artifact_id':args['p_artifact'],'eligible':True}
            self.attestations.append(attestation)
            return Mock(status_code=200,json=Mock(return_value=attestation))
        self.post.side_effect = post
        return run, stages, artifacts, companions, classified, responses

    def read_ordinary(self):
        return handoff.read_screening_stage_artifacts(self.writer.base_url,self.writer.service_key,
            self.writer.context.run_id,self.writer.context.stage_id,get=self.get,post=self.post)

    def test_ordinary_stage_requires_exact_classifier_and_fresh_receipts_for_all_seven(self):
        run, _, artifacts, companions, _, responses = self.configure_ordinary_population()
        result = self.read_ordinary()
        self.assertEqual(result,{'run':run,'artifacts':artifacts})
        self.assertEqual(len(self.attestations),9)
        self.assertEqual([item['artifact_id'] for item in self.attestations],
            [None,*[row['id'] for row in companions],None])
        self.assertEqual([item['stage_id'] for item in self.attestations],
            [self.writer.context.stage_id,*[row['stage_id'] for row in companions],self.writer.context.stage_id])
        self.assertTrue(all(item['run_id']==run['id'] and item['workspace_id']==run['workspace_id']
            for item in self.attestations))
        self.assertEqual(self.get.call_args_list[0].kwargs['params'],
            {'id':'eq.'+run['id'],'select':handoff.RUN_PROJECTION})
        self.assertEqual(self.get.call_args_list[1].kwargs['params'],
            {'run_id':'eq.'+run['id'],'select':handoff.STAGE_PROJECTION})
        self.assertEqual(self.get.call_args_list[2].kwargs['params'],
            {'run_id':'eq.'+run['id'],'select':handoff.ARTIFACT_PROJECTION})
        for response in responses:response.close.assert_called_once()
        for call in self.post.call_args_list:
            self.assertFalse(call.kwargs['allow_redirects'])

    def test_ordinary_unknown_mixed_and_historical_ownership_refuse(self):
        for fault in ('missing_custody','unknown_custody','managed_request','attempt','parent_managed',
                'setup_managed','consumer_stale','classifier_managed','classifier_revoked',
                'classifier_record','consumer_changed','run_changed','missing','duplicate','metadata'):
            run, stages, artifacts, companions, classified, responses = self.configure_ordinary_population()
            request = run['input_snapshot_json']['commonPopulation']
            if fault=='missing_custody':request.pop('custody')
            elif fault=='unknown_custody':request['custody']='legacy_unknown'
            elif fault=='managed_request':request['custody']='managed_attempt'
            elif fault=='attempt':request['source']['attemptId']=self.writer.context.attempt_id
            elif fault=='parent_managed':run['attempt_managed']=True
            elif fault=='setup_managed':stages[-1]['attempt_managed']=True
            elif fault=='consumer_stale':stages[1]['status']='succeeded'
            elif fault=='classifier_managed':classified['outputs'][0]['ownership_state']='current_completed'
            elif fault=='classifier_revoked':classified['outputs'][0]['ownership_state']='retained_inactive'
            elif fault=='classifier_record':classified['outputs'][0]['record']['content_hash']='b'*64
            elif fault=='consumer_changed':responses[-2].json.return_value[1]['status']='failed'
            elif fault=='run_changed':responses[-3].json.return_value[0]['corridor_geojson']={'changed':True}
            elif fault=='missing':artifacts.remove(companions[-1])
            elif fault=='duplicate':artifacts.append(copy.deepcopy(companions[-1]))
            elif fault=='metadata':companions[0]['metadata_json']['custody']='managed_attempt'
            with self.subTest(fault=fault),self.assertRaises(ValueError):self.read_ordinary()

    def test_classifier_legacy_unknown_cannot_replace_exact_eligibility(self):
        for fault in ('historical','extra','scope','schema','null_artifact'):
            self.configure_ordinary_population()
            original = self.post.side_effect
            def post(url, **kwargs):
                response = original(url,**kwargs)
                if url.endswith('/read_common_population_stage_custody'):
                    value = response.json.return_value
                    if fault=='historical':value['eligible']=False
                    elif fault=='extra':value['history']='untrusted'
                    elif fault=='scope':value['run_id']='foreign'
                    elif fault=='schema':value['schema']='unknown'
                    elif value['artifact_id'] is None:value['artifact_id']=self.writer.context.run_id
                return response
            self.post.side_effect = post
            with self.subTest(fault=fault),self.assertRaisesRegex(ValueError,'eligibility'):self.read_ordinary()

    def test_ordinary_unrelated_classifier_output_survives(self):
        _,_,artifacts,_,classified,_=self.configure_ordinary_population()
        classified['outputs'].append({'kind':'kpi','ownership_state':'legacy_unknown','record':{'id':'unrelated'}})
        self.assertEqual(self.read_ordinary()['artifacts'],artifacts)

    def test_bound_managed_consumer_never_downgrades_stage_custody(self):
        _,_,companions,_,_=self.configure_population()
        # Mutate the actual managed read's retained request through the origin
        # object shared with the fixture, then rebuild the response list.
        stages, artifacts, responses = self.configure()
        responses[0].json.return_value[0]['model_runs']['input_snapshot_json'] = {'commonPopulation':{
            'schema':'openplan.common-population-request.v1','mode':'reuse','custody':'legacy_stage_snapshot',
            'comparisonPolicy':'fixed_population_auto_trip_change','source':{
                **companions[0]['metadata_json']['origin'],'attemptId':None}}}
        with managed.bind(self.writer),patch.object(activity.requests,'get',side_effect=AssertionError('Legacy fallback')):
            with self.assertRaises(activity.WorkerStateReadUnconfirmed):activity.sb_get_run_artifacts(self.writer.context.run_id)
        self.assertTrue(self.writer.stopped)
