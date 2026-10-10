"""Check attempt scope, stable identity and stop behavior in instrument delivery."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[4]
source=ROOT/'workers/aequilibrae_worker/model_attempt_writer.py'
original=source.read_text()
start=original.index('    def record_instrument(')
end=original.index('    def _record_output(',start)
method=original[start:end]
faults={
    'bypass-stopped-writer':('        self.require_open()\n',''),
    'ignore-workspace':('if workspace_id is not None and workspace_id != ctx.workspace_id:','if False:'),
    'identity-follows-payload':("'name': logical_name}","'name': journal.canonical(payload)}"),
    'continue-after-uncertainty':('            self.stopped = True\n',''),
    'unnamed-slot':('if not isinstance(logical_name, str) or not logical_name.strip():','if False:'),
}
expected_failures={
    'bypass-stopped-writer':('test_stopped_writer_cannot_reuse_a_resolved_receipt','ReconciliationRequired not raised'),
    'ignore-workspace':('test_foreign_workspace_refuses_before_transport','ValueError not raised'),
    'identity-follows-payload':('test_changed_payload_cannot_change_request_identity','ValueError not raised'),
    'continue-after-uncertainty':('test_lost_reply_stops_later_writes_and_retains_exact_request','False is not true'),
    'unnamed-slot':('test_unnamed_instrument_refuses','ValueError not raised'),
}
cases=[]
try:
    variants=[('harmless',method+'\n    # Harmless instrument writer comment.\n')]
    for name,(anchor,replacement) in faults.items():
        assert method.count(anchor)==1,(name,method.count(anchor))
        variants.append((name,method.replace(anchor,replacement)))
    variants.append(('restored',method))
    for name,candidate in variants:
        source.write_text(original[:start]+candidate+original[end:])
        result=subprocess.run([sys.executable,'-B','-m','unittest','test_model_attempt_instrument_writer','-v'],
            cwd=source.parent,text=True,capture_output=True,timeout=30)
        output=result.stdout+result.stderr
        if name in faults:
            test,message=expected_failures[name]
            assert result.returncode!=0 and 'FAIL: '+test in output and message in output,output
        else:assert result.returncode==0,output
        cases.append({'case':name,'returncode':result.returncode,'expected_behavior_observed':True})
finally:source.write_text(original)
report={'cases':cases,'source_sha256':hashlib.sha256(original.encode()).hexdigest(),
    'limits':['Real local journals, synthetic HTTP responses','No prepared-file verification, native database artifact relationships, normal dispatch or scientific acceptance']}
content=json.dumps(report,indent=2)+'\n'
Path(__file__).with_name('instrument-writer-controls.json').write_text(content)
print(content)
