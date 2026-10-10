"""Native model-to-publication join using a copied, already-prepared development bundle."""
import csv
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
from unittest.mock import patch

SOURCE=Path('/home/nathaniel/code/openplan/data/agreement-study/runs/dev/08014/activitysim_bundle')
IMAGE='sha256:472ad0ab51bbea22ca5816941a7b9bc04375efc577ef2f164e2f4db46368f676'


def verify_native(worker,writer,run,stage,base,key,output,storage,sql,database):
    def inventory():
        return {str(p.relative_to(SOURCE)):hashlib.sha256(p.read_bytes()).hexdigest() for p in SOURCE.rglob('*') if p.is_file()}
    control=os.environ.get('OPENPLAN_NATIVE_PUBLICATION_CONTROL','normal')
    assert control in ('normal','harmless','drop-demand-matrix','wrong-corridor','restored')
    before=inventory()
    sys.path.insert(0,str(Path(worker.__file__).parents[2]/'scripts/modeling'))
    import run_behavioral_demand_prototype as pipeline
    supplied=[]
    def prepared_bundle(**kwargs):
        assert kwargs['population_source']=='census' and kwargs['config_package']=='mtc'
        target=Path(kwargs['output_dir'])
        assert target.is_relative_to(output/'stage-work') and not target.exists()
        shutil.copytree(SOURCE,target)
        settings=target/'configs/settings.yaml'
        text=settings.read_text()
        assert text.count('households_sample_size: 0')==1
        settings.write_text(text.replace('households_sample_size: 0','households_sample_size: 100'))
        manifest=json.loads((target/'manifest.json').read_text())
        population=manifest['synthetic_population']
        supplied.append(str(target))
        return {'output_dir':str(target),'manifest_path':str(target/'manifest.json'),
            'bundle_files':manifest['files'],'land_use_rows':manifest['land_use']['rows'],
            'households':population['households'],'persons':population['persons'],'skim_mode':'copy',
            'population':{'status':population['status'],'method':population['method'],'fallback_reason':None},
            'config_package':{'name':'mtc','status':manifest['config_package']['package_status'],'runnable':True},
            'caveats':manifest['caveats']}
    config={'activitysim_container_image':IMAGE,'container_memory_bytes':1610612736,'container_tasks':32,
        'container_supervision_socket':'/run/docker.sock','container_network_mode':'none',
        'activitysim_container_cli_template':'env OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMBA_NUM_THREADS=1 activitysim run -c {config_dir} -c /openplan/stock_configs -d {data_dir} -o {output_dir} -w {working_dir}'}
    if control=='harmless':config['run_label']='harmless-native-publication'
    original_artifact=worker.sb_post_artifact
    def record_artifact(payload):
        if control=='drop-demand-matrix' and payload['artifact_type']=='activitysim_demand_matrix':return None
        return original_artifact(payload)
    source_manifest=json.loads((SOURCE/'metadata/source_screening_bundle_manifest.json').read_text())
    west,south,east,north=source_manifest['boundary']['bbox']
    corridor={'type':'Polygon','coordinates':[[[west,south],[east,south],[east,north],[west,north],[west,south]]]}
    if control=='wrong-corridor':
        assert os.environ.get('OPENPLAN_STAGE_USE_ENTRY')=='1'
        for point in corridor['coordinates'][0]: point[0] += 1
    headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'}
    with patch.object(worker,'sb_post_artifact',record_artifact), patch.object(pipeline,'build_activitysim_input_bundle',prepared_bundle), patch.object(worker,'_activitysim_exec_config',return_value=config), patch.object(worker,'SUPABASE_URL',base), patch.object(worker,'SUPABASE_KEY',key), patch.object(worker,'HEADERS',headers), patch.object(worker,'ACTIVITYSIM_WORK_DIR',str(output/'stage-work')):
        use_entry=os.environ.get('OPENPLAN_STAGE_USE_ENTRY') == '1'
        if use_entry:
            assert writer.read_run(run, expected_stage_name=worker.STAGE_BUNDLE_PREFLIGHT)['corridor_geojson']==corridor, 'Native entry geography differs from prepared bundle'
            worker.process_stage({'id':stage,'run_id':run,'stage_name':worker.STAGE_BUNDLE_PREFLIGHT})
        else:
            result=worker.run_bundle_and_preflight_stage(run,{'id':run,'corridor_geojson':corridor},stage)
        assert len(supplied)==1
        artifacts=json.loads(sql(database,f"SELECT jsonb_agg(to_jsonb(a)) FROM public.model_run_artifacts a WHERE stage_id='{stage}';"))
        assert {a['artifact_type'] for a in artifacts}=={'evidence_packet','activitysim_demand_package_manifest','activitysim_demand_matrix','activitysim_demand_zones'}, 'Native demand artifact inventory differs'
        assert len(artifacts)==4 and all(a['attempt_id']==writer.context.attempt_id for a in artifacts)
        for artifact in artifacts:
            reference=artifact['file_url']
            data=storage[reference.removeprefix('storage://')] if reference.startswith('storage://') else Path(reference.removeprefix('local://')).read_bytes()
            assert len(data)==artifact['file_size_bytes'] and hashlib.sha256(data).hexdigest()==artifact['content_hash']
            if artifact['artifact_type']=='evidence_packet':assert json.loads(data)['is_forecast'] is False
        runtime=Path(supplied[0]).parent/'runtime'
        summary=json.loads((runtime/'runtime_summary.json').read_text())
        assert summary['status']=='succeeded' and summary['mode']=='activitysim_container_cli'
        assert (runtime.with_name('runtime.container-custody')/'creation/removed.json').is_file()
        with (runtime/'output/final_trips.csv').open() as f:trips=sum(1 for _ in csv.DictReader(f))
        assert trips>0
        kpis=json.loads(sql(database,f"SELECT jsonb_agg(to_jsonb(k)) FROM public.model_run_kpis k WHERE run_id='{run}';"))
        assert all(k['attempt_id']==writer.context.attempt_id for k in kpis)
        if not use_entry:
            worker.sb_patch_stage(stage,{'status':'succeeded','log_tail':result['log']})
        assert sql(database,f"SELECT status FROM public.model_runs WHERE id='{run}';")=='succeeded'
    assert inventory()==before,'Original development bundle changed'
    return {'control':'native-stage-publication','trip_rows':trips,'artifacts':len(artifacts),'kpis':len(kpis),
        'admitted_entry':use_entry,'native_model_executed':True,'container_removed':True,'source_bundle_unchanged':True,
        'source_bundle_sha256':hashlib.sha256(json.dumps(before,sort_keys=True).encode()).hexdigest(),
        'image_id':IMAGE,'scientific_acceptance':'unassessed',
        'limits':'Prepared bundle builder is replaced with a copied development bundle and 100-household sample; actual native runtime, ingestion, demand packaging and managed database writes. Synthetic Storage bytes. No Census rebuild, automatic poll enrollment, full population or scientific acceptance.'}
