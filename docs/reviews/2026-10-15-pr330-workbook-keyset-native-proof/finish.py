"""Finish from retained readbacks without rerunning accepted native campaigns."""
import json,copy
import native as m
n=m.Native()
a=json.loads((m.BASE/'protected-before-private.json').read_text());z=json.loads((m.BASE/'protected-after-private.json').read_text());assert a==z,'protected full fingerprints'
f=json.loads((m.BASE/'files-before-private.json').read_text());assert f==json.loads((m.BASE/'files-after-private.json').read_text()),'protected files'
before=json.loads((m.BASE/'target-before-private.json').read_text());after=json.loads((m.BASE/'target-after-private.json').read_text())
diff=[k for k in before if before[k]!=after.get(k)]
assert diff==['catalog.pg_class'],'only the retained pg_class discrepancy is recognized, not accepted'
assert all(before[k]==after[k] for k in before if not k.startswith('catalog.')),'all fixture table rows/settings/database restored'
with n.connect(n.plan['target'],True) as c:
 stats=n.query(c,"select schemaname,relname,n_live_tup,n_dead_tup,last_autovacuum,last_autoanalyze from pg_stat_all_tables where schemaname='public' and relname in ('projects','workspace_members','workspaces') order by relname")
m.write(m.BASE/'target-statistics-private.json',stats)
pins=json.loads((m.BASE/'source-bindings.json').read_text())
for rel,v in pins['files'].items():
 assert m.sha((m.REPO/'openplan'/rel).read_bytes())==v['sha256'],'source checkout exact'
 assert m.sha((m.BASE/'module/openplan'/rel).read_bytes())==v['sha256'],'private source restored'
# Challenge the source fingerprint comparison with harmless, changed, and restored readbacks.
assert copy.deepcopy(a)==a
broken=copy.deepcopy(a);broken[m.SOURCE]['public.projects']['digest']='fault';assert broken!=a
assert copy.deepcopy(a)==a
# The target data comparison must reject a changed fixture digest and restore exactly.
rows={k:v for k,v in before.items() if not k.startswith('catalog.')}
assert copy.deepcopy(rows)==rows
broken=copy.deepcopy(rows);broken['public.projects']['digest']='fault';assert broken!=rows
assert copy.deepcopy(rows)==rows
m.write(m.BASE/'preservation.json',{'protected':{db:m.sha(v) for db,v in z.items()},'protectedFullFingerprintsEqual':True,'protectedFileCount':len(f),'protectedFilesSha256':m.sha(f),'targetAllTableRowsSettingsDatabaseEqual':True,'targetOtherCapturedCatalogsEqual':True,'targetFullCatalogAccepted':False,'targetCatalogDifference':diff,'beforePgClass':before['catalog.pg_class'],'afterPgClass':after['catalog.pg_class'],'cause':'Undetermined. Only the before digest was retained; current statistics cannot identify changed fields.','sourceAndExtractedFilesExact':len(pins['files']),'fingerprintControls':{'harmless':'survived','changedProtectedRows':'refused','changedFixtureRows':'refused','restored':True},'blind':'The source/fixture fingerprint controls alter copied readbacks, not real source data. No crash recovery or blanket process-preservation acceptance.'})
n.resource(m.BASE/'resources-final.json')
