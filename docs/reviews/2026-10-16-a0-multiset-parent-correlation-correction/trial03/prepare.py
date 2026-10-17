"""Four new wrapper guard controls. No historical cohort is imported or copied."""
from pathlib import Path


def insist(value,name):
    if not value:raise AssertionError(name)


def refused(call,reason,label):
    try:call()
    except RuntimeError as error:
        insist(str(error)==reason,label+':wrong-refusal:'+str(error));return
    raise AssertionError(label)


def definitions(source,window):
    namespace={'need':window.need,'CAPS':window.CAPS,'ARTIFACT_MAX':window.ARTIFACT_MAX,'FILES_MAX':window.FILES_MAX,'FILE_MAX':window.FILE_MAX}
    exec(compile(source,'_a0_new_wrapper_guard_source.py','exec'),namespace)
    insist(all(namespace[name].__globals__ is namespace for name in ['resource_policy','artifact_policy']),'wrapper-control-function-globals')
    return namespace


def scenario(core):
    resources={'memory.max':'536870912','memory.swap.max':'0','cpu.max':'50000 100000','pids.max':'64'}
    core['resource_policy'](dict(reversed(list(resources.items()))))
    refused(lambda:core['resource_policy'](dict(resources,**{'memory.max':'1073741824'})),
        'wrapper-actual-resource-limits','wrapper-resource-missing-refusal')
    core['artifact_policy'](1,1,1)
    refused(lambda:core['artifact_policy'](268435457,1,1),'wrapper-artifact-bound','wrapper-artifact-missing-refusal')


def run(config,window):
    source_path=window.HERE/'window.py';original=source_path.read_bytes();text=original.decode()
    first=text.index('\ndef resource_policy(');last=text.index('\ndef artifact_inventory(',first);source=text[first:last]
    resource="need(values==CAPS,'wrapper-actual-resource-limits')"
    artifact="need(total<=ARTIFACT_MAX and files<=FILES_MAX and largest<=FILE_MAX,'wrapper-artifact-bound')"
    insist(source.count(resource)==1 and source.count(artifact)==1,'wrapper-control-unique-anchors')
    rows=[]
    try:
        scenario(definitions('# New harmless source comment\n'+source,window));rows.append({'name':'harmless','outcome':'SURVIVED'})
        for name,anchor,label in [('resource',resource,'wrapper-resource-missing-refusal'),('artifact',artifact,'wrapper-artifact-missing-refusal')]:
            core=definitions(source.replace(anchor,'pass',1),window)
            try:scenario(core)
            except BaseException as error:
                if type(error) is not AssertionError or str(error)!=label:raise
                rows.append({'name':name,'outcome':'KILLED','fullClass':'builtins.AssertionError','message':str(error)})
            else:raise AssertionError('wrapper-mutant-survived:'+name)
        scenario(definitions(source,window));rows.append({'name':'restored','outcome':'PASSED'})
    finally:insist(source_path.read_bytes()==original,'wrapper-control-source-restoration')
    insist(len(rows)==4,'wrapper-control-count')
    window.record(window.ATTEMPT/'wrapper-controls.json',{'cases':rows,'native':False,'sourceBytesUnchanged':True,
        'actualFilesystemFailuresProved':False,'wholeWrapperFailureCoverageProved':False})
