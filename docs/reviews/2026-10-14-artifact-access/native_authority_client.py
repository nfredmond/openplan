"""Use the actual supervised RPC and copied original runtime for one assertion."""
import json
from pathlib import Path
import sys
import time

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'workers/odm_worker'))
from application_delivery_authority import Authority, ARTIFACT, TERMINAL
from application_dispatch_http import Transport, DELIVERY_RPC, DEFAULT_RPC
from runtime_admission import Runtime
from runtime_dispatch_custody import Custody


def run(config_path,mode,expected):
    config=json.loads(Path(config_path).read_text())
    runtime=Runtime(Path(config['runtimeRoot']),config['installationId'],max_queued=4,pipeline=lambda _:None,timeout=10)
    dispatch=Custody(runtime,config['targetId'],timeout=10)
    tokens={'apiKey':config['token'],'bearerToken':config['token']}
    transport=Transport(config['endpoint'],'native-original-delivery',lambda _:tokens,allow_http=True,max_response_bytes=65536,rpc=DELIVERY_RPC)
    authority=Authority(dispatch,transport,timeout=10)
    with runtime.owner():
        original=dispatch.load(config['requestId'])
        entry=runtime.journal.get(config['requestId'])
        binding={'installationId':config['installationId'],'targetId':config['targetId'],'requestId':config['requestId'],
            'jobReference':entry.job_reference,'originalApplicationJob':original['applicationJob'],'originalDispatchSha256':original['payloadSha256']}
        if mode=='processing':
            processing=Transport(config['endpoint'],'native-original-processing',lambda _:tokens,allow_http=True,max_response_bytes=65536,rpc=DEFAULT_RPC)
            raw=processing({'p_request':config['requestId'],'p_installation':config['installationId'],'p_target':config['targetId']},time.monotonic()+10,owned=lambda:runtime._owned)
            assert json.loads(raw)['authorizedNow'] is False,'Original actual processing RPC stays active-job-only'
            return
        try:
            observed=authority(binding,TERMINAL if mode=='terminal' else ARTIFACT,time.monotonic()+10,
                owned=lambda:runtime._owned,callback=config['callback'] if mode=='terminal' else None)
        except ValueError as error:
            assert expected=='refused' and str(error)=='Private dispatch RPC read did not complete','Native non-service RPC must refuse at actual transport'
            return
        assert expected in ('true','false') and observed is (expected=='true'),'Actual delivery RPC preserves expected current access'

if __name__=='__main__':run(*sys.argv[1:])
