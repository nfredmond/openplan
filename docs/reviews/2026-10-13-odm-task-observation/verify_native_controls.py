"""Replay retained native metadata and refuse changed claims without engine writes.

This checks supplied evidence consistency. It cannot detect a wholly substituted
native evidence package, actual image quality, live identity or current authority.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'workers/odm_worker'))
from task_observation import observe


def verify(plan,body,claimed):
    actual=observe(plan,200,body)
    if actual!=claimed:raise ValueError('Retained native observation claims differ')
    if actual['reportedState']!='failed' or actual['reportedImageCount']!=3:
        raise ValueError('Retained invalid-task observation differs')
    return actual


def run(proof,out):
    os.umask(0o077);out.mkdir(mode=0o700)
    paths=(proof/'effects/plan.json',proof/'failed-body.bin',proof/'failed-observation.json')
    original={str(path):path.read_bytes() for path in paths}
    plan=json.loads(original[str(paths[0])]);body=original[str(paths[1])];claim=json.loads(original[str(paths[2])])
    rows=[]
    def check(label,payload,reason=None):
        try:verify(*payload)
        except ValueError as error:
            if reason is None or str(error)!=reason:raise AssertionError('Wrong native replay failure: '+label) from error
            outcome='intended_refusal'
        else:
            if reason is not None:raise AssertionError('Changed native evidence survived: '+label)
            outcome='survived'
        rows.append({'control':label,'outcome':outcome,'reason':reason})
    check('baseline',(plan,body,claim))
    whitespace=body+b'\n';check('harmless-json-whitespace',(plan,whitespace,observe(plan,200,whitespace)))
    changed=copy.deepcopy(plan);changed['taskUuid']='12345678-1234-4234-8234-123456789abc'
    check('changed-original-uuid',(changed,body,claim),'Task metadata original UUID or name differs')
    value=json.loads(body);value['options'][1]['value']=False
    check('changed-added-option',(plan,json.dumps(value).encode(),claim),'Task metadata automatic option additions differ')
    changed=copy.deepcopy(claim);changed['bodySha256']='0'*64
    check('changed-raw-body-hash',(plan,body,changed),'Retained native observation claims differ')
    changed=copy.deepcopy(claim);changed['processingQualityVerification']='verified'
    check('claimed-quality-promotion',(plan,body,changed),'Retained native observation claims differ')
    changed=json.loads(body);changed['status']={'code':40};raw=json.dumps(changed).encode()
    check('synthetic-failure-relabeled-completed',(plan,raw,observe(plan,200,raw)),'Retained invalid-task observation differs')
    check('restored',(plan,body,claim))
    if any(path.read_bytes()!=original[str(path)] for path in paths):raise AssertionError('Native replay modified original evidence')
    (out/'controls.json').write_text(json.dumps(rows,indent=2)+'\n')
    (out/'bindings.json').write_text(json.dumps({str(path):hashlib.sha256(data).hexdigest() for path,data in
        [(path,original[str(path)]) for path in paths]+[(ROOT/'workers/odm_worker/task_observation.py',(ROOT/'workers/odm_worker/task_observation.py').read_bytes())]},indent=2)+'\n')
    print(json.dumps({'controls':len(rows),'survivors':3,'faults':5,'originalEvidenceUnchanged':True}))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--proof',type=Path,required=True);parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args();run(args.proof.resolve(),args.out.resolve())
