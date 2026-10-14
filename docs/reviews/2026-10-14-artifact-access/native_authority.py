"""Check separate delivery authority in one retained clone of selected schema409."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

PG='a79d62deecea7fd1d1099b35863ca3de50ef7f44618c3c130c9f5b34b024bed3'
IMAGE='sha256:ca7871b587ca2c401ac0f325df6249c9aa0d25647ded34631158efc51176767f'
SOURCE='odm_output_68adf5426c164b71b653efeb24d42c9a'
PROFILE=Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/odm-output-schema-recovery-20261014/main41c-controls-01/baseline-private')
MIGRATION='openplan/supabase/migrations/20261017000012_aerial_delivery_authority.sql'
ARTIFACT='original_application_artifact_download'
TERMINAL='original_application_terminal_delivery'


def quote(value):return "'"+str(value).replace("'","''")+"'"


def run(repo,out):
    os.umask(0o077);out.mkdir(mode=0o700,parents=True)
    state=json.loads(subprocess.check_output(['docker','inspect',PG]))[0]
    assert not state['State']['Running'],'Owned cluster must be stopped before admission'
    assert state['Id']==PG and state['Image']==IMAGE and state['Config']['Labels'].get('openplan.purpose')=='odm-private-dispatch-rpc-cli-20261012','Original owned cluster identity'
    assert state['HostConfig']['Memory']==state['HostConfig']['MemorySwap']==1073741824 and not state['HostConfig']['PortBindings'],'Owned cluster keeps1GiB/zero swap/no ports'
    db='odm_delivery_'+uuid.uuid4().hex
    original=json.loads(next((PROFILE/'upgraded-runtime').glob('original-dispatch-*/receipt.json')).read_text())
    job=original['applicationJob'];sequence=0
    prefix=['docker','exec','-i',PG,'psql','-U','postgres','-XqAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
    def sql(text,target=db,expected=0):
        nonlocal sequence
        sequence+=1;r=subprocess.run(prefix+['-d',target],input=text,text=True,capture_output=True,timeout=15)
        (out/(str(sequence).zfill(4)+'-sql-private.log')).write_text(r.stdout+r.stderr)
        if expected is not None:assert r.returncode==expected,'Delivery SQL returns expected exit'
        return r
    saved=None
    def rpc(operation=ARTIFACT,callback=None,scope=None):
        arguments=[saved['request_id'],saved['installation_id'],saved['target_id'],'odm-original-native-delivery',operation]
        if scope is not None:arguments[scope]='other-original'
        args=','.join(quote(v) for v in arguments)+','+('NULL' if callback is None else quote(json.dumps(callback))+'::jsonb')
        return 'public.read_aerial_delivery_authority('+args+')'
    def observed(setup='',operation=ARTIFACT,callback=None):
        r=sql('BEGIN;'+update("job_reference='odm-original-native-delivery'")+setup+'SET LOCAL ROLE service_role;SELECT '+rpc(operation,callback)+'::text;ROLLBACK;')
        value=json.loads(r.stdout.strip());assert value['applicationJob']==job and value['payloadSha256']==original['payloadSha256'],'Delivery returns exact original job/dispatch'
        assert value['operation']==operation and value['engineTransportPermission'] is False,'Delivery scope cannot grant processing'
        return value['authorizedNow']
    job_where=' WHERE id='+quote(job['id'])+';'
    update=lambda fields:'UPDATE public.aerial_processing_jobs SET '+fields+job_where
    callback={'schemaVersion':json.loads(original['payloadText'])['schemaVersion'],'requestId':job['request_id'],'jobReference':'odm-original-native-delivery','callbackId':'original-native-terminal','status':'succeeded','occurredAt':'2026-10-14T14:00:00Z','artifacts':[]}
    terminal_setup=update("status='succeeded',job_reference="+quote(callback['jobReference'])+',last_callback_id='+quote(callback['callbackId'])+',last_callback_at='+quote(callback['occurredAt']))
    terminal_setup+='INSERT INTO public.aerial_processing_callbacks(processing_job_id,workspace_id,callback_id,status,occurred_at,payload) VALUES ('+','.join(quote(v) for v in [job['id'],job['workspace_id'],callback['callbackId'],'succeeded',callback['occurredAt']])+','+quote(json.dumps(callback))+'::jsonb);'
    probes=[]
    def probe(name):
        if name=='status':
            for status in ('requested','accepted','running','succeeded','failed','canceled'):
                allowed=observed(update('status='+quote(status)))
                assert allowed==(status in ('requested','accepted','running','succeeded')),'Artifact scope accepts active/succeeded and refuses failed/canceled'
        elif name=='reference':
            assert observed(update("status='succeeded',job_reference='changed-reference'")) is False,'Changed worker reference refuses original artifact access'
            assert observed(update("status='succeeded',job_reference=NULL")) is False,'Completed original delivery requires its worker reference'
            assert observed(update("status='requested',job_reference=NULL")) is True,'Requested original job can prepare delivery before acceptance'
        elif name=='processing':
            value=json.loads(sql('BEGIN;'+update("status='succeeded'")+'SET LOCAL ROLE service_role;SELECT public.read_aerial_original_dispatch('+','.join(quote(saved[k]) for k in ('request_id','installation_id','target_id'))+')::text;ROLLBACK;').stdout)
            assert value['authorizedNow'] is False,'Existing processing reader stays active-job-only'
        elif name=='actor':
            setup='DELETE FROM public.workspace_members WHERE workspace_id='+quote(job['workspace_id'])+' AND user_id='+quote(job['created_by'])+';'
            assert observed(setup) is False,'Revoked original actor refuses artifact access'
        elif name=='viewer':
            setup="UPDATE public.workspace_members SET role='viewer' WHERE workspace_id="+quote(job['workspace_id'])+' AND user_id='+quote(job['created_by'])+';'
            assert observed(setup) is False,'Viewer cannot inherit original processing actor delivery'
        elif name=='scope':
            assert observed(update("preset_id="+quote("fast-preview" if job["preset_id"] != "fast-preview" else "balanced"))) is False,'Changed original job facts refuse delivery'
        elif name=='mission':
            project=str(uuid.uuid4())
            setup='INSERT INTO public.projects(id,workspace_id,name) VALUES ('+quote(project)+','+quote(job['workspace_id'])+",'Synthetic changed mission project');"
            setup+='UPDATE public.aerial_missions SET project_id='+quote(project)+' WHERE id='+quote(job['mission_id'])+';'
            assert observed(setup) is False,'Changed mission parent refuses delivery'
        elif name=='terminal-emoji':
            changed=copy.deepcopy(callback);changed['callbackId']='\U0001f680'*4
            setup=terminal_setup.replace(quote(callback['callbackId']),quote(changed['callbackId'])).replace(quote(json.dumps(callback))+'::jsonb',quote(json.dumps(changed))+'::jsonb')
            assert observed(setup,TERMINAL,changed) is True,'Valid eight UTF16-unit terminal identity remains replayable'
        elif name=='terminal-time':
            assert observed(terminal_setup+update("last_callback_at='2026-10-14T14:01:00Z'"),TERMINAL,callback) is False,'Changed applied time refuses original terminal replay'
        elif name=='terminal-active':
            assert observed(update("status='running',job_reference="+quote(callback['jobReference'])),TERMINAL,callback) is True,'Original active terminal delivery remains permitted'
        elif name=='terminal-replay':
            assert observed(terminal_setup,TERMINAL,callback) is True,'Exact applied terminal replay remains permitted after success'
            changed=copy.deepcopy(callback);changed['message']='different original'
            assert observed(terminal_setup,TERMINAL,changed) is False,'Changed completed callback payload refuses terminal replay'
        elif name=='terminal-identity':
            changed=copy.deepcopy(callback);changed['callbackId']='other-terminal'
            setup=terminal_setup.replace(quote(json.dumps(callback))+'::jsonb',quote(json.dumps(changed))+'::jsonb')
            assert observed(setup,TERMINAL,changed) is False,'Different terminal identity refuses completed replay'
        elif name=='terminal-missing':
            assert observed(update("status='succeeded',job_reference="+quote(callback['jobReference'])+',last_callback_id='+quote(callback['callbackId'])+',last_callback_at='+quote(callback['occurredAt'])),TERMINAL,callback) is False,'Terminal state without its actual applied ledger refuses replay'
        elif name=='terminal-status':
            changed=copy.deepcopy(callback);changed['status']='failed'
            setup=terminal_setup.replace(quote(json.dumps(callback))+'::jsonb',quote(json.dumps(changed))+'::jsonb').replace(","+quote('succeeded')+","+quote(callback['occurredAt']),","+quote('failed')+","+quote(callback['occurredAt']))
            assert observed(setup,TERMINAL,changed) is False,'Conflicting terminal status refuses replay'
        elif name=='unsupported':
            r=sql('SET ROLE service_role;SELECT '+rpc('processing')+';',expected=None)
            assert r.returncode==3 and '22023: Original aerial delivery operation differs' in r.stderr,'Unsupported operation is an explicit refusal'
        elif name=='roles':
            p="SELECT json_build_object('definer',p.prosecdef,'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service',has_function_privilege('service_role',p.oid,'EXECUTE'),'path',p.proconfig)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='read_aerial_delivery_authority';"
            assert json.loads(sql(p).stdout)=={'definer':False,'anon':False,'authenticated':False,'service':True,'path':['search_path=pg_catalog']},'Delivery function stays invoker/service-only/fixed-path'
            for role in ('anon','authenticated'):
                r=sql('SET ROLE '+role+';SELECT '+rpc()+';',expected=None)
                assert r.returncode==3 and '42501:' in r.stderr,'Non-service roles cannot call delivery authority'
        elif name=='original-target':
            for scope in (0,1,2):
                r=sql('SET ROLE service_role;SELECT '+rpc(scope=scope)+';',expected=None)
                assert r.returncode==3 and 'P0002: Original aerial dispatch is unavailable' in r.stderr,'Wrong request/installation/target cannot retrieve original authority'
        else:raise ValueError('Unknown authority probe')
    names=['status','terminal-emoji','terminal-time','reference','processing','actor','viewer','scope','mission','terminal-active','terminal-replay','terminal-identity','terminal-missing','terminal-status','unsupported','roles','original-target']
    candidate=(repo/MIGRATION).read_bytes();text=candidate.decode().replace('CREATE FUNCTION public.read_aerial_delivery_authority','CREATE OR REPLACE FUNCTION public.read_aerial_delivery_authority',1)
    faults=[('callback-unicode-count-wrong','terminal-emoji',"jsonb_typeof(p_callback->'callbackId') = 'string' AND p_callback->>'callbackId' <> ''","length(p_callback->>'callbackId') >= 8"),('terminal-time-ignored','terminal-time','AND callback.occurred_at = job.last_callback_at','AND true'),('reference-ignored','reference',"AND (job.job_reference = p_reference OR (job.job_reference IS NULL AND job.status = 'requested'))",'AND true'),('canceled-files-allowed','status',"'running', 'succeeded'","'running', 'succeeded', 'canceled'"),('actor-check-omitted','actor',text,text.replace('JOIN public.workspace_members member','LEFT JOIN public.workspace_members member').replace("AND member.role IN ('owner', 'admin', 'member')",'AND true')),('viewer-granted','viewer',"('owner', 'admin', 'member')","('owner', 'admin', 'member', 'viewer')"),('preset-omitted','scope',"AND job.preset_id = saved.application_job->>'preset_id'",'AND true'),('mission-project-omitted','mission','AND mission.project_id IS NOT DISTINCT FROM job.project_id','AND true'),('callback-payload-ignored','terminal-replay','AND callback.payload = p_callback','AND true'),('callback-identity-ignored','terminal-identity',"AND callback.callback_id = p_callback->>'callbackId'",'AND true'),('applied-ledger-ignored','terminal-missing',"OR (job.status = p_callback->>'status' AND EXISTS (","OR (job.status = p_callback->>'status' OR EXISTS ("),('terminal-status-ignored','terminal-status',text,text.replace("job.status = p_callback->>'status'",'true').replace('callback.status = job.status','true')),('operation-ignored','unsupported',"RAISE EXCEPTION 'Original aerial delivery operation differs' USING ERRCODE = '22023';",'NULL;'),('member-execute-granted','roles','FROM PUBLIC, anon, authenticated;','FROM PUBLIC, anon;\nGRANT EXECUTE ON FUNCTION public.read_aerial_delivery_authority(text,text,text,text,text,jsonb) TO authenticated;')]
    try:
        subprocess.run(['docker','start',PG],check=True,stdout=subprocess.DEVNULL)
        end=time.monotonic()+180
        while time.monotonic()<end:
            if subprocess.run(['docker','exec',PG,'pg_isready','-U','postgres'],capture_output=True).returncode==0:break
            time.sleep(.25)
        else:raise TimeoutError('Original owned cluster readiness')
        assert sql('SELECT count(*) FROM pg_stat_activity WHERE datname='+quote(SOURCE)+';',target='postgres').stdout.strip()=='0','Original clone source has no active sessions'
        sql('CREATE DATABASE '+db+' TEMPLATE '+SOURCE+';',target='postgres')
        (out/'database-private.json').write_text(json.dumps({'container':PG,'database':db,'source':SOURCE})+'\n')
        assert sql('SELECT count(*) FROM supabase_migrations.schema_migrations;').stdout.strip()=='409','Selected original schema is409, not current hosted'
        saved=json.loads(sql('SELECT to_jsonb(s)::text FROM openplan_odm_private.original_dispatches s WHERE job_id='+quote(job['id'])+';').stdout)
        for label,payload in [('baseline',text),('harmless',text+'\n-- Harmless scoped authority control.\n'),('restored-after-harmless',text)]:
            sql(payload)
            for name in names:probe(name)
            probes.append({'control':label,'outcome':'survived','cases':len(names)});print(label+' survived',flush=True)
        for label,target,before,after in faults:
            assert text.count(before)==1,'Native mutation anchor is unique: '+label
            sql(text.replace(before,after,1))
            try:probe(target)
            except AssertionError as error:
                expected={'terminal-emoji':'Valid eight UTF16-unit terminal identity remains replayable','terminal-time':'Changed applied time refuses original terminal replay','reference':'Changed worker reference refuses original artifact access','status':'Artifact scope accepts active/succeeded and refuses failed/canceled','actor':'Revoked original actor refuses artifact access','viewer':'Viewer cannot inherit original processing actor delivery','scope':'Changed original job facts refuse delivery','mission':'Changed mission parent refuses delivery','terminal-replay':'Changed completed callback payload refuses terminal replay','terminal-identity':'Different terminal identity refuses completed replay','terminal-missing':'Terminal state without its actual applied ledger refuses replay','terminal-status':'Conflicting terminal status refuses replay','unsupported':'Unsupported operation is an explicit refusal','roles':'Delivery function stays invoker/service-only/fixed-path'}[target]
                assert str(error)==expected,'Native authority fault must fail its named behavioral assertion'
                probes.append({'control':label,'outcome':'intended_failure','case':target,'diagnostic':str(error)});print(label+' intended failure',flush=True)
            else:raise AssertionError('Native authority fault survived: '+label)
            finally:sql(text)
        for name in names:probe(name)
        probes.append({'control':'restored-final','outcome':'survived','cases':len(names)})
        (out/'controls.json').write_text(json.dumps(probes,indent=2)+'\n')
        (out/'result.json').write_text(json.dumps({'candidateSha256':hashlib.sha256(candidate).hexdigest(),'database':db,'sourceSchema':409,'positiveCohorts':4,'casesPerCohort':len(names),'faults':len(faults),'scope':'Direct SQL roles and original fixture mutations on one retained clone; no REST, hosted, terminal sender, browser, default worker or scientific acceptance.'},indent=2)+'\n')
    finally:
        state=json.loads(subprocess.check_output(['docker','inspect',PG]))[0]
        if state['State']['Running']:subprocess.run(['docker','stop','--time','120',PG],check=True,stdout=subprocess.DEVNULL,timeout=140)
        state=json.loads(subprocess.check_output(['docker','inspect',PG]))[0]
        assert not state['State']['Running'] and not state['State']['OOMKilled'],'Owned cluster stops without OOM; proof clone remains'

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();run(a.repo.resolve(),a.out.resolve())
