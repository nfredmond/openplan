from pathlib import Path
import subprocess, json
root=Path(__file__).resolve().parents[4]
app=root/'openplan'
cases=[
 ('harmless', 'src/components/programs/work-program/workflow.tsx', '"use client";', '"use client";\n// Harmless review mutation.', True, 'work-program-review-ui.test.tsx'),
 ('hidden_authority','src/components/programs/work-program/workflow.tsx','authority: authorityAction ? authority : "", scope: authorityAction ? scope : "", evidenceDate: authorityAction ? evidenceDate || null : null','authority, scope, evidenceDate: evidenceDate || null',False,'work-program-review-ui.test.tsx'),
 ('undated_due','src/lib/my-work/sources.ts','badge: dueOn ? deadlineBadge("OWP review", overdue) : { label: row.status === "returned" ? "Changes requested" : "OWP review", tone: "neutral" }','badge: deadlineBadge("OWP review", overdue)',False,'work-program-workflow.test.ts'),
 ('collapsing_title','src/components/programs/work-program/element-editor.tsx','open={expanded}','open={!element.title}',False,'work-program-element-editing.test.tsx'),
]
results=[]
for name,file,old,new,passes,test in cases:
 p=app/file;original=p.read_bytes();text=original.decode();assert old in text,(name,'missing target')
 try:
  p.write_text(text.replace(old,new,1))
  result=subprocess.run(['npm','exec','--','vitest','run','src/test/'+test],cwd=app,text=True,capture_output=True)
  Path('/tmp/owp-review-root-'+name+'.log').write_text(result.stdout+result.stderr)
  actual=result.returncode==0
  results.append({'name':name,'expectedPass':passes,'passed':actual,'exit':result.returncode,'test':test})
  assert actual==passes,(name,result.stdout[-4000:]+result.stderr[-1000:])
 finally:p.write_bytes(original)
Path(__file__).with_suffix('.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2))
