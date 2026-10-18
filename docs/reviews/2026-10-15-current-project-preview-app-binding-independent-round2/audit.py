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

PUBLIC=Path(__file__).resolve().parent.parent/'2026-10-15-current-project-preview-health-contract-fix'
REPO=PUBLIC.parents[2]
OUT=Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-independent-round2-20261015')

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
    extensions(a, r, manifest, result)
    with (OUT/'input-audit-01.json').open('x') as f:json.dump(result,f,indent=2);f.write('\n')
    print(json.dumps(result))


def extensions(a, r, manifest, result):
    from common import V2, OLD, inventory
    # Installed operation bytes are checked against the reviewed Git manifest,
    # not merely against a checksum list located beside the installed runner.
    for name, expected in manifest['recipeFiles'].items():
        assert sha(PUBLIC/name) == expected, 'public-recipe-hash:' + name
    assert sha(V2/'run_stage_v2.sh') == manifest['runnerSha256']
    assert sha(V2/'operation-files.sha256') == manifest['operationFilesSha256']
    assert (V2/'operation-files.sha256').read_bytes() == (PUBLIC/'operation-files.sha256').read_bytes()
    entries = {}
    for line in (V2/'operation-files.sha256').read_text().splitlines():
        digest, path = line.split('  ', 1)
        assert Path(path).parent == V2 and path not in entries
        entries[path] = digest
        assert sha(Path(path)) == digest
    assert set(Path(x).name for x in entries) == set(manifest['privateInputs']) | {'binding-private.json', 'run_stage_v2.sh'}
    for name in manifest['privateInputs']:
        current = (V2/name).read_bytes()
        prior = (OLD/name).read_bytes()
        if name == 'app_binding_v1.py':
            assert current == prior.replace(str(OLD).encode(), str(V2).encode())
        elif name == 'attest_start_v1.py':
            assert current == prior.replace(b"health['deployment']['commit']==a.APP_HEAD and", b"health['deployment']['commit']==a.APP_HEAD[:12].lower() and")
        else:
            assert current == prior, 'sealed-input-parity:' + name
    assert a.read(a.FROZEN/'target-identity.json') == {'oid': '6118831', 'database': 'openplan_project_combined_preview_0752bc2e8104b7a40faab27f', 'owner': 'postgres'}
    assert r.p.DB_ID == 'a4181e334bb0da63e213aaea5966d163e24faab58ddb3e6122665b3c41042cce'
    assert a.API == 'http://127.74.19.10:29948' and a.WEB == 'http://127.74.19.10:3585'
    prior_review = Path('/home/nathaniel/.t3/worktrees/openplan/t3-a504c307/docs/reviews/2026-10-15-current-project-preview-app-binding-independent')
    for name, expected in manifest['independentReviewFiles'].items():
        assert sha(prior_review/name) == expected
    # A read/no-op survives before changes to bytes, modes and link text.
    specimen = OUT/'preservation-assay'; specimen.mkdir(mode=0o700)
    p = specimen/'file'; p.write_text('original'); p.chmod(0o600)
    link = specimen/'link'; link.symlink_to('file')
    baseline = inventory(specimen)
    assert p.read_text() == 'original' and inventory(specimen) == baseline
    observations = [{'case': 'harmless read first', 'outcome': 'survived'}]
    try:
        p.write_text('changed')
        assert inventory(specimen) != baseline, 'changed-byte-not-detected'
        observations.append({'case': 'changed bytes', 'outcome': 'detected'})
        p.write_text('original'); p.chmod(0o644)
        assert inventory(specimen) != baseline, 'changed-mode-not-detected'
        observations.append({'case': 'changed mode', 'outcome': 'detected'})
        p.chmod(0o600); link.unlink(); link.symlink_to('different')
        assert inventory(specimen) != baseline, 'changed-link-not-detected'
        observations.append({'case': 'changed link text', 'outcome': 'detected'})
    finally:
        p.write_text('original'); p.chmod(0o600); link.unlink(); link.symlink_to('file')
    assert inventory(specimen) == baseline
    observations.append({'case': 'restored', 'outcome': 'survived'})
    write_target = OUT/'preservation-assay.json'
    with write_target.open('x') as f: json.dump(observations, f, indent=2); f.write('\n')
    result.update(exactRuntimeDelta=True, operationListMatchesExternalManifest=True,
                  operationFiles=len(entries), oldInputsExactParity=True,
                  targetOid='6118831', trustedControllerIsOSConfined=False,
                  preservationAssayRestored=True)


if __name__ == '__main__':
    main()
