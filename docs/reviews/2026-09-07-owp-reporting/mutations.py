"""Run only in an isolated checkout; restore every edited file in finally."""
from pathlib import Path
import subprocess,json,os
app=Path.cwd(); out=Path(os.environ['OWP_MUTATION_OUTPUT']);out.mkdir(parents=True,exist_ok=True)
pure='src/test/work-program-reporting.test.ts'
cases=[
 ('no-op','src/lib/programs/work-program/reporting.ts','Fixed decimal arithmetic','Exact fixed decimal arithmetic',[pure],True),
 ('billing-is-not-cost','src/lib/programs/work-program/reporting.ts','kind === "billed" ? "billed"','kind === "billed" ? "incurred"',[pure],False),
 ('opening-not-period','src/lib/programs/work-program/reporting.ts','v.kind !== "opening"','true',[pure],False),
 ('source-dedup','src/lib/programs/work-program/reporting-import.ts','new Set(existingKeys)','new Set<string>()',[pure],False),
 ('retained-hash','src/lib/programs/work-program/reporting-import.ts','sha256:${hash}','sha256:missing',[pure],False),
 ('money-precision','src/lib/programs/work-program/reporting.ts','value < BigInt(0) ? -value : value','value < BigInt(0) ? -value : value + BigInt(1)',[pure],False),
 ('source-escaping','src/lib/programs/work-program/reporting-export.ts','${escape(value)}</p>','${value}</p>',[pure],False),
 ('workbook-wrap','src/lib/programs/work-program/export.ts',' || workbook.Sheets["Budget position"]','',[pure],False),
 ('migration-inventory','supabase/migrations/20260910000001_work_program_actuals.sql','ALTER TABLE public.work_program_cost_rates ENABLE ROW LEVEL SECURITY;','-- deliberate missing RLS',['src/test/migrations/inventory.test.ts'],False),
 ('viewer-policy-scope','supabase/migrations/20260910000003_work_program_report_exports.sql','AS RESTRICTIVE FOR ALL TO authenticated','AS PERMISSIVE FOR ALL TO authenticated',['src/test/viewer-write-denial-guard.test.ts'],False),
 ('pagination-cap','src/lib/programs/work-program/reporting-server.ts','if (page.length < 200) return rows;','return rows;',['src/test/work-program-reporting-pagination.test.ts'],False),
 ('allocation-projection','src/lib/programs/work-program/reporting-server.ts','id, actual_version_id, element_id','id, element_id',['src/test/work-program-reporting-pagination.test.ts'],False),
 ('release-count','src/test/migrations/release-ordering.test.ts','migrationsAtRelease: 271','migrationsAtRelease: 272',['src/test/migrations/release-ordering.test.ts'],False),
 ('direction-release','../docs/product/US_PLANNING_CAPABILITY_REGISTRY.json','"currentRelease": "v0.45.0"','"currentRelease": "v0.46.0"',['src/test/product-direction-review-guard.test.ts'],False),
 ('rls-probe-census','src/test/rls-isolation.test.ts','  "work_program_actual_versions",','  // deliberate missing actual probe',['src/test/rls-isolation.test.ts'],False),
 ('staff-link-payload','src/components/invoicing/staff-and-rates-panel.tsx','userId: staffUserId ?? undefined,','userId: undefined,',['src/test/work-program-staff-link.test.tsx'],False),
 ('staff-link-projection','src/app/(app)/invoicing/_components/receivables-lane.tsx','id, name, title, user_id, default_labor_category','id, name, title, default_labor_category',['src/test/work-program-staff-link.test.tsx'],False),
 ('unknown-opening-hours','src/lib/programs/work-program/reporting.ts','const unknownHours = actuals.filter(v => (v.kind === "labor" || v.kind === "opening") && v.hours === null).length;','const unknownHours = 0;',['src/test/work-program-reporting.test.ts'],False),
 ('form-scope','src/test/create-forms-inline-ratchet.test.ts','"src/components/programs/work-program/actual-entry.tsx":','"src/components/programs/work-program/missing-actual-entry.tsx":',['src/test/create-forms-inline-ratchet.test.ts'],False),
]
selected=os.environ.get("OWP_MUTATION_CASES", "").split(",")
if selected != [""]: cases=[c for c in cases if c[0] in selected or c[0]=="no-op"]
results=[]
for name,file,before,after,tests,survive in cases:
 path=app/file;original=path.read_text();assert before in original,(name,'mutation absent')
 try:
  path.write_text(original.replace(before,after,1));p=subprocess.run(['npm','exec','--','vitest','run',*tests],cwd=app,text=True,capture_output=True);log=p.stdout+p.stderr
  (out/(name+'.log')).write_text(log)
  observed=p.returncode==0
  assert observed==survive,(name,'unexpected survived' if observed else log[-3500:])
  if not survive:assert 'AssertionError' in log or 'FAIL ' in log,(name,'non-assertion failure')
  results.append({'case':name,'result':'survived' if observed else 'failed as expected','tests':tests})
 finally:path.write_text(original)
 (out/'mutations.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results))
