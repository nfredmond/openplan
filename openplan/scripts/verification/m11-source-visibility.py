"""Exercise real two-session cutoff visibility in an explicitly disposable stack."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import uuid

parser = argparse.ArgumentParser()
parser.add_argument('--container', required=True)
parser.add_argument('--receipt', type=Path)
args = parser.parse_args()
assert args.container.startswith('supabase_db_') and (args.container != 'supabase_db_openplan' or os.environ.get('GITHUB_ACTIONS') == 'true'), 'Name a disposable verification stack; the unqualified local stack is not a fixture target'
root = Path(__file__).resolve().parents[2]
base = ['docker', 'exec', '-i', args.container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1']


def sql(statement, success=True):
    result = subprocess.run(base, input=statement, text=True, capture_output=True, timeout=30)
    if success:
        assert result.returncode == 0, result.stderr
    return result


setup = (root / 'src/test/fixtures/contracts/setup.sql').read_text()
body = """
PERFORM public.record_contract_command(engagement,owner_id,c);
PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'expectedVersion',1,'baselineId',baseline,'approvalEvidence','Synthetic cutoff verification only'));
RAISE NOTICE 'IDENTITY:%',jsonb_build_object('engagement',engagement,'owner',owner_id,'workspace',workspace,'task',task);
"""
result = sql(setup.replace('-- TEST_BODY', body))
ids = json.loads(re.search('IDENTITY:(.*)', result.stderr)[1])
engagement, actor = ids['engagement'], ids['owner']


def read(cutoff=None):
    arg = '' if cutoff is None else ", '" + cutoff + "'"
    return json.loads(sql(f"SELECT public.read_contract_management('{engagement}','{actor}'{arg});").stdout)


def snapshot(cutoff):
    command = {'kind': 'snapshot', 'requestId': str(uuid.uuid4()), 'title': 'Synthetic source visibility receipt', 'asOf': '2026-09-08', 'sourceCutoff': cutoff, 'coverageComplete': False, 'coverageEvidence': 'Synthetic engineering probe, no actual accounting authority'}
    statement = f"SELECT public.record_contract_command('{engagement}','{actor}',$command${json.dumps(command)}$command$);"
    return statement


# Prime first-observation receipts before choosing a cutoff. No-op writes must not
# create new source history or turn a previously supported cutoff into a conflict.
read()
cases = []
for mode in ('harmless-no-op', 'late-mutable-title', 'late-immutable-estimate'):
    writer = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    if mode == 'late-immutable-estimate':
        command = {'kind': 'estimate', 'requestId': str(uuid.uuid4()), 'expectedVersion': 0, 'taskId': ids['task'], 'asOf': '2026-09-08', 'hours': '1.00', 'cost': '50.00', 'basis': 'Synthetic late-committed estimate', 'progress': None, 'progressNote': ''}
        write = f"SELECT public.record_contract_command('{engagement}','{actor}',$command${json.dumps(command)}$command$);"
    else:
        value = 'title' if mode == 'harmless-no-op' else "'Synthetic late-committed title'"
        predicate = " AND false /* harmless zero-row update */" if mode == 'harmless-no-op' else ''
        write = f"UPDATE public.invoicing_engagements SET title={value} WHERE id='{engagement}'{predicate};"
    try:
        writer.stdin.write(f"BEGIN; {write} SELECT 'READY:'||now();\n")
        writer.stdin.flush()
        while True:
            line = writer.stdout.readline().strip()
            if line.startswith('READY:'):
                started = line[6:]
                break
            assert writer.poll() is None, 'Writer ended before its coordination marker'
        cutoff = sql('SELECT clock_timestamp();').stdout.strip()
        writer.stdin.write('COMMIT;\n')
        writer.stdin.close()
        writer.stdout.read()
        error = writer.stderr.read()
        assert writer.wait(timeout=30) == 0, error
    finally:
        if writer.poll() is None:
            writer.terminate()
            writer.wait(timeout=10)
    state = read(cutoff)
    expected = mode != 'harmless-no-op'
    assert state['cutoffConflicts'] is expected, f'{mode}: source visibility guard expected {expected}'
    statement = snapshot(cutoff)
    issued = sql(statement, success=not expected)
    if expected:
        assert issued.returncode != 0 and 'cutoff' in issued.stderr.lower(), f'{mode}: historical snapshot was not refused at cutoff'
    # A later cutoff is usable; refusal must not permanently lock out reporting.
    read()
    fresh_cutoff = sql('SELECT clock_timestamp();').stdout.strip()
    assert read(fresh_cutoff)['cutoffConflicts'] is False, 'Fresh observed cutoff was refused'
    fresh_statement = snapshot(fresh_cutoff)
    issued = sql(fresh_statement).stdout.strip()
    assert sql(fresh_statement).stdout.strip() == issued, 'Exact snapshot replay changed'
    read()
    cases.append({'case': mode, 'transactionStart': started, 'cutoffBeforeCommit': cutoff, 'conflict': expected, 'freshSnapshotAndExactReplay': True})

permissions = sql("SELECT has_table_privilege('authenticated','public.contract_source_observations','SELECT') OR has_table_privilege('authenticated','public.contract_source_observations','INSERT');").stdout.strip()
assert permissions == 'f', 'Private visibility receipts exposed to authenticated callers'
receipt = {'synthetic': True, 'container': args.container, 'fixtureEngagement': engagement, 'cases': cases, 'privateReceipts': True, 'blindCategories': ['First observation is a conservative upper bound, not exact commit time', 'One mutable and one immutable source interleaving, not every possible transaction schedule', 'Fixture is synthetic and remains only in this disposable database']}
if args.receipt:
    args.receipt.write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt))
