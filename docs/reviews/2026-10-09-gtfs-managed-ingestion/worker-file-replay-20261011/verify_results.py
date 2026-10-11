"""Check retained replay observations and challenge every result boundary."""
import copy,json
from pathlib import Path

HERE=Path(__file__).parent
def verify(value):
    assert value['sourceHead']=='bf1f6ffa710b11b7f36747a676943edab667a4ae', 'replay-current-source'
    assert value['backupSourceHead']=='ba1b497fce5c83f5cdb36031a56ce447d2719fb0', 'replay-backup-source'
    assert value['snapshotId']=='ca655ea95b25edbd2f7f31c886a1b18fc10a52392c50338ddfa1e157a05fc092', 'replay-snapshot-identity'
    assert value['nativeTableCount']==18 and value['nativeBeforeAfterEqual'], 'replay-native-stability'
    assert value['originalFilesUnchanged'] and value['backupRestorationUnchanged'], 'replay-file-stability'
    assert value['relocatedWorkerFileBytesAndModesEqual'] and value['independentFinalNativeReadEqual'], 'replay-final-independent-comparison'
    assert value['runner']['exitCode']==0 and value['runner']['memoryMaxBytes']==1073741824 and value['runner']['swapDisabled'] and value['runner']['cpuLimit']==1, 'replay-actual-bounded-service'
    rows={r['case']:r for r in value['records']}
    assert len(rows)==len(value['records'])==9, 'replay-case-census'
    positives=['cached','harmless','uncertain-native-reply','restored']
    common=None
    for name in positives:
        row=rows[name]
        assert row['exitCode']==0 and row['state']=='recovered_terminal' and row['terminalEqual'], 'replay-terminal-custody'
        assert row['computations']==0, 'replay-recomputation'
        assert row['routes']==132 and row['stops']==11138 and row['stopTimeRows']==5920320, 'replay-restored-parser-counts'
        expected=['claim_gtfs_ingest','read_gtfs_ingest_attempt']+(['complete_gtfs_ingest'] if name=='uncertain-native-reply' else [])
        assert [r['name'] for r in row['calls']]==expected, 'replay-native-sequence'
        assert row['retainedReceipt']==(name!='uncertain-native-reply'), 'replay-native-reply-origin'
        hashes=[r['argumentsSha256'] for r in row['calls'][:2]]
        assert all(len(h)==64 and all(c in '0123456789abcdef' for c in h) for h in hashes), 'replay-argument-hash'
        if common is None:common=hashes
        assert hashes==common, 'replay-original-claim-arguments'
    refusals={'wrong-installation':'GTFS journal attempt scope differs','wrong-target':'GTFS journal attempt scope differs','wrong-original-actor':'replay-original-actor','foreign-terminal-context':'GTFS retained terminal context differs','changed-restored-archive':'replay-file-bytes'}
    for name,reason in refusals.items():
        row=rows[name]
        assert row['exitCode']==2 and row['refused'] and row['reason']==reason and row['computations']==0, 'replay-intended-native-refusal'
        expected=['claim_gtfs_ingest','read_gtfs_ingest_attempt'] if name=='foreign-terminal-context' else []
        assert [r['name'] for r in row['calls']]==expected, 'replay-refusal-before-write'
    return True

def main():
    value=json.loads((HERE/'result.json').read_text());records=[]
    for case in ['baseline','harmless','restored']:
        trial=copy.deepcopy(value)
        if case=='harmless':trial['reviewerNote']='Unrelated note'
        assert verify(trial);records.append({'case':case,'passed':True})
    def row(v,name):return next(r for r in v['records'] if r['case']==name)
    variants=[
      ('wrong-current-source',lambda v:v.update(sourceHead='different'),'replay-current-source'),
      ('wrong-backup-source',lambda v:v.update(backupSourceHead='different'),'replay-backup-source'),
      ('different-snapshot',lambda v:v.update(snapshotId='0'*64),'replay-snapshot-identity'),
      ('native-record-changed',lambda v:v.update(nativeBeforeAfterEqual=False),'replay-native-stability'),
      ('changed-original-files',lambda v:v.update(originalFilesUnchanged=False),'replay-file-stability'),
      ('changed-relocated-copy',lambda v:v.update(relocatedWorkerFileBytesAndModesEqual=False),'replay-final-independent-comparison'),
      ('failed-service',lambda v:v['runner'].update(exitCode=1),'replay-actual-bounded-service'),
      ('missing-case',lambda v:v['records'].pop(),'replay-case-census'),
      ('changed-terminal-receipt',lambda v:row(v,'restored').update(terminalEqual=False),'replay-terminal-custody'),
      ('repeated-computation',lambda v:row(v,'cached').update(computations=1),'replay-recomputation'),
      ('different-parser-count',lambda v:row(v,'cached').update(stops=11139),'replay-restored-parser-counts'),
      ('uncertain-never-contacted-server',lambda v:row(v,'uncertain-native-reply')['calls'].pop(),'replay-native-sequence'),
      ('uncertain-cached-reply',lambda v:row(v,'uncertain-native-reply').update(retainedReceipt=True),'replay-native-reply-origin'),
      ('invalid-request-hash',lambda v:row(v,'restored')['calls'][0].update(argumentsSha256='invalid'),'replay-argument-hash'),
      ('new-claim-request',lambda v:row(v,'restored')['calls'][0].update(argumentsSha256='0'*64),'replay-original-claim-arguments'),
      ('wrong-refusal',lambda v:row(v,'wrong-target').update(reason='different'),'replay-intended-native-refusal'),
      ('foreign-terminal-write',lambda v:row(v,'foreign-terminal-context')['calls'].append({'name':'complete_gtfs_ingest','argumentsSha256':'0'*64}),'replay-refusal-before-write'),
    ]
    for case,mutate,reason in variants:
        trial=copy.deepcopy(value)
        try:
            mutate(trial);verify(trial)
        except AssertionError as error:assert str(error)==reason,(case,str(error))
        else:raise AssertionError('Broken result survived: '+case)
        finally:assert verify(value)
        records.append({'case':case,'expectedFailure':reason,'passed':True})
    (HERE/'result-controls.json').write_text(json.dumps({'records':records,'limits':'Copied result observations only. No app, source, backup, restored files, database or external service writes.'},indent=2)+'\n')
    print('3 positive and 17 targeted broken replay observations pass.')

if __name__=='__main__':main()
