"""Prove that native KPI recovery detects swallowed loss and wrong cached output."""
from pathlib import Path
import json
import os
import verify_legacy_kpi_recovery_cli as proof


def verify():
    base=Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT'])
    original=proof.client.deliver
    def harmless(*args,**kwargs):
        return original(*args,**kwargs)
    def swallow_loss(*args,**kwargs):
        try:
            return original(*args,**kwargs)
        except proof.client.DeliveryUnconfirmed:
            return {}
    def wrong_cached(*args,**kwargs):
        original(*args,**kwargs)
        return {}
    results=[]
    try:
        for name,deliver,expected in [
            ('baseline',original,None),('harmless',harmless,None),
            ('swallowed-loss',swallow_loss,'Client did not propagate lost committed reply'),
            ('wrong-cached',wrong_cached,'Client did not reuse recovered kpi receipt'),
            ('restored',original,None),
        ]:
            proof.client.deliver=deliver
            os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT']=str(base/name)
            try:
                evidence=proof.check()
            except AssertionError as error:
                if expected is None or str(error)!=expected:
                    raise
                results.append({'case':name,'caught':str(error)})
            else:
                if expected is not None:
                    raise AssertionError('Native recovery fault escaped: '+name)
                results.append({'case':name,'evidence':evidence})
    finally:
        proof.client.deliver=original
        os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT']=str(base)
    base.mkdir(mode=0o700,parents=True,exist_ok=True)
    (base/'controls.json').write_text(json.dumps(results,indent=2)+'\n')
    return results


if __name__=='__main__':
    print(json.dumps(verify(),indent=2))
