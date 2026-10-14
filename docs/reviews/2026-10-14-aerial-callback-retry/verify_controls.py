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
    order = repo/'openplan/src/lib/aerial/callback-order.ts'
    dispatch = repo/'openplan/src/app/api/aerial/missions/[missionId]/process/route.ts'
    originals = {route: route.read_bytes(), order: order.read_bytes(), dispatch: dispatch.read_bytes()}
    original = originals[route]
    source = original.decode()
    tests = ['src/test/aerial-processing-callback-route.test.ts', 'src/test/aerial-callback-order.test.ts', 'src/test/aerial-artifact-custody-reaches-a-planner.test.tsx', 'src/test/aerial-process-dispatch-route.test.ts']
    cases, rows, oracles = [], [], []
    def fault(name, left, right, test, message, target=route):
        text = originals[target].decode()
        assert text.count(left) == 1, name+' requires one source binding'
        cases.append((name, target, text.replace(left, right), test, message))
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
    fault('replay-projection-omits-original', '.select("processing_job_id, workspace_id, payload")\n          .eq("callback_id", callback.callbackId)', '.select("processing_job_id, workspace_id")\n          .eq("callback_id", callback.callbackId)',
        'resumes an exact redelivery without a second evidence insert', 'Replay loads both scope and payload')
    fault('original-job-id-not-bound', '.eq("id", job.id)\n      .eq("status", job.status)', '.eq("id", "other-job")\n      .eq("status", job.status)',
        'requires the observed state and worker reference in the status write', 'Write guards original job identity')
    fault('original-callback-key-not-bound', '.eq("callback_id", callback.callbackId)', '.eq("callback_id", callback.requestId)',
        'resumes an exact redelivery without a second evidence insert', 'Replay loads exact original callback key')
    fault('affected-projection-not-bound', ').select("id");', ').select("id, status");',
        'requires the observed state and worker reference in the status write', 'Write verifies affected job projection')

    fault('newer-event-order-ignored', 'if (order > 0 || (replayed && order === 0))', 'if (false)',
        'preserves a newer same-status event when an older original is replayed', 'Older replay cannot replace a newer same-status callback')
    fault('equal-event-replay-allowed', 'if (order > 0 || (replayed && order === 0))', 'if (order > 0)',
        'preserves a newer same-status event when an older original is replayed', 'Older replay cannot replace a newer same-status callback')
    fault('newer-retry-blocked', 'if (order > 0 || (replayed && order === 0))', 'if (true)',
        'allows a newer original retry and guards its observed callback identity', 'Write guards observed callback identity')
    fault('observed-event-id-omitted', ': referencedWrite.eq("last_callback_id", job.last_callback_id)', ': referencedWrite',
        'allows a newer original retry and guards its observed callback identity', 'Write guards observed callback identity')
    fault('observed-event-time-omitted', ': identifiedWrite.eq("last_callback_at", job.last_callback_at)', ': identifiedWrite',
        'allows a newer original retry and guards its observed callback identity', 'Write guards observed callback time')
    fault('empty-event-id-omitted', 'referencedWrite.is("last_callback_id", null)', 'referencedWrite',
        'guards empty callback identity and time on the first application', 'Write guards original empty callback identity')
    fault('empty-event-time-omitted', 'identifiedWrite.is("last_callback_at", null)', 'identifiedWrite',
        'guards empty callback identity and time on the first application', 'Write guards original empty callback time')
    fault('applied-order-read-unchecked', 'if (!legacyAccepted && (appliedError || !applied || applied.processing_job_id !== job.id', 'if (!legacyAccepted && (false || false || false',
        'refuses unreadable callback ordering without applying it', 'Unreadable callback order cannot apply effects')
    fault('applied-job-scope-ignored', 'applied.processing_job_id !== job.id', 'false',
        'refuses unreadable callback ordering without applying it', 'Unreadable callback order cannot apply effects')
    fault('applied-workspace-scope-ignored', 'applied.workspace_id !== job.workspace_id', 'false',
        'refuses unreadable callback ordering without applying it', 'Unreadable callback order cannot apply effects')
    fault('applied-callback-key-ignored', 'parsedApplied.data.callbackId !== job.last_callback_id', 'false',
        'refuses unreadable callback ordering without applying it', 'Unreadable callback order cannot apply effects')
    fault('fractional-precision-lost', '(match[2] ?? "").replace', '(match[2] ?? "").slice(0, 6).replace',
        'preserves fractional seconds beyond JavaScript and database precision', 'Callback ordering keeps all fractional digits', order)
    fault('fraction-zero-normalization-lost', '.replace(/0+$/, "")', '',
        'compares equal instants across offsets and trailing zeros', 'Offsets identify the same instant', order)
    fault('timezone-offset-lost', 'Date.parse(match[1] + match[3])', 'Date.parse(match[1] + "Z")',
        'compares equal instants across offsets and trailing zeros', 'Offsets identify the same instant', order)
    fault('whole-second-order-reversed', 'a.seconds < b.seconds ? -1 : 1', 'a.seconds < b.seconds ? 1 : -1',
        'orders different whole seconds before their fractional values', 'Whole seconds order callbacks first', order)
    fault('malformed-time-invented', 'if (!match) return null;', 'if (!match) return { seconds: 0, fraction: "" };',
        'refuses invalid or unzoned instants', 'Unknown callback time has no fabricated order', order)
    fault('nonfinite-time-accepted', 'if (!Number.isFinite(seconds)) return null;', '',
        'refuses invalid or unzoned instants', 'Unknown callback time has no fabricated order', order)

    fault('custody-status-filter-omitted', '.eq("status", job.status)', '',
        'writes a VERIFICATION-PENDING package, naming the reason, when the bytes could not be taken', 'Custody follows a guarded status write')
    fault('custody-returned-id-projection-unchecked', ').select("id");', ').select("id, status");',
        'writes a VERIFICATION-PENDING package, naming the reason, when the bytes could not be taken', 'Custody follows a checked returned job identity')
    fault('legacy-accepted-baseline-blocked', 'const legacyAccepted = !appliedError && !applied', 'const legacyAccepted = false && !appliedError && !applied',
        'advances a legacy accepted pointer whose synchronous event was never posted', 'First posted callback advances the legacy synchronous baseline')
    fault('legacy-baseline-status-not-bound', 'job.status === "accepted"', 'true',
        'refuses unreadable callback ordering without applying it', 'Unreadable callback order cannot apply effects')
    fault('package-deterministic-key-omitted', '            id: job.id,', '',
        'keeps one deterministic evidence package when exact retries overlap', 'Concurrent packages share the deterministic job primary key')
    fault('package-conflict-refused', 'if (insertError?.code === POSTGRES_UNIQUE_VIOLATION)', 'if (false)',
        'keeps one deterministic evidence package when exact retries overlap', 'Both exact retries complete after a primary-key conflict')
    fault('package-scope-projection-omitted', 'const packageColumns = "id, processing_job_id, workspace_id, mission_id, project_id, package_type";', 'const packageColumns = "id";',
        'keeps one deterministic evidence package when exact retries overlap', 'Package replay projects all original scope fields')
    fault('package-conflicting-key-not-bound', '.eq("id", job.id)\n            .maybeSingle()', '.eq("processing_job_id", job.id)\n            .maybeSingle()',
        'keeps one deterministic evidence package when exact retries overlap', 'Conflicting creation reads the deterministic original ID')
    fault('package-reuse-logged-as-creation', 'insertError?.code === POSTGRES_UNIQUE_VIOLATION ? "evidence_package_reused" : "evidence_package_created"', '"evidence_package_created"',
        'keeps one deterministic evidence package when exact retries overlap', 'Conflicting creation records reuse of the original package')
    fault('package-retained-id-not-checked', 'retainedPackage.id !== job.id', 'false',
        'refuses a conflicting package outside the exact original scope', 'Conflicting package retains exact binding: id')
    for field in ['processing_job_id', 'workspace_id', 'mission_id', 'project_id', 'package_type']:
        expected = {'processing_job_id':'job.id','workspace_id':'job.workspace_id','mission_id':'job.mission_id','project_id':'job.project_id','package_type':'"measurable_output"'}[field]
        fault('package-scope-' + field + '-ignored', 'value.' + field + ' === ' + expected, 'true',
            'refuses a conflicting package outside the exact original scope', 'Conflicting package retains exact binding: ' + field)
    fault('package-legacy-scope-ignored', 'if (existingPackage && !matchesPackageScope(existingPackage))', 'if (false)',
        'refuses a legacy linked package outside the processing scope', 'Legacy package must belong to the original processing scope')
    fault('accepted-ledger-not-recorded', 'payload: accepted,', 'payload: {},',
        'retains the original accepted payload before installing its ordering pointer', 'Accepted response reaches the private ledger', dispatch)
    fault('accepted-ledger-failure-ignored', 'if (!acceptedRecorded)', 'if (false)',
        'refuses an unavailable accepted ledger without installing an unreadable pointer', 'Missing accepted custody remains visible', dispatch)
    fault('accepted-conflict-scope-ignored', 'retained.processing_job_id === jobRow.id', 'true',
        'accepts only an exact scoped retained accepted response after a unique conflict', 'Foreign accepted receipt cannot supply a pointer', dispatch)
    fault('accepted-workspace-scope-ignored', 'retained.workspace_id === mission.workspace_id', 'true',
        'accepts only an exact scoped retained accepted response after a unique conflict', 'Foreign accepted receipt cannot supply a pointer: workspace_id', dispatch)
    fault('accepted-original-payload-ignored', 'isDeepStrictEqual(retained.payload, JSON.parse(JSON.stringify(accepted)))', 'true',
        'accepts only an exact scoped retained accepted response after a unique conflict', 'Foreign accepted receipt cannot supply a pointer: payload', dispatch)
    fault('accepted-original-record-not-required', 'retained != null && ', '',
        'accepts only an exact scoped retained accepted response after a unique conflict', 'Missing accepted receipt cannot supply a pointer', dispatch)
    fault('accepted-projection-not-bound', '.select("processing_job_id, workspace_id, payload")', '.select("payload")',
        'accepts only an exact scoped retained accepted response after a unique conflict', 'Read every binding needed for accepted replay', dispatch)
    fault('accepted-request-not-bound', '|| parsedAccepted.data.requestId !== requestId', '',
        'refuses an accepted response for a different request', 'Accepted response belongs to the original request', dispatch)
    fault('accepted-state-not-guarded', '.eq("status", "requested")', '',
        'retains the original accepted payload before installing its ordering pointer', 'Accepted response cannot overwrite running callback state', dispatch)
    def execute(label, test=None):
        destination = out/(label+'.json')
        command = ['node', '--max-old-space-size=512', 'node_modules/vitest/vitest.mjs', 'run', *tests,
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
        assert code == 0 and result['numPassedTests']==72 and result['numFailedTests']==0, label+' callback cohort failed'
        rows.append({'case':label,'outcome':'survived','tests':72})
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
        for label, target, altered, test, message in cases:
            try:
                target.write_text(altered)
                code,result=execute(label,test)
                assert accepted(code,result,test,message), label+' missed intended callback assertion'
                for name,c,r,t,d,wanted in [('exact',code,result,test,message,True),
                    ('successful-exit',0,result,test,message,False), ('wrong-exit',2,result,test,message,False),
                    ('wrong-test',code,result,'other callback test',message,False), ('wrong-message',code,result,test,'absent diagnostic',False)]:
                    value=accepted(c,r,t,d);assert value==wanted,label+' oracle '+name
                    oracles.append({'case':label,'oracle':name,'accepted':value})
                rows.append({'case':label,'outcome':'intended_failure','test':test,'diagnostic':message})
            finally:
                for path, data in originals.items(): path.write_bytes(data)
        positive('restored')
        (out/'controls.json').write_text(json.dumps(rows,indent=2)+'\n')
        (out/'oracles.json').write_text(json.dumps(oracles,indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({str(path.relative_to(repo)):hashlib.sha256(data).hexdigest() for path, data in originals.items()},indent=2)+'\n')
        print(json.dumps({'positive':4,'faults':len(cases),'oracles':len(oracles)}),flush=True)
    finally:
        for path, data in originals.items():
            path.write_bytes(data)
            assert path.read_bytes()==data


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--repo',type=Path,required=True);parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--before-route',type=Path)
    args=parser.parse_args();run(args.repo.resolve(),args.out.resolve(),args.before_route)
