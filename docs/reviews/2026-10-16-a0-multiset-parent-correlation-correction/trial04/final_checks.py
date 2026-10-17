"""Saved-model custody checks after the unchanged finite90 selection succeeds."""
from pathlib import Path


def run(config,window):
    scratch=Path(config['scratch']);plan=window.loads(window.raw(window.PACKET/'control-cases.json'))
    result=window.loads(window.raw(scratch/'results.json',window.FILE_MAX))
    expected_keys={'stage','results','readerControls','nativeOperationGranted','sourceClosureComplete','fixtureLaunchable','complete'}
    window.need(type(result) is dict and set(result)==expected_keys,'final-model-result-fields')
    window.need(window.same({k:result[k] for k in expected_keys-{'results'}},{'stage':'INERT_ONLY','readerControls':6,
        'nativeOperationGranted':False,'sourceClosureComplete':False,'fixtureLaunchable':False,'complete':True}),'final-model-flags')
    specs=[r for r in plan['sequence'] if r['mode']!='readers'];rows=result['results']
    window.need(type(rows) is list and len(rows)==84 and [r['name'] for r in rows]==[r['name'] for r in specs],'final-model-sequence')
    for spec,row in zip(specs,rows):
        expected='AssertionError:'+spec['item']['label'] if spec['mode']=='mutant' else None
        window.need(window.same(expected,row['failure']) and window.same(expected,row['expected']),'final-exact-model-outcome')
        base=scratch/spec['name'];restoration=window.loads(window.raw(base/'restoration.json'))
        window.need(restoration['allOwnedDescriptorsClosed'] is True and restoration['adapterCleanupErrors']==[],'final-model-restoration')
        for name in ['outer.py','custody.py','collector.py']:
            wanted=config['inputs'][str(window.PACKET/name)]
            window.need(window.same(wanted,restoration['sources'][name]) and window.same(wanted,restoration['production'][name]),'final-model-source-restore')
            window.need(window.same(wanted,window.filepin(base/'source'/name)),'final-model-overlay-readback')
    readers=window.loads(window.raw(scratch/'reader-results.json'))
    window.need(window.same(readers,[{'name':name,'accepted':accepted} for name,accepted in [
        ('exact',True),('none',False),('wrong',False),('suffix',False),('generic',False),('transform',False)]]),'final-reader-six')
    popen=sum(r['fakePopenCalls'] for r in rows);locks=sum(r['inertLockCalls'] for r in rows)
    window.need(popen==59 and locks==4,'final-model-fixed-constructions')
    window.record(window.ATTEMPT/'final-checks.json',{'sourceConstructions':84,'namedMutants':28,'readerChecks':6,'subjectChecks':90,
        'wrapperControls':4,'suppliedPopen':popen,'inertFlock':locks,'actualNativeDispatches':0,'sourceClosureComplete':False,
        'fixtureLaunchable':False,'sourceRuntimeAcceptance':'UNASSESSED','complete':True})
