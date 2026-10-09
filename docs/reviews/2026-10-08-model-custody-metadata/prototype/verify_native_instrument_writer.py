"""Native artifact-relationship checks for the admitted instrument writer."""
import hashlib
import json
import os
from unittest.mock import patch

ROLES=(('model_output','synthetic_output','synthetic.output'),
       ('input_bundle','validation_input_bundle_v2','openplan.validation-input-bundle.v2'),
       ('match_audit','pre_volume_match_audit_v2','openplan.pre-volume-observation-match-audit.v2'),
       ('comparison_basis','model_comparison_basis_v2','openplan.model-comparison-basis.v2'),
       ('assessment','model_validation_assessment_v2','openplan.model-validation-assessment.v2'),
       ('diagnosis','model_validation_structural_diagnosis_v2','openplan.model-validation-structural-diagnosis.v2'))


def verify_instrument(writer,run,stage,output,sql,database):
    control=os.environ.get('OPENPLAN_NATIVE_INSTRUMENT_CONTROL','normal')
    assert control in ('normal','harmless','drop-write','restored')
    directory=writer.workspace(output/'instrument-files',run)
    digest=hashlib.sha256(b'').hexdigest()
    results=[]
    original=writer.record_instrument
    def record(payload,**kwargs):
        if control=='drop-write':return {}
        return original(payload,**kwargs)
    with patch.object(writer,'record_instrument',record):
        for method in ('aequilibrae','activitysim'):
            payload={'demand_method':method,'scientific_outcome':'inconclusive'}
            for role,kind,schema in ROLES:
                path=directory/(method+'-'+role+'.synthetic')
                path.write_bytes(b'')
                artifact=writer.record_artifact({'run_id':run,'stage_id':stage,'artifact_type':kind,
                    'file_url':'local://'+str(path),'file_size_bytes':0,'content_hash':digest,
                    'metadata_json':{'schema':schema,'demand_method':method,'fixture':'empty bytes; not an assessed instrument'}})
                payload[role+'_artifact_id']=artifact['id'];payload[role+'_sha256']=digest
            name=('harmless-' if control=='harmless' else '')+method
            first=writer.record_instrument(payload,logical_name=name)
            second=writer.record_instrument(payload,logical_name=name)
            assert second==first,'Exact native instrument receipt changed'
            results.append((payload,first))
    rows=json.loads(sql(database,f"SELECT coalesce(jsonb_agg(to_jsonb(i)),'[]') FROM public.model_attempt_instrument_custody i WHERE model_run_id='{run}';"))
    assert len(rows)==2,'Native instrument records missing'
    assert {row['demand_method'] for row in rows}=={'aequilibrae','activitysim'}
    for payload,receipt in results:
        row=next(row for row in rows if row['demand_method']==payload['demand_method'])
        assert receipt==row,'Native custody differs from checked receipt'
        assert row['attempt_id']==writer.context.attempt_id and row['stage_id']==stage
        assert row['workspace_id']==writer.context.workspace_id and row['scientific_outcome']=='inconclusive'
        for key,value in payload.items():assert row[key]==value
    assert sql(database,f"SELECT count(*) FROM public.model_run_artifacts WHERE stage_id='{stage}';")=='12'
    return {'control':'native-instrument-writer','separate_methods':2,'attempt_bound_artifacts':12,
        'exact_receipts_reused':True,'scientific_outcome':'inconclusive',
        'limits':'Native database relationship checks over empty synthetic artifact files; no prepared instrument content, scientific assessment, normal dispatcher or Storage acceptance.'}
