"""Separate post-producer native point, service and restored-file verification."""
import copy,hashlib,json,subprocess
from pathlib import Path
import run as r
OUT=Path(__file__).parent

def verify_files(captured,current,allowed):
    r.s.require(set(captured)==set(current),'expanded-final-file-census')
    differences={name for name in captured if captured[name]!=current.get(name)}
    r.s.require(differences<=allowed,'expanded-final-unrelated-file')
    r.s.require(all(current[name]['mode']==captured[name]['mode'] for name in current),'expanded-final-file-mode')
    return differences

def verify_result(result):
    r.s.require(result['state']=='passed-native' and result['sourceHead']==r.s.HEAD,'expanded-final-result')
    r.s.require(len(result['cli'])==2 and [x['exitCode'] for x in result['cli']]==[2,0] and [x['jobSettled'] for x in result['cli']]==[False,True],'expanded-final-cli')
    r.s.require(all(x['computationAttempts']==0 and x['sourceNetworkAttempts']==0 and x['nativeCandidateCount']==0 and x['nativeLockHolders']>0 for x in result['cli']),'expanded-final-no-compute')
    r.s.require(result['propertiesEqual'] and result['originalDatabaseUnchanged'] and result['originalDurableFilesUnchanged'] and result['allKnownGtfsRootsCaptured'],'expanded-final-preservation')
    r.s.require(result['storageObjectsReadBack']==10 and result['syntheticUserSignin'],'expanded-final-services')
    r.s.require(result['rolesCapturedReused'] and result['mountedKeyCapturedReused'] and result['mountedKeyCapturedAndReadVerified'],'expanded-final-key-role-custody')

def main():
    result=json.loads((OUT/'result.json').read_text());verify_result(result);manifest=json.loads((OUT/'execution-source-manifest.json').read_text())
    for name,expected in manifest.items():r.s.require(r.files.digest(OUT/name)==expected,'expanded-final-runner-source')
    bundle=OUT/'source-point-private';restored=OUT/'target-restored-private'/bundle.relative_to('/');census=json.loads((OUT/'point-file-inventory-private.json').read_text());r.files.equal(census,r.files.inventory(bundle))
    fixture=json.loads((r.PROOF/'capacity-20261011-01/capacity-native.json').read_text());root=restored/'gtfs-capacity'/hashlib.sha256(r.s.API.encode()).hexdigest();job=root/('version-'+fixture['versionId'])/'pending.json';terminal=next(root.glob('version-'+fixture['versionId']+'/attempt-*/commands/command-terminal/pending.json'))
    allowed={p.relative_to(restored).as_posix() for p in (root/'pending.json',Path(str(root)+'-submissions')/'pending.json',job,terminal)}
    differences=verify_files(census,r.files.inventory(restored),allowed)
    r.s.require(json.loads(job.read_text())['settled'] is True,'expanded-final-job-unsettled');r.s.require(json.loads(terminal.read_text())==json.loads((restored/'configuration-private/expected-terminal-private.json').read_text()),'expanded-final-terminal-receipt')
    source_command=json.loads((bundle/terminal.relative_to(restored)).read_text());target_command=json.loads(terminal.read_text());r.s.require(source_command['payload']==target_command['payload'],'expanded-final-original-payload')
    baseline=json.loads((OUT/'original-before-inventory-private.json').read_text())
    for label in ('original-after-readonly-capture','source-initial','source-after-reply-loss','target-before-cli','target-after-cli','original-final'):r.prior.equal_image(baseline,json.loads((OUT/(label+'-inventory-private.json')).read_text()))
    # This additional read occurs after the producer and does not write transit.
    current=r.prior.inventory(result['targetDatabase'],'post-producer-target');after_auth=json.loads((OUT/'target-after-signin-inventory-private.json').read_text());r.prior.equal_image(after_auth,current)
    r.s.require(r.props.read(result['targetDatabase'])==json.loads((restored/'configuration-private/database-properties-private.json').read_text()),'expanded-final-database-properties')
    configuration=json.loads((OUT/'target-service-receipts-private.json').read_text())
    for kind,receipt in configuration['services'].items():
        info=r.services.inspect(receipt['id']);r.services.verify_new(kind,info,receipt,result['targetDatabase'],restored/'storage-objects',OUT/'target-kong-runtime-private.json');r.s.require(info['State']['Running'],'expanded-final-target-service')
    for kind,identity in r.s.ORIGINALS.items():r.s.verify_original(kind,r.services.inspect(identity),running=False)
    state=json.loads((OUT/'source-service-receipts-private.json').read_text())
    for kind,receipt in state['services'].items():
        info=r.services.inspect(receipt['id']);r.services.verify_new(kind,info,receipt,result['sourceDatabase'],bundle/'storage-objects',OUT/'source-kong-runtime-private.json');r.s.require(not info['State']['Running'],'expanded-final-source-service')
    result={'sourceHead':r.s.HEAD,'nativeProducerResultChecked':True,'sourceCodeUnchanged':True,'exactInstalledCliRecovered':True,'nativeTargetReadRepeated':True,'propertiesReadRepeated':True,'allRestoredBytesRetainedExceptAllowedJournals':True,'changedFiles':sorted(differences),'originalPayloadRetained':True,'exactTerminalReceipt':True,'exactOriginalAndSourceServicesStopped':True,'targetServicesVerifiedRunning':True,'capturedFiles':len(census),'capturedBytes':sum(row['bytes'] for row in census.values()),'limits':'Same host and cluster; file modes checked, directory metadata excluded. Known GTFS roots, no populated SQLite or other worker-family artifacts. Auth changes follow producer sign-in. No browser or hosted acceptance.'};(OUT/'final-verification.json').write_text(json.dumps(result,indent=2)+'\n');print(result)
if __name__=='__main__':main()
