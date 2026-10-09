"""Join the existing scaffold stage handler to native managed output commands."""
import hashlib
import inspect
import json
import os
import shutil
from unittest.mock import patch


def verify_stage(worker, writer, run, stage, base, key, output, storage, sql, database, control):
    if control=='source-registration':
        from verify_native_source_registration import verify
        return verify(writer,output,sql,database,base,key)
    if control=='instrument':
        from verify_native_instrument_writer import verify_instrument
        return verify_instrument(writer,run,stage,output,sql,database)
    if control=='native':
        from verify_activity_native_publication import verify_native
        return verify_native(worker,writer,run,stage,base,key,output,storage,sql,database)
    assert control in ('normal', 'harmless', 'drop-kpi', 'drop-artifact', 'drop-terminal', 'restored', 'lost-reply', 'lost-reply-harmless', 'lost-reply-bypass-stop', 'lost-reply-restored', 'lost-reply-wrong-request')
    assert shutil.which('activitysim') is None, 'No implicit native CLI allowed'
    assert not any(value for name,value in os.environ.items() if name.startswith('ACTIVITYSIM_')), 'Proof requires unconfigured execution environment'
    corridor={'type':'Polygon','coordinates':[[[-121.71,38.54],[-121.69,38.54],[-121.69,38.56],[-121.71,38.56],[-121.71,38.54]]]}
    handler=worker.run_bundle_and_preflight_stage
    if control in ('harmless','lost-reply-harmless'):
        scope=dict(worker.__dict__)
        exec(compile(inspect.getsource(handler)+'\n# Harmless source comment.\n',worker.__file__,'exec'),scope)
        handler=scope[handler.__name__]
    headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'}
    original_kpi=worker.sb_post_kpi
    def record_kpi(payload):
        if control=='drop-kpi' and payload['kpi_name']=='activitysim_runtime_mode':
            return None
        return original_kpi(payload)
    original_artifact=worker.sb_post_artifact
    original_stage=worker.sb_patch_stage
    def record_artifact(payload):
        return None if control=='drop-artifact' else original_artifact(payload)
    def patch_stage(identity,payload):
        if control=='drop-terminal' and payload.get('status')=='succeeded':
            return None
        return original_stage(identity,payload)
    with patch.object(worker,'sb_post_artifact',record_artifact), patch.object(worker,'sb_patch_stage',patch_stage), patch.object(worker,'SUPABASE_URL',base), patch.object(worker,'SUPABASE_KEY',key), patch.object(worker,'HEADERS',headers), patch.object(worker,'ACTIVITYSIM_WORK_DIR',str(output/'stage-work')), patch.object(worker,'sb_post_kpi',record_kpi):
        # The harmless compiled function needs the same operator settings and adapter.
        if control in ('harmless','lost-reply-harmless'):
            handler.__globals__.update({name:getattr(worker,name) for name in ('SUPABASE_URL','SUPABASE_KEY','HEADERS','ACTIVITYSIM_WORK_DIR','sb_post_kpi','sb_post_artifact','sb_patch_stage')})
        if control.startswith('lost-reply'):
            from verify_activity_publication_uncertainty import verify_lost_reply
            return verify_lost_reply(worker,writer,handler,run,stage,corridor,base,key,output,sql,database,control)
        use_entry = os.environ.get('OPENPLAN_STAGE_USE_ENTRY') == '1'
        if use_entry:
            with patch.dict(worker.STAGE_DISPATCH, {worker.STAGE_BUNDLE_PREFLIGHT: handler}):
                worker.process_stage({'id': stage, 'run_id': run, 'stage_name': worker.STAGE_BUNDLE_PREFLIGHT})
        else:
            result=handler(run,{'id':run,'corridor_geojson':corridor},stage)
        artifacts=json.loads(sql(database,f"SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') FROM public.model_run_artifacts a WHERE stage_id='{stage}';"))
        kpis=json.loads(sql(database,f"SELECT coalesce(jsonb_agg(to_jsonb(k)),'[]') FROM public.model_run_kpis k WHERE run_id='{run}';"))
        assert len(artifacts)==1 and artifacts[0]['artifact_type']=='evidence_packet', 'Stage evidence registration differs'
        evidence=artifacts[0]
        assert evidence['attempt_id']==writer.context.attempt_id
        content=storage[evidence['file_url'].removeprefix('storage://')]
        assert len(content)==evidence['file_size_bytes'] and hashlib.sha256(content).hexdigest()==evidence['content_hash']
        packet=json.loads(content)
        assert packet['is_forecast'] is False
        names={row['kpi_name'] for row in kpis}
        assert names=={'activitysim_runtime_mode','activitysim_bundle_zones','activitysim_bundle_synthetic_households','activitysim_bundle_synthetic_persons'}, 'Stage KPI inventory differs'
        assert all(row['attempt_id']==writer.context.attempt_id for row in kpis)
        mode=next(row for row in kpis if row['kpi_name']=='activitysim_runtime_mode')
        assert mode['value'] is None and mode['breakdown_json']['mode']=='preflight_only'
        if not use_entry:
            worker.sb_patch_stage(stage,{'status':'succeeded','log_tail':result['log']})
        state=json.loads(sql(database,f"SELECT jsonb_build_object('run',r.status,'stage',s.status) FROM public.model_runs r JOIN public.model_run_stages s ON s.run_id=r.id WHERE s.id='{stage}';"))
        assert state=={'run':'succeeded','stage':'succeeded'}, 'Managed terminal transaction did not complete run'
    return {'control':'actual-stage-publication','evidence_artifacts':1,'structural_kpis':4,'native_model_executed':False,'terminal_state':state,'storage_backend':'synthetic HTTP byte service'}
