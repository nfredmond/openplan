"""Check the reader's actual rejection paths, restoring source after each fault."""
from pathlib import Path
import hashlib
import json
import subprocess
import time

review=Path(__file__).resolve().parent
app=review.parents[2]/'openplan'
path=app/'src/lib/engagement/decision-request-resolution.ts'
original=path.read_text()
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context')/('resolution-reader-'+str(time.time_ns()))
private.mkdir()


def run(label):
    result=subprocess.run(['./node_modules/.bin/vitest','run','src/test/decision-request-resolution.test.ts','--reporter=json'],cwd=app,capture_output=True,text=True,timeout=60)
    (private/(label+'.log')).write_text(result.stdout+result.stderr)
    data=json.loads(result.stdout[result.stdout.index('{'):])
    return result,data


def main():
    results=[]
    try:
        for label,body in [('baseline',original),('harmless',original.replace('Confirm exact original copy','Confirm the exact original copy',1))]:
            path.write_text(body)
            result,data=run(label)
            assert result.returncode==0 and data['numPassedTests']==32 and data['numFailedTests']==0,(label,result.stdout,result.stderr)
            results.append({'name':label,'outcome':'passed','tests':32})
        faults=[
            ('outer-hashes','if (actual !== expected)','if (false)','refuses changed payload bytes'),
            ('payload-binding','!same(payload, { schema: 1, ...scope, ...intent })','false','binds payload copyJson'),
            ('scope-binding','!same({ campaignId: outcome.campaignId, workspaceId: outcome.workspaceId, actorId: outcome.actorId }, scope)','false','binds result actorId'),
            ('identity-binding','outcome.requestId !== intent.requestId || outcome.resolutionId !== intent.resolutionId','false','binds result requestId'),
            ('outcome-completeness','(outcome.state === "saved") !== (outcome.link !== null)','false','refuses incoherent state saved_without_link'),
            ('original-evidence','link = await readDecisionLink(outcome.link, scope);','link = { ...outcome.link, context: JSON.parse(outcome.link.context_text) };','validates original source evidence'),
            ('saved-actor-and-request','link.id !== intent.requestId || link.actor_id !== scope.actorId','false','binds saved link actor_id'),
            ('copy-encoding','typeof decoded !== "string" || JSON.stringify(decoded) !== value','false','refuses invalid opaque-copy encoding {}'),
            ('copy-byte-limit','new TextEncoder().encode(value).length > DECISION_RESOLUTION_COPY_LIMIT','false','counts encoded bytes rather than characters'),
            ('reason-whitespace','value.trim().length > 0','true','refuses invalid reasons of length'),
            ('reason-size','[...value].length <= 2000','true','refuses invalid reasons of length'),
            ('reason-encoding','value.isWellFormed()','true','refuses invalid reasons of length'),
            ('reason-null','!value.includes("\\0")','true','refuses invalid reasons of length'),
        ]
        for label,old,new,expected in faults:
            assert original.count(old)==1,(label,original.count(old))
            path.write_text(original.replace(old,new,1))
            result,data=run(label)
            failed=[t['fullName'] for suite in data['testResults'] for t in suite['assertionResults'] if t['status']=='failed']
            assert result.returncode!=0 and any(expected in name for name in failed),(label,failed,result.stderr)
            results.append({'name':label,'outcome':'killed','failedAssertions':failed})
            path.write_text(original)
    finally:path.write_text(original)
    packet={'sourceSha256':hashlib.sha256(original.encode()).hexdigest(),'testSha256':hashlib.sha256((app/'src/test/decision-request-resolution.test.ts').read_bytes()).hexdigest(),'results':results,'privateEvidence':str(private),'limits':['Native receipts are retained synthetic fixtures; SQL concurrency and live role checks are separate.','This reader does not yet transport or archive local copies.']}
    (review/'decision-resolution-reader-results.json').write_text(json.dumps(packet,indent=2)+'\n')
    print(json.dumps({'tests':32,'harmless':True,'faultsKilled':len(faults),'restored':path.read_text()==original}))


if __name__=='__main__':main()
