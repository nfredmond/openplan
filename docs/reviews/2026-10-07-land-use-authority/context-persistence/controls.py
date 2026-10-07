"""Exercise candidate SQL in isolated rollback-only transactions, without editing source."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--app', type=Path, required=True)
parser.add_argument('--container', required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
app = args.app.resolve()
subprocess.run(['npm', 'exec', '--', 'tsx', '-e',
    'import {requireContractVerificationStack} from "./src/test/helpers/contract-verification-stack"; requireContractVerificationStack(process.argv[1]);', args.container], cwd=app, check=True, capture_output=True)
path = app / 'supabase/migrations/20261016000002_land_use_plan_context.sql'
original = path.read_text()
fixture = (app / 'src/test/fixtures/land-use-plans/context-persistence.sql').read_text()
args.output.mkdir(parents=True, exist_ok=False)

def fault(old, new):
    assert original.count(old) == 1, (old, original.count(old))
    return original.replace(old, new)

cases = [
    ('baseline', original, ''),
    ('harmless-comment', original + '\n-- Harmless verification comment.\n', ''),
    ('direct-update', fault("(TG_OP = 'UPDATE' AND NEW.plan_context IS DISTINCT FROM OLD.plan_context)", "(false)"), 'direct context update refused: accepted'),
    ('direct-insert', fault("(TG_OP = 'INSERT' AND NEW.plan_context IS NOT NULL)", "(false)"), 'direct context insert refused: accepted'),
    ('direct-checklist', fault('NEW.descriptor_id IS DISTINCT FROM OLD.descriptor_id OR NEW.plan_kind_key', 'false OR NEW.plan_kind_key'), 'direct checklist change refused: accepted'),
    ('direct-plan-kind', fault('OR NEW.plan_kind_key IS DISTINCT FROM OLD.plan_kind_key', 'OR false'), 'direct plan kind change refused: accepted'),
    ('public-rpc', original + '\nGRANT EXECUTE ON FUNCTION public.save_land_use_plan_context(uuid,uuid,uuid,uuid,text,text,jsonb,text,text) TO authenticated;', 'authenticated RPC permission'),
    ('anonymous-rpc', original + '\nGRANT EXECUTE ON FUNCTION public.save_land_use_plan_context(uuid,uuid,uuid,uuid,text,text,jsonb,text,text) TO anon;', 'anonymous RPC permission'),
    ('journal-rls', fault('ALTER TABLE public.land_use_plan_context_commands ENABLE ROW LEVEL SECURITY;', ''), 'command journal RLS enabled'),
    ('journal-read', original + '\nGRANT SELECT ON public.land_use_plan_context_commands TO authenticated;', 'private command journal'),
    ('definer-escalation', fault(') RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER', ') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER'), 'RPC remains security invoker'),
    ('viewer-write', fault("AND user_id = p_actor_id AND role IN ('owner', 'admin', 'member')", "AND user_id = p_actor_id AND role IN ('owner', 'admin', 'member', 'viewer')"), 'viewer refused: accepted'),
    ('outsider-write', fault('AND user_id = p_actor_id AND role', 'AND role'), 'outsider refused: accepted'),
    ('checklist-selection', fault('IF plan_row.descriptor_id IS DISTINCT FROM p_expected_descriptor_id', 'IF false'), 'changed checklist refused: accepted'),
    ('plan-kind-selection', fault('     OR plan_row.plan_kind_key IS DISTINCT FROM p_expected_plan_kind_key', ''), 'changed plan kind refused: accepted'),
    ('replay-checklist', fault('       OR previous.descriptor_id IS DISTINCT FROM p_expected_descriptor_id\n', ''), 'changed replay checklist refused: accepted'),
    ('replay-plan-kind', fault('       OR previous.plan_kind_key IS DISTINCT FROM p_expected_plan_kind_key\n', ''), 'changed replay plan kind refused: accepted'),
    ('current-pointer', fault(' OR plan_row.current_working_version_id IS DISTINCT FROM p_version_id', ''), 'noncurrent version refused: accepted'),
    ('stale-write', fault('IF plan_row.plan_context_hash IS DISTINCT FROM p_expected_context_hash THEN', 'IF false THEN'), 'stale first save refused: accepted'),
    ('assessment-substitution', fault("AND p_prepared_context->'assessment' = command_json->'assessment'", ''), 'assessment substitution refused: accepted'),
    ('actor-attribution', fault("'savedBy', p_actor_id, 'savedAt'", "'savedBy', p_prepared_context->>'savedBy', 'savedAt'"), 'database actor attribution'),
    ('time-attribution', fault("to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')", "'1900-01-01T00:00:00Z'"), 'database time attribution'),
    ('command-byte-trimming', fault('p_expected_descriptor_id, p_expected_plan_kind_key, p_expected_context_hash, p_command_text, retained, retained_hash);', 'p_expected_descriptor_id, p_expected_plan_kind_key, p_expected_context_hash, btrim(p_command_text), retained, retained_hash);'), 'exact command journal'),
    ('command-hash', fault("encode(extensions.digest(command_text, 'sha256'), 'hex')", "repeat('0',64)"), 'exact command journal'),
    ('replay-actor', fault('IF previous.actor_id IS DISTINCT FROM p_actor_id', 'IF false'), 'other member cannot replay: accepted'),
    ('replay-version', fault('       OR previous.version_id IS DISTINCT FROM p_version_id\n', ''), 'changed replay version refused: accepted'),
    ('replay-precondition', fault('       OR previous.expected_context_hash IS DISTINCT FROM p_expected_context_hash\n', ''), 'changed replay precondition refused: accepted'),
    ('replay-bytes', fault('       OR previous.command_text IS DISTINCT FROM p_command_text', ''), 'changed command bytes refused: accepted'),
    ('replay-overwrite', fault("    RETURN jsonb_build_object('replayed', true", "    UPDATE public.land_use_plans SET plan_context=previous.saved_context WHERE id=p_plan_id;\n    RETURN jsonb_build_object('replayed', true"), 'old replay does not overwrite newer save'),
    ('replay-before-permission', fault("  IF NOT EXISTS (\n    SELECT 1 FROM public.workspace_members", "  IF NOT EXISTS (SELECT 1 FROM public.land_use_plan_context_commands WHERE plan_id=p_plan_id AND command_id=p_command_id) AND NOT EXISTS (\n    SELECT 1 FROM public.workspace_members"), 'revoked writer replay refused: accepted'),
    ('journal-rewrite', fault('CREATE TRIGGER land_use_plan_context_commands_append_only\n  BEFORE UPDATE OR DELETE ON public.land_use_plan_context_commands\n  FOR EACH ROW EXECUTE FUNCTION public.refuse_land_use_plan_append_only_rewrite();', ''), 'journal rewrite refused: accepted'),
    ('freeze-insert', fault("(TG_OP = 'INSERT' AND NEW.state <> 'working')", '(false)'), 'frozen insert omission refused: accepted'),
    ('freeze-consistency', fault("(TG_OP = 'UPDATE' AND OLD.state = 'working' AND NEW.state <> 'working')", '(false)'), 'omitted frozen context refused: accepted'),
    ('working-state', fault(" OR working.state <> 'working'", ''), 'frozen version save refused: accepted'),
]
rows = []
for name, sql, marker in cases:
    result = subprocess.run(['docker','exec','-i',args.container,'psql','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],
        input="BEGIN; SET LOCAL statement_timeout='15s';\n" + sql + '\n' + fixture + '\nROLLBACK;', text=True, capture_output=True, timeout=25)
    output = result.stdout + result.stderr
    (args.output / (name + '.log')).write_text(output)
    matched = (result.returncode != 0 and marker in output) if marker else (result.returncode == 0 and 'context persistence verified' in output)
    rows.append({'case': name, 'exitCode': result.returncode, 'expectedFailure': marker or None, 'matched': matched})
    (args.output / 'report.json').write_text(json.dumps({'cases': rows, 'sourceUnchanged': path.read_text() == original, 'sourceSha256': hashlib.sha256(original.encode()).hexdigest()}, indent=2)+'\n')
    if not matched:
        raise RuntimeError(name + ': unexpected outcome\n' + output)
print(json.dumps({'cases':len(rows),'allMatched':all(row['matched'] for row in rows),'sourceUnchanged':path.read_text()==original}))
