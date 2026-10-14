"""Challenge callback replay and observed-row guards, restoring source in finally."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess


def run(repo, out, before=None):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    route = repo/'openplan/src/app/api/aerial/processing-callback/route.ts'
    original = route.read_bytes()
    source = original.decode()
    tests = 'src/test/aerial-processing-callback-route.test.ts'
    cases, rows, oracles = [], [], []
    def fault(name, left, right, test, message):
        assert source.count(left) == 1, name+' requires one source binding'
        cases.append((name, source.replace(left, right), test, message))
    early = 'return NextResponse.json({ ok: true, deduped: true }, { status: 200 });'
    for name, test, message in [
        ('original-replay-skipped', 'resumes an exact redelivery without a second evidence insert', 'Exact retained retry must apply pending effects'),
        ('interrupted-status-skipped', 'finishes a job update after its original ledger write survived an error', 'Interrupted ledger replay must finish status'),
        ('interrupted-evidence-skipped', 'finishes evidence creation after its original job update survived an error', 'Interrupted ledger replay must finish evidence'),
    ]:
        fault(name, 'replayed = true;', early, test, message)
    fault('lookup-error-ignored', 'if (retainedError)', 'if (false)',
        'refuses a duplicate whose original callback cannot be read', 'Unavailable original cannot acknowledge replay')
    for name, left in [('job-scope-ignored', 'retained.processing_job_id !== job.id'),
            ('workspace-scope-ignored', 'retained.workspace_id !== job.workspace_id'),
            ('payload-ignored', '!isDeepStrictEqual(retained.payload, JSON.parse(JSON.stringify(callback)))')]:
        fault(name, left, 'false', 'refuses changed or missing duplicate payload and scope without applying it', 'Changed callback originals cannot be applied')
    fault('worker-reference-refusal-ignored',
        'return NextResponse.json({ error: "job_reference_mismatch" }, { status: 409 });', '',
        'refuses a different worker job reference before recording or applying it', 'Different worker reference cannot be applied')
    fault('observed-status-not-guarded', '.eq("status", job.status)', '',
        'requires the observed state and worker reference in the status write', 'Write guards observed status')
    fault('observed-reference-not-guarded', ': statusWrite.eq("job_reference", job.job_reference)', ': statusWrite',
        'requires the observed state and worker reference in the status write', 'Write guards observed worker reference')
    fault('null-reference-not-guarded', 'statusWrite.is("job_reference", null)', 'statusWrite.eq("job_reference", null)',
        'guards an unset worker reference before assigning the first one', 'Write guards original null reference')
    fault('affected-row-not-checked', 'if (appliedJobs?.length !== 1 || appliedJobs[0].id !== job.id)', 'if (false)',
        'retries a changed or missing job without applying downstream artifacts', 'Changed or missing job cannot apply artifacts')
    fault('foreign-affected-row-accepted', 'if (appliedJobs?.length !== 1 || appliedJobs[0].id !== job.id)', 'if (appliedJobs?.length !== 1)',
        'retries a changed or missing job without applying downstream artifacts', 'Changed or missing job cannot apply artifacts')
    fault('duplicate-affected-rows-accepted', 'if (appliedJobs?.length !== 1 || appliedJobs[0].id !== job.id)', 'if (appliedJobs?.[0]?.id !== job.id)',
        'retries a changed or missing job without applying downstream artifacts', 'Changed or missing job cannot apply artifacts')
    fault('replay-projection-omits-original', '.select("processing_job_id, workspace_id, payload")', '.select("processing_job_id, workspace_id")',
        'resumes an exact redelivery without a second evidence insert', 'Replay loads both scope and payload')
    fault('original-job-id-not-bound', '.eq("id", job.id)', '.eq("id", "other-job")',
        'requires the observed state and worker reference in the status write', 'Write guards original job identity')
    fault('original-callback-key-not-bound', '.eq("callback_id", callback.callbackId)', '.eq("callback_id", callback.requestId)',
        'resumes an exact redelivery without a second evidence insert', 'Replay loads exact original callback key')
    fault('affected-projection-not-bound', ').select("id");', ').select("id, status");',
        'requires the observed state and worker reference in the status write', 'Write verifies affected job projection')

    def execute(label, test=None):
        destination = out/(label+'.json')
        command = ['node', '--max-old-space-size=512', 'node_modules/vitest/vitest.mjs', 'run', tests,
            '--maxWorkers=1', '--no-file-parallelism', '--reporter=json', '--outputFile='+str(destination)]
        if test:
            command += ['-t', test]
        p = subprocess.run(command, cwd=repo/'openplan', capture_output=True, text=True, timeout=90)
        (out/(label+'-private.log')).write_text(p.stdout+p.stderr)
        return p.returncode, json.loads(destination.read_bytes())
    def accepted(code, result, test, diagnostic):
        failed = [case for group in result['testResults'] for case in group['assertionResults'] if case['status']=='failed']
        return code == 1 and len(failed) == 1 and failed[0]['title']==test and diagnostic in '\n'.join(failed[0]['failureMessages'])
    def positive(label):
        code, result = execute(label)
        assert code == 0 and result['numPassedTests']==20 and result['numFailedTests']==0, label+' callback cohort failed'
        rows.append({'case':label,'outcome':'survived','tests':20})
    try:
        positive('baseline')
        route.write_bytes(original+b'\n// Harmless callback recovery comment.\n')
        positive('harmless-comment')
        route.write_bytes(original)
        positive('restored-after-harmless')
        if before:
            route.write_bytes(before.read_bytes())
            name='finishes a job update after its original ledger write survived an error'
            code,result=execute('historical-before-fix',name)
            assert accepted(code,result,name,'Interrupted ledger replay must finish status'), 'Historical retry must fail its intended new assertion'
            route.write_bytes(original)
        for label, altered, test, message in cases:
            try:
                route.write_text(altered)
                code,result=execute(label,test)
                assert accepted(code,result,test,message), label+' missed intended callback assertion'
                for name,c,r,t,d,wanted in [('exact',code,result,test,message,True),
                    ('successful-exit',0,result,test,message,False), ('wrong-exit',2,result,test,message,False),
                    ('wrong-test',code,result,'other callback test',message,False), ('wrong-message',code,result,test,'absent diagnostic',False)]:
                    value=accepted(c,r,t,d);assert value==wanted,label+' oracle '+name
                    oracles.append({'case':label,'oracle':name,'accepted':value})
                rows.append({'case':label,'outcome':'intended_failure','test':test,'diagnostic':message})
            finally:
                route.write_bytes(original)
        positive('restored')
        (out/'controls.json').write_text(json.dumps(rows,indent=2)+'\n')
        (out/'oracles.json').write_text(json.dumps(oracles,indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({str(route.relative_to(repo)):hashlib.sha256(original).hexdigest()},indent=2)+'\n')
        print(json.dumps({'positive':4,'faults':len(cases),'oracles':len(oracles)}),flush=True)
    finally:
        route.write_bytes(original)
        assert route.read_bytes()==original


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--repo',type=Path,required=True);parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--before-route',type=Path)
    args=parser.parse_args();run(args.repo.resolve(),args.out.resolve(),args.before_route)
