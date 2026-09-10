from pathlib import Path
import subprocess,json
root=Path('/home/nathaniel/.local/state/openplan/m2d4-period-closure-2026-09-09/openplan');out=Path('/home/nathaniel/.local/state/openplan/m2d4-period-closure-evidence-2026-09-09')
ui=root/'src/components/programs/work-program/closeout-panel.tsx';route=root/'src/app/api/programs/[programId]/work-program/closeout/route.ts';schema=root/'src/lib/programs/work-program/closeout.ts'
cases=[('harmless comment',ui,'"use client";','"use client";\n// Harmless control',True),('closed reconciliation action',ui,'|| closed || !note.trim()','|| !note.trim()',False),('close decision command',ui,'kind: closed ? "reopen_period" : "close_period"','kind: closed ? "close_period" : "reopen_period"',False),('closure expected version',ui,'expectedClosureVersion: data.closures?.at(-1)?.version ?? 0','expectedClosureVersion: 99',False),('closure restore schema',schema,'kind: z.literal("close_period"), expectedClosureVersion: z.number().int().nonnegative()','kind: z.literal("closed_period"), expectedClosureVersion: z.number().int().nonnegative()',False),('missing closure history',route,'closures: closures.sort((a, b) => Number(a.version) - Number(b.version))','closures: undefined',False),('closure projection',route,'content, content_hash, actor_id, created_at','content, actor_id, created_at',False),('closure wrong scope',route,'["program_id", access.programId]','["program_id", "foreign"]',False),('closure RPC dispatch',route,'? "work_program_period_closure_command" :','? "work_program_closeout_command" :',False),('closure failed read hidden',route,'{ status: 503 }); }','{ status: 200 }); }',False),('closure missing version allowed',schema,'expectedClosureVersion: z.number().int().nonnegative()','expectedClosureVersion: z.number().int().nonnegative().optional()',False)]
results=[]
for index,(name,path,old,new,survive) in enumerate(cases):
 original=path.read_text();assert old in original,name
 try:
  path.write_text(original.replace(old,new))
  r=subprocess.run(['node','node_modules/vitest/vitest.mjs','run','src/test/work-program-closeout.test.tsx','src/test/work-program-closeout-route.test.ts'],cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 finally:path.write_text(original)
 (out/f'ui-mutation-{index}.log').write_text(r.stdout)
 result={'name':name,'exit':r.returncode,'expected':'survived' if survive else 'detected','matched':(r.returncode==0)==survive};results.append(result);(out/'ui-mutations.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(result),flush=True)
 if not result['matched']:raise SystemExit(1)
