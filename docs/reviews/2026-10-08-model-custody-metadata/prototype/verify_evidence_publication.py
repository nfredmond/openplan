"""Run atomic-publication candidate and mutations in rollback-only transactions."""
from pathlib import Path
import json
import os
import re
import subprocess
import uuid

ROOT=Path(__file__).resolve().parent


def verify():
    meta=json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if not re.fullmatch('openplan_attempt_cli_[0-9a-f]{32}',meta['database']) or meta['container']!='supabase_db_openplan-restore-target-2026091050':
        raise ValueError('Select only the named owned proof database')
    fixture=str(uuid.UUID(meta['fixture_run']))
    source=(ROOT/'evidence-publication.sql').read_text()
    cases=(ROOT/'evidence-publication-cases.sql').read_text()+'\n'+(ROOT/'evidence-publication-assessment-cases.sql').read_text()
    mutations=[
      ('assessment-track-bypass',"OR bound_assessment->>'track' IS DISTINCT FROM p_track",'OR false','Other-track assessment publication accepted'),
      ('assessment-acknowledgement-bypass',"IF assessment->>'validation_evidence_write' IS DISTINCT FROM 'recorded'\n   OR jsonb_typeof(assessment->'validation_custody_receipt') IS DISTINCT FROM 'object' THEN",'IF false THEN','Unconfirmed assessment publication accepted'),
      ('assessment-reference-bypass',"IF bound_assessment IS NULL OR bound_assessment IS DISTINCT FROM assessment->'validation_custody_receipt'", "IF false AND (bound_assessment IS NULL OR bound_assessment IS DISTINCT FROM assessment->'validation_custody_receipt')", 'Unbound publication receipt accepted'),
      ('assessment-metadata-bypass',"IF NOT(assessment ? text_key) OR NOT(assessment_metadata ? text_key)\n    OR assessment->text_key IS DISTINCT FROM assessment_metadata->text_key THEN", 'IF false THEN', 'Unbound publication metadata accepted'),
      ('stopped-run-bypass',"IF parent.status IN ('failed','cancelled') THEN",'IF false THEN','Stopped run publication accepted'),
      ('prior-modeling_claim_decisions-workspace_id','c.workspace_id IS DISTINCT FROM p_workspace','false','Ambiguous evidence read accepted: modeling_claim_decisions workspace_id'),
      ('prior-modeling_claim_decisions-county_run_id','c.county_run_id IS NOT NULL','false','Ambiguous evidence read accepted: modeling_claim_decisions county_run_id'),
      ('prior-modeling_validation_results-workspace_id','m.workspace_id IS DISTINCT FROM p_workspace','false','Ambiguous evidence read accepted: modeling_validation_results workspace_id'),
      ('prior-modeling_validation_results-county_run_id','m.county_run_id IS NOT NULL','false','Ambiguous evidence read accepted: modeling_validation_results county_run_id'),
      ('request-payload-bypass',"IF receipt.request_payload IS DISTINCT FROM request THEN","IF false THEN",'Changed request accepted'),
      ('stale-snapshot-bypass',"IF previous IS DISTINCT FROM p_expected THEN","IF false THEN",'Stale evidence accepted'),
      ('history-discarded','VALUES(p_request,p_run,p_track,request,previous,result);',"VALUES(p_request,p_run,p_track,request,'{}'::jsonb,result);",'Prior evidence not retained'),
      ('retry-receipt-lost','RETURN receipt.response_payload;',"RETURN '{}'::jsonb;",'Exact retry changed publication'),
      ('direct-write-bypass','IF EXISTS(\n  SELECT 1 FROM public.model_evidence_publication_receipts r','IF false AND EXISTS(\n  SELECT 1 FROM public.model_evidence_publication_receipts r','Direct claim update accepted'),
      ('read-scope-bypass','WHERE id=p_run AND workspace_id=p_workspace','WHERE id=p_run','Wrong read workspace accepted'),
      ('duplicate-metric-bypass',"IF (SELECT count(*) FROM jsonb_array_elements(p_payload->'metrics'))<>","IF false AND (SELECT count(*) FROM jsonb_array_elements(p_payload->'metrics'))<>",'Duplicate metric accepted'),
      ('prior-reasons-retained',"reasons_json='[]'::jsonb,",'', 'Replacement retained prior current reasons'),
      ('metric-text-type-bypass',"jsonb_typeof(metric->text_key) IS DISTINCT FROM 'string' OR ",'','Invalid metric text accepted: metric_key true'),
      ('metric-blank-bypass'," OR btrim(metric->>text_key)=''",'','Invalid metric text accepted: metric_key " "'),
    ]
    variants=[('baseline',source,None),('harmless',source+'\n-- Harmless publication comment.\n',None)]
    for name,before,after,error in mutations:
        if source.count(before)!=1:
            raise AssertionError('Mutation target is not unique: '+name)
        variants.append((name,source.replace(before,after,1),error))
    variants.append(('restored',source,None))
    results=[]
    command=['docker','exec','-i',meta['container'],'psql','-X','-qAt','-U','postgres','-d',meta['database'],'-v','ON_ERROR_STOP=1']
    for name,sql,error in variants:
        script="BEGIN; SET LOCAL openplan.proof_fixture='"+fixture+"';\n"+sql+'\n'+cases+'\nROLLBACK;\n'
        result=subprocess.run(command,input=script,text=True,capture_output=True,timeout=30)
        if error is None:
            if result.returncode or 'atomic-publication:' not in result.stderr:
                raise AssertionError(name+': '+result.stderr)
        elif result.returncode==0 or error not in result.stderr:
            raise AssertionError(name+': '+result.stderr)
        results.append({'case':name,'exit':result.returncode,'expected_error':error})
    probe=subprocess.run(command,input="SELECT to_regclass('public.model_evidence_publication_receipts') IS NULL AND to_regclass('public.model_evidence_publication_context') IS NULL;",text=True,capture_output=True,timeout=20)
    if probe.returncode or probe.stdout.strip()!='t':
        raise AssertionError('Rollback cleanup not confirmed')
    output=Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT']).resolve()
    output.mkdir(mode=0o700,parents=True,exist_ok=True)
    evidence={'cases':results,'rollback_cleanup_confirmed':True,'scope':'Actual installed candidate tables and triggers, synthetic legacy evidence; new objects and rows rolled back. No migration installation, concurrency, HTTP, worker adoption, county publication, higher-tier policy or managed scientific ingestion proof.'}
    (output/'atomic-publication.json').write_text(json.dumps(evidence,indent=2)+'\n')
    return evidence

if __name__=='__main__':
    print(json.dumps(verify(),indent=2))
