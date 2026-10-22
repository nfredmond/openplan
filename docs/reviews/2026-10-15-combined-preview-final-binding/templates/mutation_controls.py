"""Serial, in-memory health mutations. No subprocesses or operational phases."""
import ast
import collections
import hashlib
import json
from pathlib import Path
from unittest.mock import patch

import controls as c
import launcher as l
import policy as p


def replacement(module,name,before,after):
    source=Path(module.__file__).read_text()
    node=next(node for node in ast.parse(source).body if isinstance(node,ast.FunctionDef) and node.name==name)
    body=ast.get_source_segment(source,node)
    if body.count(before)!=1:raise AssertionError('mutation-anchor:'+name)
    namespace={}
    exec(compile(body.replace(before,after),'<health-mutation>','exec'),module.__dict__,namespace)
    return namespace[name]


def run():
    files={Path(module.__file__):Path(module.__file__).read_bytes() for module in [c,l,p]}
    functions=(l.health,l.verify_services,p.health,c.health_acquisition_controls)
    baseline=c.run()
    results=[dict(mutation='baseline',outcome='survived')]
    trials=[
        ('harmless-comment',l,'health','p.health(observed)','# Harmless comment.\n    p.health(observed)',None),
        ('always-refuses',l,'health','p.health(observed)',"raise ValueError('named-fault:health-always-refuses')",'health-control:baseline-fixed-configured:unexpected-refusal:named-fault:health-always-refuses'),
        ('skip-health-policy',l,'health','p.health(observed)','pass','health-control:auth-status-201:expected-refusal:health:auth'),
        ('skip-health-request',l,'health',
            "        with opener.open(urllib.request.Request(p.API+path,headers=headers,method=method),timeout=5) as response:\n            observed[name]=response.status",
            '        observed[name]=200','health-control:baseline-fixed-configured:request-0'),
        ('skip-old-request',l,'health',
            "[('ownOrigin',p.WEB),('oldOrigin','http://127.74.15.10:3583')]",
            "[('ownOrigin',p.WEB)]",'health-control:baseline-fixed-configured:unexpected-refusal:health:oldOrigin'),
        ('skip-verify-services-health',l,'verify_services','    health()','    pass','health-control:verify-services-baseline:requests-not-acquired'),
        ('old-none-only-regression',p,'health',"actual['oldOrigin'] == WEB","False",'health-control:baseline-fixed-configured:unexpected-refusal:health:oldOrigin'),
        ('allow-reflected-old',p,'health',"actual['oldOrigin'] == WEB","actual['oldOrigin'] in [WEB,'http://127.74.15.10:3583']",'health-control:old-header-reflected:expected-refusal:health:oldOrigin'),
        ('allow-wildcard-old',p,'health',"actual['oldOrigin'] == WEB","actual['oldOrigin'] in [WEB,'*']",'health-control:old-header-wildcard:expected-refusal:health:oldOrigin'),
        ('ignore-own-origin',p,'health','ownOrigin=WEB','', 'health-control:own-header-absent:expected-refusal:health:ownOrigin'),
    ]
    # This mutation supplies fixed status values without performing the GET/HEAD
    # acquisitions. It is caught by the request trace even if values look healthy.
    for label,module,name,before,after,expected in trials:
        mutated=replacement(module,name,before,after)
        with patch.object(module,name,mutated):
            try:c.health_acquisition_controls()
            except c.HealthControlFailure as error:
                # Import errors, timeouts and other runtime errors escape. A
                # different named health failure also invalidates the trial.
                if expected is None or str(error)!=expected:raise
                results.append(dict(mutation=label,outcome='killed',reason=str(error)))
            else:
                if expected is not None:raise AssertionError('mutation-survived:'+label)
                results.append(dict(mutation=label,outcome='survived'))
        if (l.health,l.verify_services,p.health,c.health_acquisition_controls)!=functions:raise AssertionError('function-restoration')
        if c.run()!=baseline:raise AssertionError('control-restoration:'+label)
        results.append(dict(mutation=label+':exact-restoration',outcome='survived'))

    # Prove the classifier itself does not label unrelated errors as kills.
    for exception in [RuntimeError('unrelated-runtime'),ValueError('unrelated-value')]:
        with patch.object(l.urllib.request,'Request',side_effect=exception):
            try:c.health_acquisition_controls()
            except c.HealthControlFailure as error:
                if not isinstance(exception,ValueError) or str(error)!='health-control:baseline-fixed-configured:unexpected-refusal:unrelated-value':raise
            except RuntimeError as error:
                if error is not exception:raise
            else:raise AssertionError('classifier-accepted-unrelated-error')
        results.append(dict(mutation='classifier:'+str(exception),outcome='unclassified-runtime-error'))
    restored=c.run()
    if restored!=baseline:raise AssertionError('final-restoration')
    for path,data in files.items():
        if path.read_bytes()!=data:raise AssertionError('file-restoration')
    results.append(dict(mutation='final-exact-restoration',outcome='survived'))
    return dict(controls=restored,mutations=results,
        totals=dict(collections.Counter(row['outcome'] for row in restored['controls'])),
        restoration=dict(functions=True,controlRows=True,templateBytes=True,
            templateSha256={path.name:hashlib.sha256(data).hexdigest() for path,data in files.items()}))


if __name__=='__main__':
    result=run()
    out=Path(p.ROOT)/'health-mutation-result-private.json'
    with out.open('x') as stream:json.dump(result,stream,indent=2);stream.write('\n')
    out.chmod(0o600)
    print(json.dumps({'total':len(result['controls']['controls']),'totals':result['totals'],'mutations':result['mutations'],'restoration':result['restoration']}))
