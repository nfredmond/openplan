"""Held parent source. Requires future fresh root authority; no successor."""
import fcntl
import json
import os
from pathlib import Path
import sys
import time
import custody as c
import collector

ROOT=c.ROOT
SUBJECT=c.SUBJECT
LOCK=ROOT.parent/'compiler-repair-checks-20261015.lock'
UNIT=c.UNIT
SOURCE_REPORT_SHA=c.SOURCE_REPORT_SHA
SOURCE=c.SOURCE
APP=c.APP
CONNECTOR=c.CONNECTOR
TARGET=c.TARGET
DEADLINE=205
BOUNDS={'stdout':1048576,'stderr':65536}
ARGV=c.MANAGER_ARGV


def source_pins():
    path=ROOT/'operation-source-pins.json';pins=c.read(path)
    c.fields(pins,{'schema','files'},'parent-source-ledger-fields');c.same(1,pins['schema'],'parent-source-ledger-schema')
    c.need(type(pins['files']) is dict and set(pins['files'])==c.required_source_files(),'parent-source-allowlist')
    for name,expected in pins['files'].items():c.same(expected,c.descriptor(Path(name)),'operation-source-pin')
    fixed=c.contract()
    for name,expected in fixed['runtime'].items():c.same(expected,c.sha(SUBJECT/'runtime'/name),'parent-frozen-runtime')
    for name,expected in {**fixed['bindings'],**fixed['acceptedPureManifest']}.items():c.same(expected,c.descriptor(Path(name)),'parent-frozen-binding')
    review=Path('/home/nathaniel/.t3/worktrees/openplan/t3-40bfca48/docs/reviews/2026-10-16-a0-dependency-multiset-independent')
    for name,key in [('REPORT.md','reportSHA256'),('VALIDATION.md','validationSHA256')]:
        c.same(fixed['sourceReview'][key],c.sha(review/name,owned=False),'parent-exact-independent-source-review')
    old=ROOT.with_name('budget-catalog-outer-transport-20261016')/'collector.py'
    c.same(c.COLLECTOR_OLD_SHA,c.digest(c.raw(old,1048576,owned=False)),'parent-old-collector-history')
    return c.sha(path)


def risk_disposition(preflight):
    attempts=[]
    for name in ['a0-post18-catalogue-namespace-correction-20261016','a0-catalogue-trigger-completeness-correction-20261016']:
        attempts.append({'attempt':str(ROOT.with_name(name)/'catalogue-attempt'),'fence':'FENCED_NO_REPLAY',
            'parent':'UNKNOWN_STOP_ROOT_DECISION','missingRequests':['request-006','request-007'],
            'completeAbsent':True,'finalAfter':'UNASSESSED','backendDeath':'UNASSESSED'})
    decision=c.read(ROOT/'root-risk-decision.json');evidence=c.read(ROOT/'root-risk-evidence.json')
    expected={'stage':'catalogue','target':TARGET,'oid':6227945,'systemIdentifier':c.SYSTEM,'source':SOURCE,
        'subjectRoot':str(SUBJECT),'unit':UNIT,'oldAttempts':attempts,'readOnlyContinuationAccepted':True}
    for key,value in expected.items():c.same(value,decision.get(key),'parent-root-risk-'+key)
    c.need(type(evidence) is dict and len(evidence)>0,'parent-root-risk-evidence')
    joins={'freshRiskDecisionSHA256':c.sha(ROOT/'root-risk-decision.json'),'freshRiskEvidenceSHA256':c.sha(ROOT/'root-risk-evidence.json')}
    c.same(dict(joins,oldAttempts=attempts,readOnlyContinuationAccepted=True),preflight.get('postFailureDisposition'),'parent-postfailure-disposition')
    return joins


def ready():
    c.private(ROOT,True)
    c.need((ROOT/'root-operation-intent.json').is_file(),'MISSING_ROOT_OPERATION_INTENT')
    c.need((SUBJECT/'catalogue-admission.json').is_file(),'MISSINGROOTADMISSION')
    pins_sha=source_pins();intent=c.read(ROOT/'root-operation-intent.json')
    admission=c.read(SUBJECT/'catalogue-admission.json');preflight=c.read(ROOT/'root-preflight.json')
    expected={'schema':1,'stage':'catalogue','target':TARGET,'oid':6227945,'systemIdentifier':c.SYSTEM,
        'source':SOURCE,'app':APP,'connector':CONNECTOR,'unit':UNIT,'uid':os.getuid(),
        'nativeOperationGranted':True,'exclusive':True,'memoryBytes':536870912,'swapBytes':0,
        'cpuPercent':50,'tasksMax':64,'runtimeSeconds':180,'operationProposalPinsSHA256':pins_sha}
    for key,value in expected.items():c.same(value,admission.get(key),'operation-admission-'+key)
    now=int(time.time());start=admission.get('notBefore');end=admission.get('notAfter')
    c.need(type(start) is int and type(end) is int and start<=now<end and 0<end-start<=300,'operation-fresh-window')
    risk=risk_disposition(preflight)
    joins={'admissionSHA256':c.sha(SUBJECT/'catalogue-admission.json'),'sourceReviewSHA256':c.sha(SUBJECT/'source-review.md'),
        'operationReviewSHA256':c.sha(SUBJECT/'operation-review.md'),'bindingsSHA256':c.sha(SUBJECT/'catalogue-bindings.json'),
        'preflightSHA256':c.sha(ROOT/'root-preflight.json'),'operationProposalPinsSHA256':pins_sha,
        'parentSourceSHA256':c.sha(Path(__file__),owned=False),'collectorSHA256':c.sha(c.HERE/'collector.py',owned=False),
        'correlationSourceSHA256':c.sha(c.HERE/'custody.py',owned=False),'fixedContractSHA256':c.CONTRACT_SHA,
        'argv':ARGV,'deadlineSeconds':DEADLINE,'stdoutLimit':BOUNDS['stdout'],'stderrLimit':BOUNDS['stderr'],
        'unit':UNIT,'uid':os.getuid(),'nativeOperationGranted':True,'exclusive':True,
        'notBefore':start,'notAfter':end,'retry':'FORBIDDEN',**risk}
    c.same(SOURCE_REPORT_SHA,joins['sourceReviewSHA256'],'accepted-source-review')
    for key in ['sourceReviewSHA256','operationReviewSHA256','bindingsSHA256','preflightSHA256']:
        c.same(joins[key],admission.get(key),'operation-admission-join-'+key)
    c.same(joins,intent,'parent-root-operation-intent-exact')
    for key in ['sourceExact','runtimeExact','externalAuthorityExact','priorScopeAndActual18Exact','singleUsePathsAbsent',
        'capacityAccepted','containerExact','unitAvailable','compilerWindowExclusive','canonicalFencesUnchanged',
        'readOnlyFootprintAccepted','nativeReadOnlyLimitsAccepted']:
        c.need(preflight.get(key) is True,'root-preflight-'+key)
    c.need(type(preflight.get('at')) is int and 0<=now-preflight['at']<=60,'root-preflight-fresh')
    c.need(not os.path.lexists(SUBJECT/'catalogue-attempt') and not os.path.lexists(ROOT/'catalogue-parent-attempt'),'operation-no-replay')
    return joins


def failure_custody(folder,primary,cleanup,collected,name='failure.json'):
    value={'primary':primary,'lockCleanupErrors':cleanup,'collectionReturn':collected,
        'classification':'UNKNOWN_STOP_ROOT_DECISION','backendDeath':'UNASSESSED','retry':'FORBIDDEN'}
    record_error=None
    if folder is not None:
        try:collector.record(folder/name,value)
        except BaseException as error:record_error=collector.diagnostic(error,'parent-failure-record')
    else:record_error={'type':'NoAttemptDirectory','reason':'failure precedes owned attempt reservation','errno':None,'phase':'parent-setup'}
    if record_error is not None:
        # Bounded diagnostics expose no row/body/config data. Never invent durability.
        message=json.dumps({'parentFailure':value,'failureRecordError':record_error},sort_keys=True).encode()
        if len(message)>30000:
            def summary(item):return None if item is None else {k:item.get(k) for k in ['type','reason','errno','phase']}
            message=json.dumps({'primarySummary':summary(primary),
                'collectorPrimarySummary':summary(collected['terminal']['failure']) if collected is not None else None,
                'failureRecordErrorSummary':summary(record_error),'fullDiagnosticsNotDurable':True,
                'inMemoryDiagnosticBytes':len(message),'inMemoryDiagnosticSHA256':c.digest(message)},sort_keys=True).encode()
        print(message.decode(),file=sys.stderr)


def main():
    os.umask(0o077);c.START=time.monotonic()
    facts=None;lock=None;fd=None;folder=None;primary=None;cleanup=[];collected=None
    try:
        c.same(['--record-once'],sys.argv[1:],'fixed-catalogue-parent-entry');facts=ready()
        fd=os.open(LOCK,os.O_RDWR|os.O_NOFOLLOW);lock=os.fdopen(fd,'a');fd=None
        info=os.fstat(lock.fileno())
        c.need(info.st_mode&0o170000==0o100000 and info.st_uid==os.getuid(),'operation-lock-file')
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        c.same(facts,ready(),'root-operation-recheck')
        candidate=ROOT/'catalogue-parent-attempt';candidate.mkdir(mode=0o700);folder=candidate;collector.sync(ROOT)
        collector.record(folder/'intent.json',dict(facts,parentPID=os.getpid(),environment=collector.manager_env(),
            rootIntentSHA256=c.sha(ROOT/'root-operation-intent.json'),retry='FORBIDDEN'))
        collected=collector.collect(folder)
        collector.record(folder/'collection-return.json',collected)
        result=c.correlate(folder,facts,collected)
        c.same(facts['operationProposalPinsSHA256'],source_pins(),'catalogue-parent-source-drift')
        c.same(facts['admissionSHA256'],c.sha(SUBJECT/'catalogue-admission.json'),'catalogue-parent-admission-drift')
        c.same(c.read(folder/'intent.json')['rootIntentSHA256'],c.sha(ROOT/'root-operation-intent.json'),'catalogue-parent-intent-drift')
        collector.record(folder/'result.json',dict(result,status='WAIT_AND_CONTROLLER_CUSTODY_ONLY',
            terminalSHA256=c.sha(folder/'terminal.json'),collectionReturnSHA256=c.sha(folder/'collection-return.json'),lockHeldThroughTerminalCustody=True))
    except BaseException as error:
        primary=collector.diagnostic(error,'parent-main')
        failure_custody(folder,primary,cleanup,collected)
    finally:
        if lock is not None:
            try:lock.close()
            except BaseException as error:cleanup.append(collector.diagnostic(error,'parent-lock-close'))
        elif fd is not None:
            try:os.close(fd)
            except BaseException as error:cleanup.append(collector.diagnostic(error,'parent-lock-fd-close'))
    if primary is not None or cleanup:
        if cleanup:failure_custody(folder,primary,cleanup,collected,name='lock-release-failure.json')
        raise RuntimeError('parent-stopped-preserve-primary-and-cleanup')


if __name__=='__main__':
    try:main()
    except BaseException:
        print('STOP: retain actual intent/streams/PIDs; no replay or successor',file=sys.stderr)
        raise SystemExit(1)
