"""Validate retained observations and prove each assertion's refusal control."""
import ast, copy, hashlib, json
from pathlib import Path

HEAD='bf1f6ffa710b11b7f36747a676943edab667a4ae'
def require(value,reason):
    if not value:raise ValueError(reason)

def verify(r):
    require(r['state']=='passed' and r['sourceHead']==HEAD,'result-source')
    require(r['tableCount']==374 and r['sequenceCount']==6 and r['schemaEqual'] and r['nativeAllImagesEqual'],'result-native-image')
    require(r['originalFilesUnchanged'] and r['capturedBundleUnchanged'] and r['restoredOnlyTerminalReceiptChanged'],'result-file-images')
    require(r['workerFiles']==787 and r['workerBytes']==235591323 and r['capturedFiles']==788 and r['capturedBytes']>r['workerBytes'],'result-file-census')
    require(r['nativeIncompleteImageRefused'] and r['nativeControlRolledBack'],'result-native-control')
    require(len(r['coordinatedSnapshotId'])==64 and all(c in '0123456789abcdef' for c in r['coordinatedSnapshotId']),'result-encrypted-snapshot')
    require(r['noWriterIntervalStartedAt']<r['noWriterIntervalEndedAt'],'result-consistency-interval')
    require(len(r['backendStops'])==2 and all(x['exactIdentityStopped'] and x['memoryLimit']==134217728 and x['swapLimit']==134217728 and x['nanoCpus']==500000000 for x in r['backendStops']),'result-owned-services')
    require([x['case'] for x in r['replays']]==['lost-replayed-completion-reply','restored-native-completion','restored-cached-repeat','harmless-review-note','wrong-installation'],'result-replay-census')
    require(all(x['computations']==0 for x in r['replays']),'result-repeated-computation')
    lost,recovered,cached,harmless,foreign=r['replays']
    require(lost['exitCode']==2 and lost['reason']=='GTFS worker acknowledgement unavailable','result-lost-acknowledgement')
    require([x['name'] for x in lost['calls']]==['claim_gtfs_ingest','read_gtfs_ingest_attempt','complete_gtfs_ingest'],'result-lost-call-sequence')
    require(recovered['exitCode']==0 and recovered['state']=='recovered_terminal' and recovered['terminalEqual'] and not recovered['retainedReceipt'],'result-native-recovery')
    require([x['name'] for x in recovered['calls']]==['claim_gtfs_ingest','read_gtfs_ingest_attempt','complete_gtfs_ingest'],'result-recovery-call-sequence')
    require(all(x['exitCode']==0 and x['terminalEqual'] and x['retainedReceipt'] and [c['name'] for c in x['calls']]==['claim_gtfs_ingest','read_gtfs_ingest_attempt'] for x in (cached,harmless)),'result-cached-native-read')
    require(foreign['exitCode']==2 and foreign['reason']=='GTFS journal attempt scope differs' and not foreign['calls'],'result-foreign-identity')
    require(all(x['routes']==132 and x['stops']==11138 and x['stopTimeRows']==5920320 for x in (recovered,cached,harmless)),'result-parser-counts')
    require(all('transportErrorType' not in x and x['status']==200 for rows in r['http'].values() for x in rows),'result-native-http')
    replies=[x for x in r['http']['lost'] if x['path']=='/rest/v1/rpc/complete_gtfs_ingest']
    require(replies and all(x['dropped'] for x in replies) and len({(x['requestSha256'],x['responseSha256']) for x in replies})==1,'result-actually-dropped-reply')
    delivered=[x for x in r['http']['recovery'] if x['path']=='/rest/v1/rpc/complete_gtfs_ingest']
    require(len(delivered)==1 and not delivered[0]['dropped'] and delivered[0]['requestSha256']==replies[0]['requestSha256'] and delivered[0]['responseSha256']==replies[0]['responseSha256'],'result-exact-restored-reply')
    require([x['name'] for x in r['commands']]==['template-readonly-capture','source-restore','coordinated-database-capture','encrypted-initialize','encrypted-coordinated-capture','encrypted-complete-data-check','encrypted-coordinated-restore','target-restore'] and all(x['exitCode']==0 for x in r['commands']),'result-native-commands')

def main():
    base=Path(__file__).parent;original=json.loads((base/'result.json').read_text());records=[]
    for label in ('baseline','harmless','restored'):
        row=copy.deepcopy(original)
        if label=='harmless':row['reviewerNote']='Unrelated'
        verify(row);records.append({'case':label,'passed':True})
    cases=[
      ('result-source',lambda r:r.update(sourceHead='wrong')),
      ('result-native-image',lambda r:r.update(nativeAllImagesEqual=False)),
      ('result-file-images',lambda r:r.update(originalFilesUnchanged=False)),
      ('result-file-census',lambda r:r.update(capturedFiles=787)),
      ('result-native-control',lambda r:r.update(nativeControlRolledBack=False)),
      ('result-encrypted-snapshot',lambda r:r.update(coordinatedSnapshotId='short')),
      ('result-consistency-interval',lambda r:r.update(noWriterIntervalEndedAt=r['noWriterIntervalStartedAt'])),
      ('result-owned-services',lambda r:r['backendStops'][0].update(exactIdentityStopped=False)),
      ('result-replay-census',lambda r:r['replays'][0].update(case='invented')),
      ('result-repeated-computation',lambda r:r['replays'][1].update(computations=1)),
      ('result-lost-acknowledgement',lambda r:r['replays'][0].update(reason='other')),
      ('result-lost-call-sequence',lambda r:r['replays'][0]['calls'].pop()),
      ('result-native-recovery',lambda r:r['replays'][1].update(retainedReceipt=True)),
      ('result-recovery-call-sequence',lambda r:r['replays'][1]['calls'].pop()),
      ('result-cached-native-read',lambda r:r['replays'][2].update(retainedReceipt=False)),
      ('result-foreign-identity',lambda r:r['replays'][4].update(calls=[{'name':'complete_gtfs_ingest'}])),
      ('result-parser-counts',lambda r:r['replays'][1].update(stops=0)),
      ('result-native-http',lambda r:r['http']['lost'][0].update(status=403)),
      ('result-actually-dropped-reply',lambda r:next(x for x in r['http']['lost'] if x['path'].endswith('complete_gtfs_ingest')).update(dropped=False)),
      ('result-exact-restored-reply',lambda r:next(x for x in r['http']['recovery'] if x['path'].endswith('complete_gtfs_ingest')).update(responseSha256='0'*64)),
      ('result-native-commands',lambda r:r['commands'][0].update(exitCode=1)),
    ]
    for reason,change in cases:
        row=copy.deepcopy(original);change(row)
        try:verify(row)
        except ValueError as error:assert str(error)==reason
        else:raise AssertionError('Broken observation survived: '+reason)
        tree=ast.parse(Path(__file__).read_text());fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='verify')
        fn.body=[n for n in fn.body if not(isinstance(n,ast.Expr) and isinstance(n.value,ast.Call) and len(n.value.args)==2 and isinstance(n.value.args[1],ast.Constant) and n.value.args[1].value==reason)]
        space={};nodes=[n for n in tree.body if (isinstance(n,ast.Assign) and n.targets[0].id=='HEAD') or (isinstance(n,ast.FunctionDef) and n.name in ('require','verify'))]
        exec(compile(ast.Module(body=nodes,type_ignores=[]),str(__file__),'exec'),space)
        try:space['verify'](row);raise AssertionError('Broken observation survived: '+reason)
        except AssertionError as error:assert str(error)=='Broken observation survived: '+reason
        records.append({'reason':reason,'refused':True,'omittedGuardFailsOracle':True})
    (base/'result-controls.json').write_text(json.dumps({'records':records,'sourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'limits':'Copied retained observations only. No native service, database, application or file mutation.'},indent=2)+'\n')
    print('3 positive, 21 broken result controls and 21 omitted-guard oracles pass.')

if __name__=='__main__':main()
