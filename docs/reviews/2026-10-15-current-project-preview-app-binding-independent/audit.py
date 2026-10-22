"""Read installed inputs through actual pure consumers; deny operational I/O."""
import ast
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import types
from unittest.mock import patch

PUBLIC=Path(__file__).resolve().parent.parent/'2026-10-15-current-project-preview-app-binding'
REPO=PUBLIC.parents[2]
OUT=Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-independent-20261015')

def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):h.update(block)
    return h.hexdigest()

def deny(*args,**kwargs):raise AssertionError('operational-io-forbidden')

def main():
    os.umask(0o077)
    manifest=json.loads((PUBLIC/'manifest.json').read_bytes())
    root=Path(manifest['privateRoot'])
    spec=importlib.util.spec_from_file_location('installed_readonly_binding',root/'app_binding_v1.py')
    a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
    with patch.object(subprocess,'run',side_effect=deny),patch.object(socket,'socket',side_effect=deny):
        binding=a.bindings();r=a.load_recovery()
        ids_before={k:id(v) for k,v in vars(r).items()}
        policy_before={k:id(v) for k,v in vars(r.p).items()}
        values=a.app_values(r);receipts=r.active_receipts()
        assert ids_before=={k:id(v) for k,v in vars(r).items()}
        assert policy_before=={k:id(v) for k,v in vars(r.p).items()}
        assert sha(root/'binding-private.json')==manifest['bindingSha256']
        assert binding['files']==manifest['privateInputs']
        assert manifest['helperModules']==a.HELPERS
        for name,h in manifest['templates'].items():
            assert sha(PUBLIC/'templates'/name)==sha(root/name)==h
        for name,h in manifest['privateInputs'].items():assert sha(root/name)==h
        for name,h in manifest['helperModules'].items():assert sha(a.FROZEN/name)==h
        pin=a.read(root/'recovery-active-binding.json')
        assert pin==manifest['activeBinding']
        assert {k:sha(a.ACTIVE.parent/k) for k in pin['files']}==pin['files']
        assert sha(a.OPERATION_OBSERVATION)==pin['operationObservationSha256']
        assert receipts['rest']['id']==a.ACTIVE_REST_ID
        assert not a.CANDIDATE.exists() and not list(a.RUN.iterdir())
        # Exact real metadata consumers use a new globals dictionary so installed
        # module globals, original helper functions and original paths stay intact.
        g=dict(vars(a));g.update(APP=REPO/'openplan',CANDIDATE=REPO)
        dep=types.FunctionType(a.dependencies.__code__,g)
        migrations=types.FunctionType(a.migrations.__code__,g)
        dep_digest=dep();migration_digest=migrations()
        assert (REPO/'openplan/package-lock.json').read_bytes()==(a.SOURCE_REPO/'openplan/package-lock.json').read_bytes()
        evidence=a.read(PUBLIC/'evidence.json')
        for name,h in evidence['scriptHashes'].items():assert sha(PUBLIC/name)==h
        for name,h in evidence['privateArtifactHashes'].items():assert sha(root/name)==h
        assert r.p.HEAD==a.HELPER_HEAD and r.p.PURPOSE=='project-geography-preview-final-20261015'
        assert r.OUT==a.FROZEN and r.p.SOURCE_ANCHOR==a.SOURCE_ANCHOR
        assert sha(root/'migrations.json')==sha(a.FROZEN/'candidate-migrations.json')
        old=a.read(a.FROZEN/'app-env-private.json')
        assert values=={**old,'OPENPLAN_COMMIT_SHA':a.APP_HEAD}
        assert not any(k in values for k in ['OPENAI_API_KEY','ANTHROPIC_API_KEY','SMTP_HOST','RESEND_API_KEY'])
        funcs=['pinned_files','active_receipts','verify_services','source_check','unchanged_inputs']
        for name in funcs:assert getattr(r,name).__globals__ is vars(r)
        for p in PUBLIC.rglob('*.py'):ast.parse(p.read_bytes())
        result={'manifestMatchesInstalled':True,'actualPureConsumersAccepted':True,
                'helperGlobalsUnchanged':True,'appHead':a.APP_HEAD,'helperHead':r.p.HEAD,
                'activeReceiptSha256':sha(a.ACTIVE),'dependencyBindingDigest':dep_digest,
                'migrationDigest':migration_digest,'migrationCount':419,
                'installedEntries':a.read(root/'dependency-binding.json')['installedEntries'],
                'appEnvironmentDelta':['OPENPLAN_COMMIT_SHA'],'candidateAbsent':True,
                'executionFiles':0,'tools':{p:sha(Path(p)) for p in ['/usr/bin/node','/usr/bin/npm','/usr/bin/bwrap']},
                'blindCategory':'No Docker/SQL/HTTP acquisition, full dependency payload hash, hostile same-user protection or runtime acceptance.'}
    with (OUT/'input-audit-01.json').open('x') as f:json.dump(result,f,indent=2);f.write('\n')
    print(json.dumps(result))

if __name__=='__main__':main()
