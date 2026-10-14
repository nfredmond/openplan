"""Challenge the useful native callback retry proof on retained isolated services."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def intended(code, output, diagnostic):
    return (code == 1 and output.rstrip().endswith(diagnostic)
        and re.search(r'^(AssertionError|ValueError): '+re.escape(diagnostic)+r'\s*$', output, re.MULTILINE) is not None
        and 'SyntaxError:' not in output and 'TimeoutError:' not in output)


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    module = repo/'openplan/src/app/api/aerial/processing-callback/route.ts'
    producer = repo/'docs/reviews/2026-10-14-aerial-callback-retry/native_recovery.py'
    originals = {path: path.read_bytes() for path in [module, producer]}
    cases, controls, oracles = [], [], []

    def fault(label, target, before, after, diagnostic):
        source = originals[target].decode()
        assert source.count(before) == 1, label+' requires one source binding'
        cases.append((label, target, source.replace(before, after), diagnostic))

    fault('retained-replay-skipped', module, 'replayed = true;',
        'return NextResponse.json({ ok: true, deduped: true }, { status: 200 });',
        'Actual retained retry must finish the original status write')
    fault('changed-payload-accepted', module,
        '!isDeepStrictEqual(retained.payload, JSON.parse(JSON.stringify(callback)))', 'false',
        'Changed original callback must refuse')
    fault('different-worker-reference-accepted', module,
        'return NextResponse.json({ error: "job_reference_mismatch" }, { status: 409 });', '',
        'Other worker identity must refuse')
    fault('observed-status-omitted', module, '.eq("status", job.status)', '',
        'Concurrent native state change must request a fresh retry')
    fault('affected-id-projection-omitted', module, ').select("id");', ');',
        'Actual retained retry must finish the original status write')

    fault('newer-applied-event-overwritten', module, 'if (order > 0 || (replayed && order === 0))', 'if (false)',
        'Old native replay cannot replace a newer same-status event')
    fault('same-status-last-event-fences-omitted', module, '    const identifiedWrite = job.last_callback_id === null\n      ? referencedWrite.is("last_callback_id", null)\n      : referencedWrite.eq("last_callback_id", job.last_callback_id);\n    const { data: appliedJobs, error: updateError } = await (job.last_callback_at === null\n      ? identifiedWrite.is("last_callback_at", null)\n      : identifiedWrite.eq("last_callback_at", job.last_callback_at)).select("id");', '    const { data: appliedJobs, error: updateError } = await referencedWrite.select("id");',
        'Concurrent same-status event must fence a stale write')
    fault('legacy-accepted-baseline-rejected', module, 'const legacyAccepted = !appliedError && !applied',
        'const legacyAccepted = false && !appliedError && !applied',
        'Actual first posted event advances the legacy accepted baseline')
    fault('deterministic-package-key-removed', module, '            id: job.id,', '',
        'Actual concurrent callback creates one evidence package')
    fault('package-primary-key-conflict-rejected', module, 'if (insertError?.code === POSTGRES_UNIQUE_VIOLATION)', 'if (false)',
        'Actual overlapping exact retries complete after a package conflict')
    def execute(label):
        result = subprocess.run([sys.executable, '-B', str(producer), '--repo', str(repo),
            '--out', str(out/(label+'-private'))], capture_output=True, text=True, timeout=300,
            env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        output = result.stdout+result.stderr
        (out/(label+'-private.log')).write_text(output)
        for identity in ['a79d62deecea7fd1d1099b35863ca3de50ef7f44618c3c130c9f5b34b024bed3',
                '3c6255798df56cb37d42b9aa226123919409cbf5d50ce57c97c9000ecb76950f']:
            value = json.loads(subprocess.check_output(['docker', 'inspect', identity]))[0]
            assert not value['State']['Running'] and not value['State']['OOMKilled'], 'Native owned services must stop'
        return result.returncode, output

    def positive(label):
        code, output = execute(label)
        assert code == 0, label+' native cohort failed'
        result = json.loads((out/(label+'-private/result.json')).read_bytes())
        assert result['exactRetryApplied'] and result['terminalStatePreserved'] and result['concurrentStateRefused']
        assert result['legacyAcceptedBaselineAdvanced'] and result['concurrentPackageCount']==1 and result['concurrentPackageKeyIsJob']
        controls.append({'case': label, 'outcome': 'survived'})

    try:
        positive('baseline')
        module.write_bytes(originals[module]+b'\n// Harmless original native callback retry comment.\n')
        positive('harmless-comment')
        module.write_bytes(originals[module])
        positive('restored-after-harmless')
        for label, target, changed, diagnostic in cases:
            try:
                target.write_text(changed)
                code, output = execute(label)
                assert intended(code, output, diagnostic), label+' misses its intended native assertion'
                for name, c, o, d, wanted in [
                    ('exact', code, output, diagnostic, True),
                    ('success', 0, output, diagnostic, False),
                    ('wrong-exit', 2, output, diagnostic, False),
                    ('wrong-diagnostic', code, output, 'Unrelated failure', False),
                    ('syntax', code, 'SyntaxError: '+diagnostic, diagnostic, False),
                    ('timeout', code, 'TimeoutError: '+diagnostic, diagnostic, False),
                    ('no-failure', code, diagnostic, diagnostic, False),
                    ('later-error', code, output+'\nValueError: Unrelated error\n', diagnostic, False),
                ]:
                    actual = bool(intended(c, o, d))
                    assert actual == wanted, label+' native oracle '+name
                    oracles.append({'case': label, 'oracle': name, 'accepted': actual})
                controls.append({'case': label, 'outcome': 'intended_failure', 'diagnostic': diagnostic})
            finally:
                for path, payload in originals.items():
                    path.write_bytes(payload)
        positive('restored')
        (out/'controls.json').write_text(json.dumps(controls, indent=2)+'\n')
        (out/'oracles.json').write_text(json.dumps(oracles, indent=2)+'\n')
        (out/'bindings.json').write_text(json.dumps({str(path.relative_to(repo)):
            hashlib.sha256(payload).hexdigest() for path, payload in originals.items()}, indent=2)+'\n')
        group = Path('/sys/fs/cgroup')/Path('/proc/self/cgroup').read_text().split('0::', 1)[1].strip().lstrip('/')
        (out/'resources.json').write_text(json.dumps({key: (group/key).read_text().strip()
            for key in ['memory.max', 'memory.peak', 'memory.swap.max', 'memory.swap.peak', 'memory.events']}, indent=2)+'\n')
        print(json.dumps({'positive': 4, 'faults': len(cases), 'oracles': len(oracles)}), flush=True)
    finally:
        for path, payload in originals.items():
            path.write_bytes(payload)
            assert path.read_bytes() == payload


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve())
