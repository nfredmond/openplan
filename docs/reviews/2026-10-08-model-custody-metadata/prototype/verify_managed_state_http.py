"""Native selected-state copy and consumption recovery, without path relocation."""
import hashlib
import inspect
import json
import os
from pathlib import Path
from types import FunctionType
from verify_writer_http import verify, managed, import_worker_main


def main():
    root=Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT'])
    root.mkdir(mode=0o700,parents=True,exist_ok=False)
    worker=import_worker_main()
    original=worker.retain_managed_predecessor_state
    source=inspect.getsource(original)
    anchor='"content_hash": selected["content_hash"], "file_size_bytes": selected["file_size_bytes"]'
    if source.count(anchor)!=1:raise AssertionError('State registration mutation anchor changed')
    results=[]
    try:
        for name,body in [('baseline',source),('harmless',source+'\n# Harmless comment.\n'),
                          ('wrong-consumer-hash',source.replace(anchor,'"content_hash": "0" * 64, "file_size_bytes": selected["file_size_bytes"]')),
                          ('restored',source)]:
            namespace=dict(worker.__dict__)
            exec(compile(body,'<native-state-consumer-control>','exec'),namespace)
            worker.retain_managed_predecessor_state=FunctionType(namespace[original.__name__].__code__,worker.__dict__)
            try:
                result=verify(root/name,managed,state_consumer=True)
            except AssertionError as error:
                if name!='wrong-consumer-hash' or str(error)!='Native state consumption differs from original bytes or provenance':raise
                results.append({'control':name,'expected_failure':str(error)})
            else:
                if name=='wrong-consumer-hash':raise AssertionError('Incorrect consumer hash passed')
                results.append({'control':name,'result':result})
    finally:
        worker.retain_managed_predecessor_state=original
    report={'adapter_sha256':hashlib.sha256(source.encode()).hexdigest(),
            'worker_sha256':hashlib.sha256(Path(worker.__file__).read_bytes()).hexdigest(),'controls':results,
            'limits':'Actual selected-state helper and owned byte copy, native predecessor selection and consumption registration, fresh CLI recovery. No execution-state mapping, project transfer, normal dispatcher or scientific acceptance.'}
    content=json.dumps(report,indent=2)+'\n'
    (root/'managed-state-http.json').write_text(content)
    (Path(__file__).parent/'managed-state-http.json').write_text(content)
    print(content)


if __name__=='__main__':main()
