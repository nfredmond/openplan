"""Held finite parent controls. Import only after a separately granted entry record."""
import hashlib
import json
import os
from pathlib import Path
import time
from inert_adapter import Surface,loaded,PUBLIC,LOGICAL_ROOT,LOGICAL_SUBJECT
from inert_fixture import Fixture,INV,ENTRY_PID,wait_bytes,put,encoded

PRIVATE=Path(LOGICAL_ROOT)
SOURCES=('outer.py','custody.py','collector.py')
DEADLINE=160


def insist(condition,label):
    if not condition:raise AssertionError(label)


def exact_named(failure,expected):return failure=='AssertionError:'+expected


def refusal(call,reason,label):
    try:call()
    except ValueError as error:
        insist(str(error)==reason,label+':wrong-refusal:'+str(error));return
    except BaseException as error:
        raise AssertionError(label+':wrong-type:'+type(error).__name__+':'+str(error)) from error
    raise AssertionError(label)


def pin(path):
    data=path.read_bytes();s=path.lstat()
    return {'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'mode':s.st_mode&0o777,'uid':s.st_uid,'gid':s.st_gid}


def reader_controls():
    expected='reader-exact-named'
    supplied=[('exact','AssertionError:'+expected,True),('none',None,False),
        ('wrong','AssertionError:other',False),('suffix','AssertionError:'+expected+':wrong-refusal:other',False),
        ('generic','ValueError:'+expected,False),('transform','IndexError:'+expected,False)]
    for name,failure,wanted in supplied:
        insist(exact_named(failure,expected) is wanted,'reader-'+name)
    return [{'name':name,'accepted':wanted} for name,_,wanted in supplied]


def load_plan():
    return json.loads((PUBLIC/'control-cases.json').read_bytes())


def direct_cleanup(bundle,case,label):
    s=bundle.surface;co=bundle.collector
    if case in ['record-primary-close','record-primary-close-sync']:
        path=s.Path(LOGICAL_ROOT)/'record-case';path.mkdir(mode=0o700)
        s.fault='record-write-close-sync' if case.endswith('-sync') else 'record-write-close'
        observed=None
        try:co.record(path/'record.json',{'INERT_ONLY':True})
        except co.RecordFailure as error:observed=error
        insist(observed is not None,label)
        primary=observed.primary
        insist(type(primary) is dict and primary['type']=='OSError' and primary['errno']==5
            and primary['reason']=='[Errno 5] INERT_'+s.fault and primary['phase']=='record-write-or-fsync',label)
        insist(any(x['phase']=='record-close' for x in observed.cleanup),label+':missing-close-diagnostic')
        if case.endswith('-sync'):insist(any(x['phase']=='record-directory-sync' for x in observed.cleanup),label+':missing-sync-diagnostic')
        return {'kind':'record-failure-preserved','primary':primary,'cleanup':observed.cleanup}
    folder=s.Path(LOGICAL_ROOT)/'collector-case';folder.mkdir(mode=0o700)
    s.stage=lambda:None;s.wait_bytes=wait_bytes()
    s.fault={'collector-primary':'primary-read','collector-primary-overwrite':'primary-read',
        'collector-owned-close':'second-output-open','collector-terminal-attempt':'primary-read',
        'cleanup-only':'cleanup-only','terminal-record-failure':'terminal-open'}[case]
    result=co.collect(folder);terminal=result['terminal']
    if case=='collector-owned-close':
        output=[x for x in s.streams if x.kind=='output' and x.label.endswith('/stdout.bin')]
        insist(len(output)==1 and output[0].closed,label)
        insist(terminal['failure']['phase']=='output-setup' and terminal['streams']['stderr']['sha256'] is None,label+':missing-partial-setup')
    elif case=='collector-terminal-attempt':
        insist(any(event[0]=='terminal-attempt' for event in s.events) and s.physical(folder/'terminal.json').is_file(),label)
    elif case in ['collector-primary','collector-primary-overwrite']:
        primary=terminal['failure']
        insist(type(primary) is dict and primary['type']=='OSError' and primary['errno']==5
            and primary['reason']=='[Errno 5] INERT_primary-read' and primary['phase']=='stream-read',label)
        insist(any(x['phase']=='output-fsync-stdout' and x['reason']=='[Errno 5] INERT_followup_fsync' for x in terminal['cleanupErrors']),label+':missing-cleanup')
    elif case=='cleanup-only':
        insist(terminal['returncode']==0 and terminal['failure'] is None and terminal['classification']=='UNKNOWN_NO_REPLAY'
            and terminal['cleanupErrors'] and result['terminalRecorded'] is True,label)
    elif case=='terminal-record-failure':
        insist(result['terminalRecorded'] is False and result['terminalRecordError']['type']=='RecordFailure'
            and result['terminalRecordError']['primary']['reason']=='[Errno 5] INERT_terminal-open'
            and not s.physical(folder/'terminal.json').exists(),label)
    if case!='terminal-record-failure':insist(result['terminalRecorded'] is True,label+':terminal-not-recorded')
    wanted='terminal-zero' if case=='terminal-record-failure' else 'UNKNOWN_NO_REPLAY'
    insist(terminal['classification']==wanted and terminal['backendDeath']=='UNASSESSED',label+':unknown-lost')
    return result


def action(bundle,fixture,item):
    c=bundle.c;kind=item['kind'];case=item['case'];label=item['label'];reason=item.get('reason')
    if kind=='cleanup':return direct_cleanup(bundle,case,label)
    if kind=='grammar':
        value=wait_bytes()
        if case=='wait-header-inventory':value=value.replace(b'\n',b'\nRunning as unit: foreign.service\n',1)
        elif case=='wait-whole-header':value=value.replace(b'.service\n',b'.service INERT_TRAILING\n',1)
        elif case=='wait-result':value=value.replace(b'Finished with result: success',b'Finished with result: failure')
        elif case=='wait-main':value=value.replace(b'status=0/SUCCESS',b'status=1/FAILURE')
        elif case=='wait-zero-suffix':value=wait_bytes('0'*32)
        elif case=='grammar-final-lf':value=value[:-1]
        elif case=='grammar-ascii':value+=b'\xff\n'
        elif case=='grammar-mixed':value=value.replace(b'Running as unit:',b'Running as unit Finished with result:')
        elif case=='grammar-resource':value+=b'Unknown reporting line\n'
        else:raise ValueError('control-unknown-grammar-case')
        return refusal(lambda:c.wait_grammar(value),reason,label)
    fixture.authority()
    if kind=='outer':
        bundle.outer.main();path=bundle.surface.Path(LOGICAL_ROOT)/'catalogue-parent-attempt/result.json'
        result=c.read(path)
        insist(result['status']=='WAIT_AND_CONTROLLER_CUSTODY_ONLY' and result['nativeAcceptance']=='UNASSESSED_ROOT_RAW_AUDIT_REQUIRED'
            and result['completionInvocationJoin']=='TRANSITIVE_SEVEN_REQUEST_CUSTODY_NOT_DIRECT_FIELD'
            and result['sourceClosureComplete'] is False and result['fixtureLaunchable'] is False,label)
        insist(result['waitReportedInvocation']==(INV if case=='matching-suffix' else None)
            and result['waitInvocationSuffixPresent'] is (case=='matching-suffix'),label+':suffix-fabricated')
        insist(len(bundle.surface.lock_events)==1 and bundle.surface.popen_count==1,label+':construction')
        return result
    if kind=='ready':return refusal(bundle.outer.ready,reason,label)
    return refusal(fixture.correlate,reason,label)


def run_one(root,name,item,mutation=None,harmless=False):
    scratch=root/name;scratch.mkdir(mode=0o700)
    baseline={name:(PUBLIC/name).read_bytes() for name in SOURCES};modes={name:(PUBLIC/name).stat().st_mode&0o777 for name in SOURCES}
    sources=dict(baseline)
    if harmless:sources['outer.py']=sources['outer.py'].replace(b'"""Held parent source.',b'"""Held parent source. Harmless comment only.',1)
    if mutation is not None:
        key=mutation['file'];before=mutation['anchor'].encode();after=mutation['replacement'].encode()
        insist(sources[key].count(before)==1,'control-anchor-not-unique:'+mutation['name'])
        sources[key]=sources[key].replace(before,after,1)
    overlays={};source_dir=scratch/'source';source_dir.mkdir(mode=0o700)
    for key,value in sources.items():
        p=source_dir/key;put(p,value,modes[key]);overlays[str(PUBLIC/key)]=p
    allow=json.loads((PUBLIC/'control-input-allowlist.json').read_bytes())
    surface=Surface(scratch,allow['files'],overlays);failure=None;result=None;restored=None;failure_chain=[]
    # Retain this intent before any of the three parent subjects load.
    put(scratch/'subject-import-intent.json',{'phase':'INERT_NEW_PARENT_IMPORT_ONLY','sources':{key:pin(p) for key,p in overlays.items()},
        'case':item,'mutation':None if mutation is None else mutation['name'],'nativeOperationGranted':False})
    try:
        with loaded(surface,sources) as bundle:
            fixture=Fixture(bundle,item['case'],INV if item['case']=='matching-suffix' else '27182818284590452353602874713526' if item['case']=='wait-ack-join' else None)
            result=action(bundle,fixture,item)
    except BaseException as error:
        failure=type(error).__name__+':'+str(error);current=error
        for _ in range(8):
            if current is None:break
            failure_chain.append(type(current).__name__+':'+str(current));current=current.__context__
    finally:
        for key,value in baseline.items():put(source_dir/key,value,modes[key])
        restored={'sources':{key:pin(source_dir/key) for key in SOURCES},'production':{key:pin(PUBLIC/key) for key in SOURCES},
            'allOwnedDescriptorsClosed':all(x.closed for x in surface.streams) and not surface.fds,
            'failure':failure,'failureChain':failure_chain,'adapterCleanupErrors':surface.diagnostics}
        put(scratch/'restoration.json',restored)
    insist(restored['allOwnedDescriptorsClosed'],'control-owned-fd-restoration')
    for key,value in baseline.items():
        insist(restored['sources'][key]['sha256']==hashlib.sha256(value).hexdigest() and restored['sources'][key]['mode']==modes[key],
            'control-source-restoration:'+key)
        insist(restored['production'][key]['sha256']==hashlib.sha256(value).hexdigest() and restored['production'][key]['mode']==modes[key],
            'control-production-restoration:'+key)
    outcome={'name':name,'failure':failure,'expected':None if mutation is None else 'AssertionError:'+item['label'],
        'events':surface.events,'fakePopenCalls':surface.popen_count,'inertLockCalls':len(surface.lock_events),
        'restoration':restored,'result':result,'nativeOperationGranted':False}
    put(scratch/'outcome.json',outcome)
    if mutation is None:insist(failure is None,'control-unexpected:'+str(failure))
    else:insist(exact_named(failure,item['label']),'control-wrong-mutant-outcome:'+str(failure))
    return {key:outcome[key] for key in ['name','failure','expected','fakePopenCalls','inertLockCalls']}


def main(root):
    root=Path(root);plan=load_plan();start=time.monotonic();results=[]
    inputs=json.loads((PUBLIC/'control-input-allowlist.json').read_bytes())['files']
    insist({name:pin(Path(name)) for name in inputs}==inputs,'control-input-pin-mismatch')
    for spec in plan['sequence']:
        insist(time.monotonic()-start<DEADLINE,'control-campaign-deadline')
        if spec['mode']=='readers':
            rows=reader_controls();put(root/'reader-results.json',rows);continue
        item=spec['item'];mutation=plan['mutations'][spec['mutation']] if 'mutation' in spec else None
        results.append(run_one(root,spec['name'],item,mutation,spec['mode']=='harmless'))
        put(root/'partial-results.json',{'results':results,'complete':False})
    insist(len(results)==plan['sourceConstructions'],'control-final-count')
    put(root/'results.json',{'stage':'INERT_ONLY','results':results,'readerControls':6,'nativeOperationGranted':False,
        'sourceClosureComplete':False,'fixtureLaunchable':False,'complete':True})
