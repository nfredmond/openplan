"""Challenge reimbursement SQL inside rollback-only transactions on the named disposable stack."""
import json
import os
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[2]
source = (root / 'supabase/migrations/20261003000001_work_program_reimbursement.sql').read_text()
function = source[source.index('CREATE FUNCTION public.work_program_reimbursement_command'):source.index('REVOKE ALL ON FUNCTION public.work_program_reimbursement_command')].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1)
cases = [
 ('harmless comment', '-- Shared with other program claims:', '-- Shared with the other program claims:', True, ''),
 ('duplicate source', 's.claim_id<>cid', 'false', False, 'Duplicate reimbursement accepted'),
 ('shared contract valuation', "IF contract_cost.id IS NULL OR (actual.detail->>'contractId' IS NOT NULL AND contract_cost.engagement_id::text<>actual.detail->>'contractId') OR contract_cost.command->>'status' IS DISTINCT FROM 'approved'\n      OR contract_cost.amount IS DISTINCT FROM actual.amount OR contract_cost.hours IS DISTINCT FROM actual.hours OR public.contract_shared_source_stale(contract_cost)", "IF false", False, 'Stale contract mapping accepted'),
 ('remaining work', "coalesce(length(trim(p->>'outstanding')),0)>0", "true", False, 'Incomplete progress accepted'),
 ('source version', 'n.entry_id=actual.entry_id AND n.version>actual.version', 'false', False, 'Stale cost accepted'),
 ('eligible ceiling', 'IF allowed>actual.amount THEN', 'IF false THEN', False, 'Reimbursement and match'),
 ('share balance', 'IF allocated<>allowed THEN', 'IF false THEN', False, 'Unbalanced shares accepted'),
 ('fund membership', "IF fund IS NULL OR (fund->>'periodStart')::date IS NULL OR (fund->>'periodEnd')::date IS NULL OR actual.entry_date NOT BETWEEN (fund->>'periodStart')::date AND (fund->>'periodEnd')::date THEN", "IF false THEN", False, 'Foreign fund accepted'),
 ('authority evidence', "coalesce(length(trim(claim.draft->>'authorityEvidence')),0)=0", 'false', False, 'Missing authority accepted'),
 ('actor authority', "role IN ('owner','admin')", "role IN ('owner','admin','member')", False, 'Member wrote a packet'),
 ('retry content', 'cached.actor_id<>p_actor_id OR cached.command<>p_command', 'false', False, 'Changed retry accepted'),
]
results = []
with tempfile.TemporaryDirectory(prefix='m2d3-controls-') as tmp:
 for label, before, after, survive, reason in cases:
  if before not in function: raise RuntimeError('Missing mutation anchor: ' + label)
  path = Path(tmp) / 'replacement.sql'
  path.write_text(function.replace(before, after, 1))
  env = dict(os.environ, OPENPLAN_RLS_LIVE_TEST='1', OPENPLAN_SUPABASE_WORKDIR='/home/nathaniel/.local/state/openplan/m2d3-verification', M2D3_SQL_REPLACEMENT=str(path))
  run = subprocess.run(['npm','exec','--','vitest','run','src/test/work-program-reimbursement-rls.test.ts'], cwd=root, env=env, capture_output=True, text=True)
  valid = (run.returncode == 0) if survive else (run.returncode != 0 and reason in run.stdout + run.stderr)
  results.append({'case':label,'expected':'survived' if survive else 'failed','exit':run.returncode,'reasonObserved':valid})
  if not valid:
   Path('/tmp/m2d3-control-failure.log').write_text(run.stdout + run.stderr)
   raise RuntimeError(f'{label} did not produce its expected result; inspect /tmp/m2d3-control-failure.log')
  print(label + ': ' + ('survived' if survive else 'failed as intended'), flush=True)
(root.parent/'docs/reviews/2026-09-09-m2d3-reimbursement/sql-controls.json').write_text(json.dumps(results,indent=2)+'\n')
