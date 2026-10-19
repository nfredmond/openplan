"""Prepared supplied-file controls for the behavioral population handoff.

The HTTP classifier and custody RPC have separate supplied-response controls.
These exercise pinned copies, common readers, the bundle builder and demand
conversion with synthetic fixture records. All execution remains unassessed.
"""
import copy
import csv
import hashlib
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

with patch.dict(os.environ, {"SUPABASE_URL": "http://127.0.0.1:1", "SUPABASE_SERVICE_ROLE_KEY": "synthetic-test-only"}):
    import supabase_poll as worker

import model_attempt_writer
from model_common_population_package import identity, population_library, read_package_population

MODELING_TESTS = Path(__file__).resolve().parents[2] / "scripts" / "modeling" / "tests"
if str(MODELING_TESTS) not in sys.path:
    sys.path.insert(0, str(MODELING_TESTS))
import test_common_population as supplied

RUN = "11111111-1111-4111-8111-111111111111"
SETUP = "22222222-2222-4222-8222-222222222222"
ATTEMPT = "33333333-3333-4333-8333-333333333333"
CONSUMER = "44444444-4444-4444-8444-444444444444"


class BehavioralPopulationHandoffTests(unittest.TestCase):
    def setUp(self):
        self.fixture = supplied.CommonPopulationTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.common = population_library()
        self.fixture.source.write_text(json.dumps({'run_name':'Supplied fixture','custody':'managed_attempt'}))
        self.shared = self.fixture.root / "shared"
        self.fixture.directory = self.shared / "runs" / RUN / "setup" / "common_population"
        self.descriptor = self.fixture.retain()
        self.loaded = self.fixture.read(self.descriptor)
        self.origin = {"modelRunId":"55555555-5555-4555-8555-555555555555",
            "artifactId":"66666666-6666-4666-8666-666666666666", "stageId":"77777777-7777-4777-8777-777777777777",
            "attemptId":"88888888-8888-4888-8888-888888888888", "sha256":self.descriptor["sha256"], "sizeBytes":self.descriptor["bytes"]}
        self.metadata = {"schema":self.common.SCHEMA, **identity(self.loaded), "origin":self.origin,
                         "custody":"managed_attempt", "scientific_acceptance":"unassessed"}
        self.request = {"schema":"openplan.common-population-request.v1", "mode":"reuse",
                        "comparisonPolicy":"fixed_population_auto_trip_change", "source":self.origin,"custody":"managed_attempt"}
        self.run = {"id":RUN, "input_snapshot_json":{"commonPopulation":self.request},
                    "corridor_geojson":{"type":"Polygon","coordinates":[[[0,0],[0,1],[1,1],[0,0]]]}}
        self.execution = self.fixture.root / "execution"
        self.execution.mkdir()
        self.writer = Mock()
        self.writer.files.path = self.execution
        self.writer.read_run.return_value = self.run
        self.writer.stopped = False
        self.inventory = []
        files = [("common_population", self.common.MANIFEST_NAME),
                 *[("common_population_"+role, path) for role,path in self.common.ROLES.items()]]
        for index,(kind,path) in enumerate(files):
            source = self.fixture.directory / path
            self.inventory.append({"id":f"99999999-9999-4999-8999-{index:012d}", "run_id":RUN,
                "stage_id":SETUP, "attempt_id":ATTEMPT, "artifact_type":kind, "file_url":"local://"+str(source),
                "file_size_bytes":source.stat().st_size, "content_hash":hashlib.sha256(source.read_bytes()).hexdigest(),
                "metadata_json":copy.deepcopy(self.metadata), "model_run_stages":{"id":SETUP,"run_id":RUN,
                    "status":"succeeded","attempt_managed":True,"active_attempt_id":ATTEMPT}})
        environment = patch.dict(os.environ, {"AEQ_WORK_DIR":str(self.shared)})
        environment.start()
        self.addCleanup(environment.stop)
        current = patch.object(model_attempt_writer,"current",return_value=self.writer)
        current.start()
        self.addCleanup(current.stop)

    def retain(self, inventory=None, after=None):
        inventory = self.inventory if inventory is None else inventory
        with patch.object(worker,"sb_get_run_artifacts",side_effect=[inventory,
                inventory if after is None else after,inventory if after is None else after]):
            return worker._retain_common_population(inventory,RUN,str(self.execution),self.fixture.zones)

    def test_actual_pinned_copies_reader_and_identity_without_fetch_or_fit(self):
        import census_pums as cp
        with patch.object(cp,"_get_json",side_effect=AssertionError("unexpected fetch")) as fetch:
            record = self.retain()
        fetch.assert_not_called()
        self.assertEqual(record["manifest"],self.descriptor)
        self.assertEqual(record["origin"],self.origin)
        self.assertEqual(record["population_basis_digest"],self.metadata["population_basis_digest"])
        for path in (self.common.MANIFEST_NAME,*self.common.ROLES.values()):
            self.assertEqual((self.execution/"common_population"/path).read_bytes(),(self.fixture.directory/path).read_bytes())
        self.writer.files.verify.assert_called()

    def test_missing_companion_refuses_before_population_directory(self):
        with self.assertRaisesRegex(RuntimeError,"exactly seven"):
            self.retain(self.inventory[:-1])
        self.assertFalse((self.execution/"common_population").exists())

    def test_registered_companion_hash_refuses_changed_source_bytes(self):
        path = self.fixture.directory / "persons.csv"
        path.write_bytes(path.read_bytes()+b"changed\n")
        with self.assertRaisesRegex(RuntimeError,"copy was not confirmed"):
            self.retain()
        self.assertTrue(self.writer.stopped)

    def test_population_source_directory_symlink_alias_refuses(self):
        alias = self.fixture.directory.parent/"alias"
        alias.symlink_to(self.fixture.directory,target_is_directory=True)
        inventory = copy.deepcopy(self.inventory)
        person = next(row for row in inventory if row["artifact_type"]=="common_population_persons")
        person["file_url"] = "local://"+str(alias/"persons.csv")
        with self.assertRaisesRegex(RuntimeError,"path aliases"):
            self.retain(inventory)

    def test_consistent_but_false_registered_identity_is_recomputed(self):
        inventory = copy.deepcopy(self.inventory)
        for row in inventory:row["metadata_json"]["population_basis_digest"] = "0"*64
        with self.assertRaisesRegex(RuntimeError,"identity differs from retained rosters"):
            self.retain(inventory)

    def test_revocation_snapshot_after_copy_preserves_files_and_refuses(self):
        after = copy.deepcopy(self.inventory)
        after[0]["model_run_stages"]["active_attempt_id"] = RUN
        with self.assertRaisesRegex(RuntimeError,"ownership changed during file copy"):
            self.retain(after=after)
        self.assertEqual((self.execution/"common_population"/"persons.csv").read_bytes(),(self.fixture.directory/"persons.csv").read_bytes())

    def test_harmless_source_metadata_is_retained_as_exact_bytes(self):
        # The fixture's unrelated source note survives the complete copy path.
        record = self.retain()
        loaded = self.common.read_common_population(Path(record["directory"]),expected_manifest=record["manifest"],zone_rows=self.fixture.zones)
        self.assertEqual(loaded["source_manifest"]["run_name"],"Supplied fixture")

    def test_stage_forwards_only_verified_directory_and_manifest_without_key(self):
        import run_behavioral_demand_prototype as prototype

        setup_root = self.fixture.directory.parent
        ordinary = {"skim_matrix":("skim.omx",b"supplied-skim"),
                    "zone_attributes":("zone_attributes.csv",self.fixture.zone_file.read_bytes()),
                    "network_setup_summary":("network_setup_summary.json",b'{"centroid_map":{"7":7,"9":9}}')}
        inventory = list(self.inventory)
        for index,(kind,(name,data)) in enumerate(ordinary.items(),start=20):
            source = setup_root/name
            source.write_bytes(data)
            inventory.append({"id":f"99999999-9999-4999-8999-{index:012d}","run_id":RUN,
                "stage_id":SETUP,"attempt_id":ATTEMPT,"artifact_type":kind,"file_url":"local://"+str(source),
                "file_size_bytes":len(data),"content_hash":hashlib.sha256(data).hexdigest(),"metadata_json":{},
                "model_run_stages":{"id":SETUP,"run_id":RUN,"status":"succeeded","attempt_managed":True,"active_attempt_id":ATTEMPT}})

        class StopAtPipeline(RuntimeError):pass
        with patch.object(worker,"sb_get_run_artifacts",return_value=inventory), \
                patch.object(worker,"create_run_workspace",return_value=str(self.execution)), \
                patch.object(worker,"sb_patch_stage"),patch.object(worker,"_activitysim_exec_config",return_value={}), \
                patch.object(prototype,"run_behavioral_demand_prototype",side_effect=StopAtPipeline("captured")) as pipeline:
            with self.assertRaises(StopAtPipeline):worker.run_bundle_and_preflight_stage(RUN,self.run,CONSUMER)
        args = pipeline.call_args.kwargs
        self.assertEqual(args["retained_population"],{"directory":str(self.execution/"common_population"),"manifest":self.descriptor})
        self.assertEqual(args["population_source"],"census")
        self.assertEqual(args["config_package"],"starter")
        self.assertNotIn("census_api_key",args)

    def ordinary_http_fixture(self, source_custody='legacy_stage_snapshot'):
        """Supply real ordinary rows and independent service attestations."""
        from model_activitysim_handoff import RUN_PROJECTION
        self.fixture.source.write_text(json.dumps({'run_name':'Supplied fixture','custody':source_custody}))
        self.fixture.directory = self.fixture.directory.parent/'ordinary_common_population'
        self.descriptor = self.fixture.retain()
        self.loaded = self.fixture.read(self.descriptor)
        self.origin['attemptId'] = None
        self.origin.update(sha256=self.descriptor['sha256'],sizeBytes=self.descriptor['bytes'])
        self.request['custody'] = 'legacy_stage_snapshot'
        self.run = {**{key:None for key in RUN_PROJECTION.split(',')},**self.run,
            'workspace_id':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','status':'running','attempt_managed':False}
        for row in self.inventory:
            row['attempt_id'] = None
            name = self.common.MANIFEST_NAME if row['artifact_type']=='common_population' else self.common.ROLES[row['artifact_type'][len('common_population_'):]]
            path = self.fixture.directory/name
            row.update(file_url='local://'+str(path),file_size_bytes=path.stat().st_size,
                content_hash=hashlib.sha256(path.read_bytes()).hexdigest())
            row['metadata_json'].update(identity(self.loaded))
            row['metadata_json']['custody'] = 'legacy_stage_snapshot'
            row['metadata_json']['origin'] = copy.deepcopy(self.origin)
            row['model_run_stages'].update(attempt_managed=False,active_attempt_id=None)
        setup = {'id':SETUP,'run_id':RUN,'stage_name':'AequilibraE Setup','sort_order':10,
            'status':'succeeded','attempt_managed':False,'active_attempt_id':None}
        extraction = {**setup,'id':'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            'stage_name':'Artifact Extraction','sort_order':30}
        consumer = {**setup,'id':CONSUMER,'stage_name':worker.STAGE_BUNDLE_PREFLIGHT,
            'sort_order':40,'status':'running'}
        stages = [setup,extraction,consumer]
        ordinary = {'skim_matrix':('skim.omx',b'supplied-skim'),
            'zone_attributes':('zone_attributes.csv',self.fixture.zone_file.read_bytes()),
            'network_setup_summary':('network_setup_summary.json',b'{"centroid_map":{"7":7,"9":9}}')}
        for index,(kind,(name,data)) in enumerate(ordinary.items(),start=20):
            path = self.fixture.directory.parent/name
            path.write_bytes(data)
            self.inventory.append({'id':f'99999999-9999-4999-8999-{index:012d}','run_id':RUN,
                'stage_id':extraction['id'],'attempt_id':None,'artifact_type':kind,'file_url':'local://'+str(path),
                'file_size_bytes':len(data),'content_hash':hashlib.sha256(data).hexdigest(),
                'metadata_json':{},'model_run_stages':copy.deepcopy(extraction)})
        self.ordinary_attestations = []

        def response(value):return Mock(status_code=200,json=Mock(return_value=copy.deepcopy(value)))
        def get(url, **kwargs):
            table = url.rsplit('/',1)[-1]
            if table=='model_runs':
                self.assertEqual(kwargs['params'],{'id':'eq.'+RUN,'select':RUN_PROJECTION})
                return response([self.run])
            self.assertEqual(kwargs['params']['run_id'],'eq.'+RUN)
            if table=='model_run_stages':return response(stages)
            if table=='model_run_artifacts':return response(self.inventory)
            raise AssertionError('Unexpected ordinary GET: '+table)
        def post(url, **kwargs):
            if url.endswith('/read_model_attempt_outputs'):
                return response({'run_id':RUN,'run_status':'running','outputs':[
                    {'kind':'artifact','ownership_state':'legacy_unknown',
                     'record':{key:value for key,value in row.items() if key!='model_run_stages'}}
                    for row in self.inventory if row['artifact_type'].startswith('common_population')]})
            self.assertTrue(url.endswith('/read_common_population_stage_custody'))
            args = kwargs['json']
            self.assertEqual(args['p_workspace'],self.run['workspace_id'])
            self.assertEqual(args['p_run'],RUN)
            self.ordinary_attestations.append(copy.deepcopy(args))
            return response({'schema':'openplan.common-population-stage-custody.v1',
                'custody':'legacy_stage_snapshot','workspace_id':args['p_workspace'],'run_id':args['p_run'],
                'stage_id':args['p_stage'],'artifact_id':args['p_artifact'],'eligible':True})
        return get,post,stages

    def test_actual_ordinary_bundle_stage_reaches_real_retained_builder_and_demand_without_fit_or_refetch(self):
        import census_pums as cp
        import synthetic_population as synthesis
        import run_behavioral_demand_prototype as prototype
        from build_activitysim_input_bundle import build_activitysim_input_bundle
        get,post,_ = self.ordinary_http_fixture()
        built = []

        class StopAfterRealBuilder(BaseException):pass
        def build(**kwargs):
            built.append(build_activitysim_input_bundle(**kwargs))
            raise StopAfterRealBuilder()

        with patch.object(model_attempt_writer,'current',return_value=None), \
                patch.object(worker.requests,'get',side_effect=get),patch.object(worker.requests,'post',side_effect=post), \
                patch.object(worker,'create_run_workspace',return_value=str(self.execution)), \
                patch.object(worker,'sb_patch_stage'),patch.object(worker,'_activitysim_exec_config',return_value={}), \
                patch.object(worker,'sb_upload_evidence',side_effect=AssertionError('Unexpected publication')), \
                patch.object(prototype,'build_activitysim_input_bundle',side_effect=build), \
                patch.object(synthesis,'synthesize_study_area',side_effect=AssertionError('Unexpected second fit')) as fit, \
                patch.object(cp,'_get_json',side_effect=AssertionError('Unexpected source fetch')) as fetch, \
                patch.object(cp,'fetch_acs_school_enrollment',side_effect=AssertionError('Unexpected school refetch')) as school:
            with self.assertRaises(StopAfterRealBuilder):
                worker.run_bundle_and_preflight_stage(RUN,self.run,CONSUMER)
            record = {'directory':str(self.execution/'common_population'),'manifest':self.descriptor,
                **identity(self.loaded),'origin':self.origin,'custody':'legacy_stage_snapshot'}
            demand = worker._build_executed_demand_package(self.demand_inputs(),str(self.fixture.run),
                str(self.fixture.root/'ordinary-demand'),retained_population=record)
        fit.assert_not_called();fetch.assert_not_called();school.assert_not_called()
        self.assertEqual(len(built),1)
        bundle = Path(built[0]['output_dir'])
        manifest = json.loads((bundle/'manifest.json').read_text())
        self.assertEqual(manifest['synthetic_population']['common_population']['manifest'],self.descriptor)
        self.assertEqual(manifest['land_use']['total_population'],1)
        for path in (self.common.MANIFEST_NAME,*self.common.ROLES.values()):
            self.assertEqual((bundle/'metadata'/'common_population'/path).read_bytes(),(self.fixture.directory/path).read_bytes())
        screening = json.loads((self.execution/'screening'/'bundle_manifest.json').read_text())
        self.assertEqual(screening['common_population']['custody'],'legacy_stage_snapshot')
        demand_manifest = json.loads((Path(demand['output_dir'])/'manifest.json').read_text())
        self.assertEqual(demand_manifest['common_population'],{**record,'directory':'common_population'})
        self.assertEqual(read_package_population(Path(demand['output_dir'])),
            {**identity(self.loaded),'population_custody':'legacy_stage_snapshot'})
        self.assertTrue(self.ordinary_attestations)
        self.assertTrue(all(item['p_stage']==CONSUMER for item in self.ordinary_attestations if item['p_artifact'] is None))
        self.writer.require_open.assert_not_called()

    def test_ordinary_copy_rechecks_actual_consumer_and_source_before_and_after(self):
        get,post,stages = self.ordinary_http_fixture()
        with patch.object(model_attempt_writer,'current',return_value=None), \
                patch.object(worker.requests,'get',side_effect=get),patch.object(worker.requests,'post',side_effect=post):
            artifacts = worker.sb_get_run_artifacts(RUN,stage_id=CONSUMER,run=self.run)
            original = worker._retain_handoff_file
            def copy_then_revoke(*args,**kwargs):
                retained = original(*args,**kwargs)
                if args[1]=='common_population_source_zone_attributes':stages[-1]['status']='failed'
                return retained
            with patch.object(worker,'_retain_handoff_file',side_effect=copy_then_revoke), \
                    self.assertRaises(worker.WorkerStateReadUnconfirmed):
                worker._retain_common_population(artifacts,RUN,str(self.execution),self.fixture.zones,
                    stage_id=CONSUMER,run=self.run)
        self.assertTrue((self.execution/'common_population'/'persons.csv').exists())

    def test_ordinary_dispatch_snapshot_mismatch_refuses_before_copy(self):
        get,post,_ = self.ordinary_http_fixture()
        actual = copy.deepcopy(self.run)
        actual['assumption_snapshot_json'] = {'changed':True}
        with patch.object(model_attempt_writer,'current',return_value=None), \
                patch.object(worker.requests,'get',side_effect=get),patch.object(worker.requests,'post',side_effect=post), \
                self.assertRaises(worker.WorkerStateReadUnconfirmed):
            worker.sb_get_run_artifacts(RUN,stage_id=CONSUMER,run=actual)
        self.assertFalse((self.execution/'common_population').exists())

    def test_consistent_registered_legacy_metadata_cannot_relabel_managed_source_bytes(self):
        get,post,_ = self.ordinary_http_fixture(source_custody='managed_attempt')
        with patch.object(model_attempt_writer,'current',return_value=None), \
                patch.object(worker.requests,'get',side_effect=get),patch.object(worker.requests,'post',side_effect=post):
            artifacts = worker.sb_get_run_artifacts(RUN,stage_id=CONSUMER,run=self.run)
            with self.assertRaisesRegex(RuntimeError,'source and consumer custody disagree'):
                worker._retain_common_population(artifacts,RUN,str(self.execution),self.fixture.zones,
                    stage_id=CONSUMER,run=self.run)

    def test_ordinary_refuses_changed_custody_before_evidence_publication(self):
        import run_behavioral_demand_prototype as prototype
        get,post,stages = self.ordinary_http_fixture()
        def pipeline(**kwargs):
            stages[-1]['status']='failed'
            return {'pipeline_status':'prototype_preflight_complete','runtime_mode':'preflight_only','caveats':[]}
        with patch.object(model_attempt_writer,'current',return_value=None), \
                patch.object(worker.requests,'get',side_effect=get),patch.object(worker.requests,'post',side_effect=post), \
                patch.object(worker,'create_run_workspace',return_value=str(self.execution)), \
                patch.object(worker,'sb_patch_stage'),patch.object(worker,'_activitysim_exec_config',return_value={}), \
                patch.object(prototype,'run_behavioral_demand_prototype',side_effect=pipeline), \
                patch.object(worker,'sb_upload_evidence') as publish,patch.object(worker,'sb_record_retained_kpi') as kpi:
            with self.assertRaises(worker.WorkerStateReadUnconfirmed):
                worker.run_bundle_and_preflight_stage(RUN,self.run,CONSUMER)
        publish.assert_not_called();kpi.assert_not_called()

    def test_byte_verification_is_repeated_before_publication(self):
        record = self.retain()
        path = Path(record['directory'])/'persons.csv'
        path.write_bytes(path.read_bytes()+b'changed\n')
        with patch.object(worker,'sb_get_run_artifacts',return_value=self.inventory), \
                self.assertRaisesRegex(ValueError,'identity mismatch'):
            worker._recheck_common_population(self.inventory,RUN,CONSUMER,self.run,record,self.fixture.zones)

    def demand_inputs(self):
        trips = self.fixture.root/"final_trips.csv"
        trips.write_text("origin,destination,trip_mode\n7,9,DRIVEALONEFREE\n")
        ingestion = self.fixture.root/"ingestion.json"
        ingestion.write_text(json.dumps({"runtime":{"runtime_dir":str(self.fixture.root)},"common_tables":{"trips":{"relative_path":trips.name}}}))
        return {"ingestion_summary_path":str(ingestion),"manifest_path":"supplied-pipeline.json"}

    def test_executed_demand_uses_realized_counts_and_preserves_published_sources(self):
        record = self.retain()
        result = worker._build_executed_demand_package(self.demand_inputs(),str(self.fixture.run),str(self.fixture.root/"executed"),retained_population=record)
        package = Path(result["output_dir"])
        with (package/"zone_attributes.csv").open(newline="") as handle:rows=list(csv.DictReader(handle))
        self.assertEqual([(r["zone_id"],r["est_population"],r["households"],r["worker_residents"]) for r in rows],[("7","1","1","1"),("9","0","0","0")])
        self.assertEqual(rows[0]["source_est_population"],"100")
        manifest = json.loads((package/"manifest.json").read_text())
        self.assertEqual(manifest["common_population"],{**record,"directory":"common_population"})
        self.assertEqual(read_package_population(package),{**identity(self.loaded),"population_custody":"managed_attempt"})
        self.assertNotIn("nothing else",manifest["method_note"])
        for path in (self.common.MANIFEST_NAME,*self.common.ROLES.values()):
            self.assertEqual((package/"common_population"/path).read_bytes(),(self.fixture.directory/path).read_bytes())

    def test_bad_demand_population_identity_refuses_before_output(self):
        record = {**self.retain(),"population_basis_digest":"0"*64}
        with self.assertRaisesRegex(ValueError,"metadata differs"):
            worker._build_executed_demand_package(self.demand_inputs(),str(self.fixture.run),str(self.fixture.root/"bad-demand"),retained_population=record)
        self.assertFalse((self.fixture.root/"bad-demand"/"activitysim_demand_package").exists())

    def test_missing_forwarded_population_refuses_declared_guided_demand(self):
        self.fixture.source.write_text(json.dumps({"common_population":{"manifest":self.descriptor}}))
        with self.assertRaisesRegex(RuntimeError,"requires the verified retained population"):
            worker._build_executed_demand_package(self.demand_inputs(),str(self.fixture.run),str(self.fixture.root/"missing"))


if __name__ == "__main__":unittest.main()
