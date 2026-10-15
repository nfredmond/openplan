"""Independent exact-source and selected-file review. No operational acquisition."""
import ast
import copy
import hashlib
import json
from pathlib import Path
import re

PUBLIC=Path(__file__).resolve().parent
PACKET=PUBLIC.parent/'2026-10-15-current-project-preview-host-attestation-v2'
ROOT=Path('/home/nathaniel/.local/state/openplan/current-project-preview-host-attestation-independent-round4-20261015')
V3=ROOT.parent/'current-project-preview-app-binding-20261015-v3'
manifest=json.loads((PACKET/'manifest.json').read_bytes())
NEW=Path(manifest['privateRoot'])
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()

def function(text):
    return next(n for n in ast.parse(text).body if isinstance(n,ast.FunctionDef) and n.name=='attest')
original=(V3/'attest_start_v1.py').read_text()
candidate=(PACKET/'attest_start_v2.py').read_text()
expected=original.replace("expected=a.environment(values,'start')", "expected=a.environment(values,'start')\n    expected['PATH']=npm_child_path(expected['PATH'])")
expected=expected.replace("a.write_once(a.RUN/'runtime-start-attestation.json'", "a.write_once(NEW_ROOT/'runtime-start-attestation.json'")
expected=expected.replace("'attestorSha256':a.sha(Path(__file__)),", "'attestorSha256':a.sha(Path(__file__)),\n        'appBindingSha256':BINDING_SHA,'npmSourceHashes':NPM_SOURCES,\n        'derivedNpmPathSha256':hashlib.sha256(expected['PATH'].encode()).hexdigest(),")
def delta(text):
    assert ast.dump(function(text))==ast.dump(function(expected)), 'unexpected-function-delta'
delta(candidate+'\n# Harmless comment first.\n')
delta(candidate)
broken=candidate.replace("a.require(all(environment.get(key)==value for key,value in expected.items()),",'a.require(True,')
try:delta(broken)
except AssertionError as e:assert str(e)=='unexpected-function-delta'
else:raise AssertionError('delta-oracle-missed')
runner=(PACKET/'run_attest_host.sh').read_text()
pins={path:digest for digest,path in re.findall(r'^([0-9a-f]{64})  (/.+)$',runner,re.M)}
assert len(pins)==21 and pins==manifest['externalPins'],'literal-pin-map'
assert all(sha(Path(p))==h for p,h in pins.items()),'installed-pin-mismatch'
for name,key in [('run_attest_host.sh','runnerSha256'),('attest_start_v2.py','attestorSha256')]:
    assert sha(PACKET/name)==sha(NEW/name)==manifest[key], 'installed-template-mismatch'
assert manifest['runnerSha256'] in (PACKET/'PARENT_RECIPE.md').read_text()
# Snapshot selected fixed files, never cache or installed dependency trees.
selected=set(map(Path,pins))|{NEW/'run_attest_host.sh',NEW/'external-pins.json'}
for dirname in ['2026-10-15-current-project-preview-host-attestation-v2','2026-10-15-current-project-preview-host-attestation-fix','2026-10-15-current-project-preview-parent-operation-v3','2026-10-15-current-project-preview-v3-independent-round3']:
    selected.update(p for p in (PUBLIC.parent/dirname).rglob('*') if p.is_file())
OLD=ROOT.parent/'current-project-preview-host-attestation-fix-20261015'
for name in ['run_attest_host.sh','external-pins.json','reviewed-v3-manifest.json']:
    selected.add(OLD/name)
for name in ['checkout-intent.json','checkout-ready.json','build-intent.json','build-exit.json','build-result.json','build-files.json','start-intent.json']:
    selected.add(V3/'execution'/name)
record=lambda p:{'sha256':sha(p),'mode':p.stat().st_mode&0o777,'bytes':p.stat().st_size}
snapshot={str(p):record(p) for p in sorted(selected)}
assert not (ROOT/'preservation-before.json').exists(),'snapshot-already-exists'
(ROOT/'preservation-before.json').write_text(json.dumps(snapshot,indent=2)+'\n')
result={'candidate':'90cc1f800840f5921f7cf17d413af01187e39d4e','parent':'f25d91bece7259c5013136873c97a784ea562069','originalFunctionASTExactDelta':True,'deltaControls':['harmless-comment-survives','removed-environment-guard-detected'],'literalPins':len(pins),'installedPinsMatch':True,'installedTemplatesMatch':True,'manifestSha256':sha(PACKET/'manifest.json'),'subjectHashes':{n:sha(PACKET/n) for n in ['attest_start_v2.py','run_attest_host.sh','PARENT_RECIPE.md']},'selectedSnapshotFiles':len(snapshot),'limits':['AST comparison checks named function, not all module behavior. Header/import/main reviewed separately.','Selected fixed files exclude runtime caches, database/global/Storage state, dependency tree bytes and hostile concurrent same-user mutation.']}
(ROOT/'audit.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
