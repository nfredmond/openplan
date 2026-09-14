"""Check the real parent component join, with synthetic HTTP and no provider call."""
from pathlib import Path
import hashlib, json, subprocess, time
review=Path(__file__).resolve().parent; app=review.parents[2]/'openplan'
path=app/'src/components/engagement/campaign-translations-panel.tsx'; original=path.read_text()
test=app/'src/test/translation-generation-parent.test.tsx'
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/generation-parent-controls')/time.strftime('%Y%m%dT%H%M%S'); private.mkdir(parents=True)
cases=[('baseline',original,False),('harmless-parent',original+'\n// Harmless parent integration control.\n',False)]
def mutate(name,old,new):
    assert original.count(old)==1,(name,original.count(old)); cases.append((name,original.replace(old,new),True))
mutate('bypass-generation-hook','await generation.start(prepareTranslationGeneration({ userId, workspaceId, campaignId }, snapshot, addresses, locale));','void prepareTranslationGeneration({ userId, workspaceId, campaignId }, snapshot, addresses, locale);')
mutate('omit-original-history','if (viewed.fields.some(field => fieldIds.includes(field.id) && field.address.expectedTranslation !== null))','if (false)')
mutate('replace-publication-reason','prepareRetainedPublication({ userId, workspaceId, campaignId }, viewed, fieldIds, reason, history)','prepareRetainedPublication({ userId, workspaceId, campaignId }, viewed, fieldIds, "SYNTHETIC substituted reason", history)')
results=[]
try:
    for name,body,broken in cases:
        assert path.read_text()==original; path.write_text(body); output=private/(name+'.json')
        try: run=subprocess.run(['npm','exec','--','vitest','run',str(test.relative_to(app)),'--reporter=json','--outputFile='+str(output)],cwd=app,text=True,capture_output=True,timeout=40)
        finally: path.write_text(original)
        (private/(name+'.log')).write_text(run.stdout+run.stderr)
        report=json.loads(output.read_text()); failures=[item['fullName'] for suite in report['testResults'] for item in suite['assertionResults'] if item['status']=='failed']
        correct=run.returncode!=0 and report['numFailedTests']==1 and len(failures)==1 and 'queues reviewed source then publishes selected retained output separately' in failures[0] if broken else run.returncode==0 and report['numPassedTests']==1
        results.append({'case':name,'outcome':'killed' if run.returncode else 'survived','expectedOutcome':correct,'failedAssertions':failures})
        (review/'generation-parent-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(original.encode()).hexdigest(),'testSha256':hashlib.sha256(test.read_bytes()).hexdigest(),'privateEvidence':str(private),'results':results,'limits':'Actual parent, generation, publication and draft React components in jsdom with mocked HTTP. Does not establish browser geometry, database or worker execution, or public portal behavior.'},indent=2)+'\n')
        print(name,results[-1]['outcome'],'expected' if correct else 'UNEXPECTED',flush=True); assert correct,(name,failures)
finally: assert path.read_text()==original
