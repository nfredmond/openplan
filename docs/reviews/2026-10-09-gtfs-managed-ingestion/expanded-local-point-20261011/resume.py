"""Resume validation after the retained producer's narrow Auth-oracle omission."""
import copy,json,subprocess,datetime
from pathlib import Path
import run as r
from auth_preservation import verify_auth,TABLES
OUT=Path(__file__).parent

def verify_resume(producer,plan,state,props_equal,auth_verified,images_equal):
    r.s.require(producer['state']=='failed' and producer['reason']=='expanded-signin-unrelated-record-change' and producer['originalServicesRestartedAfterFailure'] is True,'expanded-resume-producer')
    r.s.require(plan['targetDatabase']==state['database'] and plan['sourceHead']==r.s.HEAD and state['api_url']==r.s.API,'expanded-resume-target')
    r.s.require(len(producer['cli'])==2 and [row['exitCode'] for row in producer['cli']]==[2,0] and [row['jobSettled'] for row in producer['cli']]==[False,True],'expanded-resume-original-cli')
    r.s.require(props_equal and auth_verified and images_equal,'expanded-resume-preservation')

def main():
    producer=json.loads((OUT/'progress-private.json').read_text());plan=json.loads((OUT/'plan.json').read_text());state=json.loads((OUT/'target-service-receipts-private.json').read_text());bundle=OUT/'source-point-private';restored=OUT/'target-restored-private'/bundle.relative_to('/');baseline=json.loads((OUT/'original-before-inventory-private.json').read_text());captured=json.loads((OUT/'point-file-inventory-private.json').read_text());properties=json.loads((restored/'configuration-private/database-properties-private.json').read_text())
    actor=json.loads((restored/'configuration-private/fixture-accounts-private.json').read_text())['accounts']['owner']['id'];auth=verify_auth(json.loads((OUT/'source-auth-rows-private.json').read_text()),json.loads((OUT/'target-auth-rows-private.json').read_text()),actor)
    for label in ('original-after-readonly-capture','source-initial','source-after-reply-loss','target-before-cli','target-after-cli'):r.prior.equal_image(baseline,json.loads((OUT/(label+'-inventory-private.json')).read_text()))
    verify_resume(producer,plan,state,r.props.read(plan['targetDatabase'])==properties,True,True)
    r.files.equal(captured,r.files.inventory(bundle));r.s.verify_database(r.services.inspect(r.s.DB_ID))
    for kind,id in r.s.ORIGINALS.items():r.s.verify_original(kind,r.services.inspect(id))
    for kind,receipt in state['services'].items():
        info=r.services.inspect(receipt['id']);r.services.verify_new(kind,info,receipt,plan['targetDatabase'],restored/'storage-objects',OUT/'target-kong-runtime-private.json');r.s.require(not info['State']['Running'],'expanded-resume-target-already-running')
    r.s.require(subprocess.check_output(['git','rev-parse','HEAD'],cwd=r.APP,text=True).strip()==r.s.HEAD and not subprocess.check_output(['git','status','--porcelain'],cwd=r.APP,text=True).strip(),'expanded-resume-source')
    for unit in r.UNITS:r.s.require(subprocess.check_output(['systemctl','--user','show',unit,'-p','ActiveState','--value'],text=True).strip() not in ('active','activating'),'expanded-resume-active-worker-app')
    r.s.require(r.jobs(plan['targetDatabase'])==(0,0,0),'expanded-resume-target-jobs')
    r.prior.equal_image(baseline,r.prior.inventory(r.s.DATABASE,'resume-original-before'));r.prior.equal_image(baseline,r.prior.inventory(plan['sourceDatabase'],'resume-source-before'))
    after_auth=json.loads((OUT/'target-after-signin-inventory-private.json').read_text());r.prior.equal_image(after_auth,r.prior.inventory(plan['targetDatabase'],'resume-target-before'))
    # Every non-Auth table and every unrelated sequence must remain exact.
    differences=[row['table'] for row,other in zip(baseline['tables'],after_auth['tables']) if row!=other];r.s.require(set(differences)=={'auth.users','auth.sessions','auth.refresh_tokens','auth.mfa_amr_claims','auth.audit_log_entries'},'expanded-resume-auth-delta')
    old_seq={row['sequence']:row for row in baseline['sequences']};new_seq={row['sequence']:row for row in after_auth['sequences']}
    r.s.require(set(old_seq)==set(new_seq) and all(row==new_seq[name] for name,row in old_seq.items() if name!='auth.refresh_tokens_id_seq'),'expanded-resume-sequences')
    r.s.require(new_seq['auth.refresh_tokens_id_seq']['last_value']==auth['refreshTokenId'] and new_seq['auth.refresh_tokens_id_seq']['is_called'],'expanded-resume-token-sequence')
    snapshots=json.loads((OUT/'source-services-private.json').read_text());r.services.stop_original(snapshots)
    try:
        r.services.port_free();subprocess.run(['docker','start',*[state['services'][kind]['id'] for kind in ('rest','auth','storage','gateway')]],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=30)
        for kind,receipt in state['services'].items():
            info=r.services.inspect(receipt['id']);r.services.verify_new(kind,info,receipt,plan['targetDatabase'],restored/'storage-objects',OUT/'target-kong-runtime-private.json');r.s.require(info['State']['Running'],'expanded-resume-service-start')
        r.record=copy.deepcopy(producer);r.record['resumedFromFailedProducer']=True
        r.save=lambda:(OUT/'resume-progress-private.json').write_text(json.dumps(r.record,indent=2)+'\n')
        # GET readiness is checked through exact bytes on all ten objects. Retry
        # the health endpoint while cold Storage starts, without treating a path
        # or container state as a readable archive.
        import requests,time
        session=requests.Session();session.trust_env=False;ready=False
        for _ in range(100):
            try:
                with session.get(r.s.API+'/storage/v1/status',headers={'apikey':state['service_key'],'Authorization':'Bearer '+state['service_key']},timeout=1) as response:ready=response.status_code==200
            except requests.RequestException:pass
            if ready:break
            time.sleep(.2)
        r.s.require(ready,'expanded-resume-storage-readiness')
        r.storage_readback(plan['targetDatabase'],restored/'storage-objects',state['service_key'],'resumed-target',json.loads((restored/'configuration-private/object-manifest-private.json').read_text()))
        r.prior.equal_image(after_auth,r.prior.inventory(plan['targetDatabase'],'resume-target-after'));r.prior.equal_image(baseline,r.prior.inventory(r.s.DATABASE,'original-final'));r.prior.equal_image(baseline,r.prior.inventory(plan['sourceDatabase'],'resume-source-final'))
        r.s.require(r.props.read(r.s.DATABASE)==properties and r.props.read(plan['targetDatabase'])==properties,'expanded-resume-properties-after')
        for name,root in r.ROOTS.items():r.files.equal(r.files.inventory(bundle/('gtfs-'+name)) if name!='capacity' else json.loads((r.PROOF/'worker-backup-tool-20261011/native-01/source-inventory-private.json').read_text()),r.files.inventory(root))
        r.files.equal(r.files.inventory(bundle/'storage-objects'),r.files.inventory(Path(r.s.STORAGE)));r.files.equal(captured,r.files.inventory(bundle))
        key_service={'name':r.s.DB_NAME,'id':r.s.DB_ID,'imageId':r.services.inspect(r.s.DB_ID)['Image'],'project':'openplan-restore-target-2026091050'};r.props.archive._keys.require_mounted_bytes(key_service,(restored/'configuration-private/pgsodium-root-private.key').read_bytes())
        r.s.require(r.props.archive.role_inventory(r.s.DB_ID)==(restored/'configuration-private/roles-inventory-private.json').read_text(),'expanded-resume-original-roles')
        lost=[row for row in producer['http']['source-lost-completion-reply'] if row['path'].endswith('complete_gtfs_ingest')];recovered=[row for row in producer['http']['target-original-command-recovered'] if row['path'].endswith('complete_gtfs_ingest')];r.s.require({(row['requestSha256'],row['responseSha256']) for row in lost}=={(row['requestSha256'],row['responseSha256']) for row in recovered},'expanded-resume-original-command-reply')
        summary=next(json.loads(line) for line in (OUT/'restic-backup-private.log').read_text().splitlines() if line.startswith('{') and json.loads(line).get('message_type')=='summary')
        result=copy.deepcopy(producer);result.update(state='passed-native',originalProducerState='failed',originalProducerReason=producer['reason'],continuation='Separate exact Auth-user/session preservation validation and repeated native/database/file reads',finishedAt=r.stamp(),snapshotId=summary['snapshot_id'],capturedFiles=len(captured),capturedBytes=sum(row['bytes'] for row in captured.values()),tables=len(baseline['tables']),sequences=len(baseline['sequences']),propertiesEqual=True,originalDatabaseUnchanged=True,originalDurableFilesUnchanged=True,allKnownGtfsRootsCaptured=True,storageObjectsReadBack=10,rolesCapturedReused=True,mountedKeyCapturedReused=True,targetDatabase=plan['targetDatabase'],sourceDatabase=plan['sourceDatabase'],signinChangedTables=differences,exactAuthGraphVerified=True,limits=plan['limits']);(OUT/'resumed-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'passedContinuation':True,'originalProducerFailed':True,'tables':len(baseline['tables']),'storageObjects':10,'exactAuthGraphVerified':True}),flush=True)
    except Exception:
        r.services.stop_stack(plan['targetDatabase'],restored/'storage-objects',OUT/'target-kong-runtime-private.json',OUT,state,[]);r.services.restart_original(snapshots);raise
if __name__=='__main__':main()
