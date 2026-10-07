"""Mutate private source copies only. A failing process alone is not a killed mutation."""
from pathlib import Path
import os
import subprocess
root=Path(__file__).resolve().parents[4]
evidence=Path(__file__).resolve().parent
mutant=evidence/'providers-mutant.ts'
config=str(evidence/'providers-approval.vitest.config.ts')
cmd=[str(root/'openplan/node_modules/.bin/vitest'),'run','--config',config]
results=[]
try:
    for kind,source,test_name,changes in [
        ('approval','openplan/src/lib/assistant/action-approval-server.ts','rejects a changed signed note before a financial write',[( 'if (headerHash !== inputHash)', 'if (false)'),('    data.input_hash !== inputHash ||\n','')]),
        ('output','openplan/src/lib/assistant/provider-project-task.ts','invalid trimmed answer remains a completed local journal after cancellation and repeated recovery', [('answer: z.string().trim().min(1).max(12_000)', 'answer: z.string().min(1).max(12_000)')]),
    ]:
        original=(root/source).read_text().replace('"./project-submittal-receipt"', '"@/lib/assistant/project-submittal-receipt"')
        for mode in ['noop','broken']:
            content=original+'\n// Independent review harmless control.\n'
            if mode=='broken':
                for before,after in changes:
                    assert before in content
                    content=content.replace(before,after)
            mutant.write_text(content)
            result=subprocess.run(cmd,cwd=root,env={**os.environ,'OPENPLAN_REVIEW_MUTANT':kind},text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
            (evidence/f'providers-mutation-{kind}-{mode}.txt').write_text(result.stdout)
            if mode=='noop':
                assert result.returncode==0,result.stdout
                results.append(f'{kind}: harmless source comment survived; all observation controls retained.')
            else:
                assert result.returncode!=0 and test_name in result.stdout and ('AssertionError' in result.stdout or 'unexpected success' in result.stdout),result.stdout
                results.append(f'{kind}: targeted mutation failed named behavior assertion, not test startup. See exact output.')
finally:
    mutant.unlink(missing_ok=True)
print('\n'.join(results))
