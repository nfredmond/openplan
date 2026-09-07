from pathlib import Path
import subprocess,json
root=Path('/home/nathaniel/.local/state/openplan/owp-review-2026-09-07/openplan');folder=Path('/tmp/owp-review-b')
source=(root/'src/lib/programs/work-program/workflow-export.ts').read_text().replace('"./workflow"','"@/lib/programs/work-program/workflow"')
test=(root/'src/test/work-program-packet-layout.test.ts').read_text().replace('"@/lib/programs/work-program/workflow-export"','"./layout-under-test"')
(folder/'layout.test.ts').write_text(test)
config=(folder/'vitest.config.ts').read_text().replace("include:['component.test.tsx']","include:['layout.test.ts']")
(folder/'layout.config.ts').write_text(config)
cases={'baseline':source,'harmless_comment':source+'\n// Harmless layout survivor.\n','unbounded_newlines':source.replace('if (character === "\\n") { lines++; columns = 0; }','if (character === "\\n") { columns = 0; }'),'unbounded_wrapping':source.replace('if (columns === 60 && character !== "\\n")','if (false)'),'wide_identity_column':source.replace('label.length > 120','label.length > 120000'),'split_unicode':source.replace('for (const character of value)','for (const character of value.split(""))')}
results=[]
for name,content in cases.items():
 if name not in ['baseline','harmless_comment'] and content==source:raise RuntimeError('Mutation not applied '+name)
 (folder/'layout-under-test.ts').write_text(content)
 out=folder/('layout-'+name+'.json')
 run=subprocess.run([str(root/'node_modules/.bin/vitest'),'run','--config',str(folder/'layout.config.ts'),'--reporter=json','--outputFile='+str(out)],cwd=root,capture_output=True,text=True)
 report=json.loads(out.read_text())
 results.append({'case':name,'exit':run.returncode,'passed':report['numPassedTests'],'failed':report['numFailedTests'],'failures':[{'name':t['fullName'],'reason':t['failureMessages']} for suite in report['testResults'] for t in suite['assertionResults'] if t['status']=='failed']})
(folder/'layout-under-test.ts').write_text(source)
(folder/'layout-mutations.json').write_text(json.dumps(results,indent=2))
print(json.dumps([{k:r[k] for k in ['case','exit','passed','failed']} for r in results]))
