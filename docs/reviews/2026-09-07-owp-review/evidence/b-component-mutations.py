from pathlib import Path
import subprocess,json
root=Path('/home/nathaniel/.local/state/openplan/owp-review-2026-09-07/openplan')
source=(root/'src/components/programs/work-program/workflow.tsx').read_text().replace('"./exports"','"@/components/programs/work-program/exports"').replace('"./fields"','"@/components/programs/work-program/fields"')
cases={'baseline':source,'harmless_comment':source+'\n// Independent harmless survivor.\n','stale_public_attestation':source.replace('publicReviewedFor === disclosureIdentity','publicReviewedFor !== null'),'lost_recovered_revision':source.replace('setSelected(parsed.data.revisionId);',''),'lost_unreadable_draft':source.replace('sessionStorage.setItem(`${recoveryKey}:unreadable`,form);','')}
results=[]
for name,content in cases.items():
 if name not in ['baseline','harmless_comment'] and content==source:raise RuntimeError('Mutation not applied '+name)
 Path('/tmp/owp-review-b/workflow-under-test.tsx').write_text(content)
 out='/tmp/owp-review-b/component-'+name+'.json'
 run=subprocess.run([str(root/'node_modules/.bin/vitest'),'run','--config','/tmp/owp-review-b/vitest.config.ts','--reporter=json','--outputFile='+out],cwd=root,capture_output=True,text=True)
 report=json.load(open(out))
 results.append({'case':name,'exit':run.returncode,'passed':report['numPassedTests'],'failed':report['numFailedTests'],'failures':[{'name':t['fullName'],'reason':t['failureMessages']} for suite in report['testResults'] for t in suite['assertionResults'] if t['status']=='failed']})
Path('/tmp/owp-review-b/workflow-under-test.tsx').write_text(source)
Path('/tmp/owp-review-b/component-mutations.json').write_text(json.dumps(results,indent=2))
print(json.dumps([{k:r[k] for k in ['case','exit','passed','failed']} for r in results]))
