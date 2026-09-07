from pathlib import Path
import subprocess,json
root=Path('/home/nathaniel/.local/state/openplan/owp-review-2026-09-07/openplan')
folder=Path('/tmp/owp-review-b')
export=(root/'src/lib/programs/work-program/workflow-export.ts').read_text().replace('"./workflow"','"./difference-under-test"')
diff=(root/'src/lib/programs/work-program/workflow.ts').read_text().replace('"./schema"','"/home/nathaniel/.local/state/openplan/owp-review-2026-09-07/openplan/src/lib/programs/work-program/schema"')
cases={'baseline':(export,diff),'harmless_comment':(export+'\n// No-op control\n',diff),'split_surrogates':(export.replace('Array.from(value)','value.split("")'),diff),'collapse_duplicate_ids':(export,diff.replace('if (left.size !== a.length || right.size !== b.length)', 'if (false)'))}
results=[]
for name,(a,b) in cases.items():
 if name not in ['baseline','harmless_comment'] and (a,b)==(export,diff):raise RuntimeError('Mutation not applied '+name)
 (folder/'export-under-test.ts').write_text(a);(folder/'difference-under-test.ts').write_text(b)
 run=subprocess.run([str(root/'node_modules/.bin/tsx'),'--tsconfig',str(root/'tsconfig.json'),str(folder/'pure-check.ts')],cwd=root,capture_output=True,text=True)
 results.append({'case':name,'exit':run.returncode,'stderr':run.stderr})
(folder/'export-under-test.ts').write_text(export);(folder/'difference-under-test.ts').write_text(diff)
(folder/'pure-mutations.json').write_text(json.dumps(results,indent=2))
print(json.dumps([{'case':r['case'],'exit':r['exit'],'assertion':next((x for x in r['stderr'].splitlines() if 'AssertionError' in x),'')} for r in results]))
