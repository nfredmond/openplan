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
    'route': 'src/app/api/land-use-plans/[planId]/context/route.ts',
    'store': 'src/lib/land-use-plans/plan-context-store.ts',
    'command': 'src/lib/land-use-plans/plan-context-command.ts',
    'context': 'src/lib/land-use-plans/plan-context.ts',
}
original = {key: (app / path).read_bytes() for key, path in paths.items()}
args.output.mkdir(parents=True, exist_ok=False)
rows = []
cases = [
    ('harmless', 'route', None, None, None),
    ('agent-source', 'route', '"x-openplan-assistant-execution-source", ', '', 'agent write carrying x-openplan-assistant-execution-source'),
    ('agent-hash', 'route', '"x-openplan-assistant-input-hash", ', '', 'agent write carrying x-openplan-assistant-input-hash'),
    ('agent-approval', 'route', ', "x-openplan-assistant-approval-id"', '', 'agent write carrying x-openplan-assistant-approval-id'),
    ('origin', 'route', 'try { requireProviderBrowserOrigin(request); }', 'try { /* bypass */ }', 'refuses cross-origin writes'),
    ('write-permission', 'route', 'loadLandUsePlanAccess(planId, { write: true })', 'loadLandUsePlanAccess(planId)', 'saves exact normalized command bytes'),
    ('actor-scope', 'route', 'request.headers.get("x-openplan-expected-user") !== access.userId', 'false', 'changes in x-openplan-expected-user'),
    ('workspace-scope', 'route', 'request.headers.get("x-openplan-expected-workspace") !== access.plan.workspace_id', 'false', 'changes in x-openplan-expected-workspace'),
    ('body-limit', 'route', 'request, 2_000_000', 'request, 3_000_000', 'bounds the body'),
    ('normalization', 'route', 'if (!isDeepStrictEqual(command, raw))', 'if (false)', 'refuses unnormalized fields'),
    ('read-user-client', 'route', 'readPlanContext(access.supabase,', 'readPlanContext(createServiceRoleClient(),', 'through the user client'),
    ('raw-command', 'store', 'p_command_text: commandText', 'p_command_text: JSON.stringify(command)', 'saves exact normalized command bytes'),
    ('authenticated-actor', 'store', 'p_actor_id: scope.actorId', 'p_actor_id: command.versionId', 'saves exact normalized command bytes'),
    ('lookup-failure', 'store', 'if (lookup.error)', 'if (false)', 'retained-command discovery fails'),
    ('replay-lookup', 'store', 'if (!lookup.data)', 'if (true)', 'without reinstalling old rules'),
    ('command-scope', 'store', '.eq("command_id", command.commandId)', '', 'saves exact normalized command bytes'),
    ('journal-workspace', 'store', '.eq("plan_id", scope.planId).eq("workspace_id", scope.workspaceId)', '.eq("plan_id", scope.planId)', 'saves exact normalized command bytes'),
    ('new-plan-kind', 'store', '!descriptor.planKinds.some(kind => kind.key === command.planKindKey)', 'false', 'unsupported new checklist'),
    ('result-command', 'store', 'result.data.commandId !== command.commandId', 'false', 'mismatched or altered result'),
    ('result-version', 'store', 'result.data.versionId !== command.versionId', 'false', 'mismatched or altered result'),
    ('result-actor', 'store', 'result.data.context.savedBy !== scope.actorId', 'false', 'mismatched or altered result'),
    ('result-normalization', 'store', '!isDeepStrictEqual(result.data, data)', 'false', 'mismatched or altered result'),
    ('rpc-conflict', 'store', 'error.code === "PT409"', 'false', 'preserves RPC PT409 as 409'),
    ('rpc-permission', 'store', 'error.code === "42501"', 'false', 'preserves RPC 42501 as 403'),
    ('rpc-missing', 'store', 'error.code === "PT404"', 'false', 'preserves RPC PT404 as 404'),
    ('rpc-invalid', 'store', 'error.code === "PT400"', 'false', 'preserves RPC PT400 as 400'),
    ('read-workspace', 'store', '.eq("id", scope.planId).eq("workspace_id", scope.workspaceId)', '.eq("id", scope.planId)', 'required projections through the user client'),
    ('read-projection', 'store', '"plan_context,plan_context_hash,descriptor_id,plan_kind_key,current_working_version_id"', '"plan_context_hash,descriptor_id,plan_kind_key,current_working_version_id"', 'reads the exact retained context'),
    ('read-invalid', 'store', 'state.status === "invalid"', 'false', 'legacy null distinct'),
    ('read-legacy-hash', 'store', '(state.status === "legacy" && data.plan_context_hash !== null)', 'false', 'legacy null distinct'),
    ('read-hash', 'store', '!hash.safeParse(data.plan_context_hash).success', 'false', 'legacy null distinct'),
    ('read-normalization', 'store', '!isDeepStrictEqual(state.context, data.plan_context)', 'false', 'legacy null distinct'),
    ('missing-is-legacy', 'context', 'value === null', 'value == null', 'legacy null distinct'),
    ('base-client-attribution', 'command', 'assessment: planAuthorityAssessmentSchema,\n}).strict();', 'assessment: planAuthorityAssessmentSchema, savedBy: z.string().optional(),\n}).strict();', 'invented client attribution'),
    ('extra-client-scope', 'command', 'planKindKey: z.string().min(1).max(120),\n}).strict();', 'planKindKey: z.string().min(1).max(120),\n}).passthrough();', 'refuses client attribution'),
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
            result = subprocess.run(['npm','exec','--','vitest','run','src/test/land-use-plan-context-route.test.ts','src/test/land-use-plan-context.test.ts','--maxWorkers=1'], cwd=app,
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
