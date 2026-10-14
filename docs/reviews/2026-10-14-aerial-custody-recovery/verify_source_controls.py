"""Challenge conflict recovery and package claims, restoring every edit in finally."""
import argparse, hashlib, json, os, re, subprocess
from pathlib import Path
FILES = ['aerial-artifact-custody.test.ts', 'aerial-artifact-custody-retry-route.test.ts', 'aerial-processing-callback-route.test.ts', 'aerial-artifact-custody-reaches-a-planner.test.tsx']

def run(repo, out):
    os.umask(0o077); out.mkdir(mode=0o700, parents=True)
    engine=repo/'openplan/src/lib/aerial/artifact-custody-server.ts'
    retry=repo/'openplan/src/app/api/aerial/processing-callback/custody/route.ts'
    callback=repo/'openplan/src/app/api/aerial/processing-callback/route.ts'
    originals={p:p.read_bytes() for p in [engine,retry,callback]}
    controls=[]; oracles=[]
    def execute(label, filename=None, pattern=None):
        target=out/(label+'.json')
        cmd=['npm','exec','--','vitest','run']+['src/test/'+f for f in ([filename] if filename else FILES)]+['--maxWorkers=1','--no-file-parallelism','--reporter=json','--outputFile='+str(target)]
        if pattern: cmd+=['--testNamePattern',pattern]
        r=subprocess.run(cmd,cwd=repo/'openplan',capture_output=True,text=True,timeout=60)
        (out/(label+'-private.log')).write_text(r.stdout+r.stderr)
        return r.returncode,json.loads(target.read_text())
    def accepted(code,data,pattern,reason):
        failed=[t for f in data['testResults'] for t in f['assertionResults'] if t['status']=='failed']
        return code==1 and len(failed)==1 and pattern in failed[0]['fullName'] and reason in ' '.join(failed[0]['failureMessages']) and not any(x in ' '.join(failed[0]['failureMessages']) for x in ['SyntaxError:','TypeError:','ReferenceError:'])
    def positive(label):
        code,data=execute(label)
        assert code==0 and data['numPassedTests']==88 and data['numFailedTests']==0,label+' passes full88-case cohort'
        assert {Path(f['name']).name for f in data['testResults']}==set(FILES)
        controls.append({'case':label,'outcome':'survived','tests':88})
    def change(p,old,new):
        text=originals[p].decode(); assert old in text,old
        return text.replace(old,new,1)
    cases=[
      ('conflict-not-recovered',engine,change(engine,'if (writeError?.code === "23514" && writeError.message === "Original held aerial custody cannot be replaced")','if (writeError?.code === "NEVER")'),FILES[0],'rereads preserved held rows','Conflict recovery reads preserved custody'),
      ('missing-roster-ignored',engine,change(engine,'if (missing.length > 0)','if (false)'),FILES[0],'does not publish a partial retained roster','Missing expected identity requires retry'),
      ('unreadable-recovery-hidden',engine,change(engine,'unreadableReason: `Artifact custody for this processing job could not be read: ${error.message ?? "unknown database error"}`','unreadableReason: null'),FILES[0],'keeps an unreadable conflict reread','Unreadable conflict reread cannot publish success'),
      ('retry-unreadable-published',retry,change(retry,'if (result.unreadableReason)','if (false)'),FILES[1],'preserves package readiness when a conflicting','Partial conflict roster remains retryable'),
      ('retry-roster-dropped',retry,change(retry,'candidates,\n      elapsedMs:', 'candidates: candidates.filter((candidate) => heldKeys.has(`${candidate.kind}:${candidate.ordinal}`)),\n      elapsedMs:'),FILES[1],'retries an absent original','Missing original identity is retried'),
      ('all-held-repair-skipped',retry,change(retry,'const heldKeys =', 'if (custodyRows.length > 0 && custodyRows.every((row) => row.state === "held")) return NextResponse.json({ custodyState: "complete", retriedCount: 0 });\n    const heldKeys ='),FILES[1],'answers without touching','Held retry repairs stale package readiness'),
      ('retry-human-filter-removed',retry,change(retry,'.eq("verification_readiness", "pending")','.eq("verification_readiness", "partial")'),FILES[1],'answers without touching','Custody retry preserves human verification'),
      ('retry-pending-downgrade',retry,change(retry,'if (result.posture.verificationReadiness === "partial")','if (true)'),FILES[1],'does not lower package readiness','Older pending posture cannot lower package readiness'),
      ('callback-unreadable-published',callback,change(callback,'if (custodyResult.unreadableReason)','if (false)'),FILES[2],'does not create a package from an unreadable','Unreadable callback custody remains retryable'),
      ('callback-repair-skipped',callback,change(callback,'if (custody.verificationReadiness === "partial")','if (false)'),FILES[2],'repairs pending package custody','Callback repairs pending package custody'),
      ('callback-human-filter-removed',callback,change(callback,'.eq("verification_readiness", "pending")','.eq("verification_readiness", "partial")'),FILES[2],'repairs pending package custody','Callback preserves human verification'),
      ('callback-pending-downgrade',callback,change(callback,'if (custody.verificationReadiness === "partial")','if (true)'),FILES[2],'leaves existing package verification','Pending callback cannot lower human verification'),
    ]
    cases += [
      ('existing-pending-count-lost',engine,change(engine,'pendingCount: retainedPosture.pendingCount + missing.length','pendingCount: missing.length'),FILES[0],'counts existing pending records','Missing roster retains existing pending count'),
      ('package-repair-failure-hidden',retry,change(retry,'return NextResponse.json({ error: "Failed to update evidence custody readiness" }, { status: 503 });','void 0;'),FILES[1],'returns a retryable error if pending','Package readiness repair failure remains retryable'),
    ]
    cases += [
      ('unrelated-constraint-recovered',engine,change(engine,' && writeError.message === "Original held aerial custody cannot be replaced"',''),FILES[0],'does not recover unrelated constraint','Only the named held constraint enters recovery'),
    ]
    cases += [('planner-human-filter-removed',callback,change(callback,'.eq("verification_readiness", "pending")','.eq("verification_readiness", "partial")'),FILES[3],'writes a PARTIALLY-VERIFIED','Planner custody repair preserves human verification')]
    # Changed georeference fixtures must still detect broken production writes.
    for label,pattern,reason in [('georef-valid','passes a v1.1','Valid callback georeference remains recorded'),('georef-refused','refuses an implausible','Refused callback georeference remains null'),('georef-absent','a v1 artifact with no georef','Absent callback georeference remains null')]:
        cases.append((label,engine,change(engine,'bounds_west: georef?.boundsWest ?? null,','bounds_west: 1,'),FILES[2],pattern,reason))
    try:
        positive('baseline'); engine.write_bytes(originals[engine]+b'\n// Harmless conflict recovery comment.\n'); positive('harmless-comment')
        engine.write_bytes(originals[engine]);positive('restored-after-harmless')
        for label,path,text,filename,pattern,reason in cases:
            try:
                assert text.encode()!=originals[path];path.write_text(text)
                code,data=execute(label,filename,pattern)
                assert accepted(code,data,pattern,reason),label+' reaches intended assertion'
                for name,c,d,p,r,wanted in [('exact',code,data,pattern,reason,True),('success',0,data,pattern,reason,False),('wrong-exit',2,data,pattern,reason,False),('wrong-reason',code,data,pattern,'unrelated error',False),('wrong-test',code,data,'unrelated test',reason,False)]:
                    actual=accepted(c,d,p,r);assert actual==wanted;oracles.append({'case':label,'oracle':name,'accepted':actual})
                controls.append({'case':label,'outcome':'intended_failure','diagnostic':reason})
            finally:
                for p,raw in originals.items():p.write_bytes(raw)
        positive('restored')
        bindings={str(p.relative_to(repo)):hashlib.sha256(p.read_bytes()).hexdigest() for p in list(originals)+[repo/'openplan/src/test'/f for f in FILES]}
        for name,value in [('controls',controls),('oracles',oracles),('bindings',bindings)]: (out/(name+'.json')).write_text(json.dumps(value,indent=2)+'\n')
        print({'positives':4,'faults':len(cases),'oracles':len(oracles)})
    finally:
        for p,raw in originals.items():p.write_bytes(raw); assert p.read_bytes()==raw
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();run(a.repo.resolve(),a.out.resolve())
