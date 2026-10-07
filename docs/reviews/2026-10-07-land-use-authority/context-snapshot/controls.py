"""Check route faults one at a time and restore all owned source byte for byte."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--app', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
app = args.app.resolve()
paths = {
    'api': 'src/lib/land-use-plans/api.ts',
    'reader': 'src/lib/land-use-plans/context-snapshot.ts',
    'public': 'src/lib/land-use-plans/public.ts',
    'decisions': 'src/app/api/land-use-plans/[planId]/decisions/route.ts',
}
original = {key: (app / path).read_bytes() for key, path in paths.items()}
args.output.mkdir(parents=True, exist_ok=False)
rows = []
cases = [
    ('harmless', 'api', None, None, None),
    ('snapshot-context', 'api', 'planContext: context.contextState.status === "retained" ? context.contextState.context : null,', 'planContext: null,', 'retains exact context and scopes'),
    ('snapshot-legacy', 'api', 'planContext: context.contextState.status === "retained" ? context.contextState.context : null,', 'planContext: context.contextState.status === "retained" ? context.contextState.context : undefined,', 'retains explicit historical absence'),
    ('version-match', 'api', 'context.versionId !== version.id', 'false', 'refuses a version context read'),
    ('descriptor-match', 'api', 'context.descriptorId !== access.plan.descriptor_id', 'false', 'refuses a descriptor context read'),
    ('kind-match', 'api', 'context.planKindKey !== access.plan.plan_kind_key', 'false', 'refuses a kind context read'),
    ('read-workspace', 'api', 'workspaceId: access.plan.workspace_id, actorId: access.userId', 'workspaceId: access.plan.id, actorId: access.userId', 'retains exact context and scopes'),
    ('read-plan', 'api', 'planId: access.plan.id, workspaceId:', 'planId: access.plan.workspace_id, workspaceId:', 'retains exact context and scopes'),
    ('reader-normalization', 'reader', '!isDeepStrictEqual(result.context, snapshot.planContext)', 'false', 'refuses self-hashed normalized frozen context'),
    ('public-invalid', 'public', 'if (readFrozenPlanContext(snapshot as Record<string, unknown>).status === "invalid") return null;', '', 'refuses self-hashed malformed frozen context'),
    ('adoption-invalid', 'decisions', 'if (retainedContext.status === "invalid")', 'if (false)', 'refuses malformed context before recording adoption'),
    ('manifest-context', 'decisions', 'planContext: retainedContext.status === "retained" ? retainedContext.context : null,', 'planContext: null,', 'retains the exact reviewed context in the adoption manifest'),
    ('manifest-custody', 'decisions', 'planContextCustody: retainedContext.status === "retained" ? "frozen" : "not_retained",', 'planContextCustody: "frozen",', 'records legacy adoption'),
]
try:
    for name, key, old, new, marker in cases:
        source = original[key].decode()
        if old is None:
            changed = source + '\n// Harmless verification comment.\n'
        else:
            assert source.count(old) == 1, (name, source.count(old))
            changed = source.replace(old, new)
        try:
            (app / paths[key]).write_text(changed)
            result = subprocess.run(['npm','exec','--','vitest','run','src/test/land-use-plan-frozen-rules-integration.test.ts','src/test/land-use-plan-public-identity.test.ts','--maxWorkers=1'], cwd=app,
                env={**os.environ, 'NODE_OPTIONS':'--max-old-space-size=6144'}, text=True, capture_output=True, timeout=45)
            output = result.stdout + result.stderr
            (args.output / (name + '.log')).write_text(output)
            matched = result.returncode == 0 if marker is None else result.returncode != 0 and 'AssertionError' in output and marker in output
            rows.append({'case':name,'exitCode':result.returncode,'matched':matched,'target':marker})
            if not matched: raise RuntimeError(name + ': unexpected test outcome')
        finally:
            (app / paths[key]).write_bytes(original[key])
finally:
    restored = all((app / paths[key]).read_bytes() == value for key,value in original.items())
    (args.output / 'report.json').write_text(json.dumps({'cases':rows,'restored':restored,
        'sourceSha256':{paths[key]:hashlib.sha256(value).hexdigest() for key,value in original.items()}}, indent=2)+'\n')
print(json.dumps({'cases':len(rows),'allMatched':all(row['matched'] for row in rows),'restored':restored}))
