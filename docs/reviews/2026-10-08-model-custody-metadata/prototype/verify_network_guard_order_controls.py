"""Control the repaired static order check without mutating the worker file."""
import ast
import hashlib
import inspect
import json
from pathlib import Path
import sys

root=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(root/'workers/aequilibrae_worker'))
import test_activitysim_assignment_handoff as test

source=inspect.getsource(test.main.stage_assignment)
test.test_stage5_network_state_mismatch_is_guarded_before_execute()
results=[]
for control in ('baseline','harmless','omit-guard','late-guard','direct-execute','restored'):
    candidate=source
    reason=None
    if control=='harmless':candidate='# assig.execute() is only a comment.\n'+candidate
    elif control=='omit-guard':
        candidate=candidate.replace('require_expected_network_state(', 'removed_network_guard(')
        reason='Expected one network guard'
    elif control in ('late-guard','direct-execute'):
        tree=ast.parse(source)
        blocks=[node.body for node in ast.walk(tree) if isinstance(getattr(node,'body',None),list)]
        found=False
        for block in blocks:
            guards=[node for node in block if isinstance(node,ast.Expr) and isinstance(node.value,ast.Call)
                    and isinstance(node.value.func,ast.Name) and node.value.func.id=='require_expected_network_state']
            if not guards:continue
            if control=='late-guard':
                block.remove(guards[0]);block.append(guards[0])
                reason='Network guard must precede'
            else:
                block.append(ast.Expr(value=ast.Call(func=ast.Attribute(value=ast.Name(id='assig',ctx=ast.Load()),attr='execute',ctx=ast.Load()),args=[],keywords=[])))
                reason='Direct assignment bypasses'
            found=True;break
        assert found
        candidate=ast.unparse(ast.fix_missing_locations(tree))
    failure=None
    try:test.assert_pre_execution_network_guard(candidate)
    except AssertionError as error:failure=str(error)
    matched=failure is None if reason is None else failure is not None and reason in failure
    results.append({'control':control,'expected_failure':reason,'observed_failure':failure,'matched':matched})
    assert matched,(control,failure)
report={'stage_source_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':results,
    'limits':'Direct semantic network mismatch check plus AST order and direct-bypass assertions. Not a dynamic execution of the entire assignment stage.'}
(Path(__file__).parent/'network-guard-order-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
