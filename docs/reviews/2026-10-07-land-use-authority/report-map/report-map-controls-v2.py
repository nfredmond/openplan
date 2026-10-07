from pathlib import Path
import subprocess, json, hashlib, time
root=Path('/home/nathaniel/.local/state/openplan/land-use-plan-kinds-20261007/openplan')
out=Path('/home/nathaniel/.local/state/openplan/t3-restart-recovery-20261006/land-use-authority/report-map-controls-v2')
out.mkdir(exist_ok=True)
route=root/'src/app/api/reports/[reportId]/land-use-map/[designationId]/route.ts'
snapshot=root/'src/lib/land-use-plans/report-snapshot.ts'
reader=root/'src/lib/land-use-plans/public-map.ts'
detail=root/'src/components/reports/land-use-plan-report-detail.tsx'
mapview=root/'src/components/land-use-plans/public-designation-map.tsx'
adoption=root/'src/components/reports/land-use-plan-report-adoption.tsx'
paths=[route,snapshot,reader,detail,mapview,adoption]
original={p:p.read_bytes() for p in paths}
public_test='src/test/land-use-plan-report-map.test.tsx'
custody_test='src/test/land-use-plan-report-custody.test.tsx'
adoption_test='src/test/land-use-plan-report-adoption.test.tsx'
recovery_test='src/test/land-use-designation-map-recovery.test.tsx'
cases=[
 ('fabricate-auth', route, 'const auth = await supabase.auth.getUser();', 'const auth = await supabase.auth.getUser(); auth.data.user ??= { id: "33000000-0000-4000-8000-000000000005" };', public_test, 'refuses signed-out account'),
 ('ignore-auth-error', route, 'auth.error || !auth.data.user', '!auth.data.user', public_test, 'refuses failed authentication'),
 ('ignore-access-error', route, 'if (access.error)', 'if (false)', public_test, 'refuses report read error'),
 ('skip-role-guard', route, '  if (!access.membership || !canAccessWorkspaceAction("reports.read", access.membership.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });', '', public_test, 'refuses unrecognized role'),
 ('skip-membership-guard', route, '  if (!access.membership || !canAccessWorkspaceAction("reports.read", access.membership.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });', '', public_test, 'refuses missing membership'),
 ('omit-artifact-error', route, 'if (artifactResult.error)', 'if (false)', public_test, 'refuses artifact read error'),
 ('missing-report-is-success', route, '{ error: "Report not found" }, { status: 404 }', '{ error: "Report not found" }, { status: 200 }', public_test, 'refuses missing report'),
 ('unverified-report-is-success', route, '{ error: "Report version could not be verified" }, { status: 503 }', '{ error: "Report version could not be verified" }, { status: 200 }', public_test, 'refuses missing artifact'),
 ('invalid-id-is-success', route, '{ error: "Map not found" }, { status: 404 }', '{ error: "Map not found" }, { status: 200 }', public_test, 'refuses invalid identifiers'),
 ('invalid-bounds-is-success', route, '{ error: "Pass a valid bbox=west,south,east,north" }, { status: 400 }', '{ error: "Pass a valid bbox=west,south,east,north" }, { status: 200 }', public_test, 'refuses malformed or unsupported viewport'),
 ('blank-bbox-as-zero', route, 'value => value.trim() ? Number(value) : Number.NaN', 'Number', public_test, '10,,12,35'),
 ('cache-private-map', route, 'private, no-store', 'public, max-age=3600', public_test, 'reads the superseded'),
 ('skip-artifact-projection', route, '.select("metadata_json")', '.select("id")', public_test, 'reads the superseded'),
 ('skip-artifact-filter', route, '.eq("report_id", access.report.id)', '', public_test, 'reads the superseded'),
 ('skip-report-type', snapshot, 'report.report_type === "land_use_plan_packet"', 'true', public_test, 'refuses unrelated report type'),
 ('skip-native-workspace', snapshot, 'version.workspace_id === report.workspace_id', 'true', public_test, 'refuses wrong native workspace'),
 ('skip-workspace-query', snapshot, '.eq("workspace_id", report.workspace_id)', '', public_test, 'reads the superseded'),
 ('skip-native-workspace-projection', snapshot, 'id, workspace_id, plan_id', 'id, plan_id', public_test, 'reads the superseded'),
 ('skip-kind', snapshot, 'metadata.kind !== "land_use_plan_implementation_report"', 'true', custody_test, 'withholds kind substitution'),
 ('skip-artifact-plan', snapshot, 'metadata.landUsePlanId === report.land_use_plan_id', 'true', custody_test, 'withholds wrong artifact plan'),
 ('skip-native-plan', snapshot, 'version.plan_id === report.land_use_plan_id', 'true', custody_test, 'withholds wrong queried plan'),
 ('skip-native-version', snapshot, 'version.id', 'versionId', custody_test, 'withholds wrong queried version'),
 ('skip-native-number', snapshot, 'version.version_number', '(frozen.version as { versionNumber: number }).versionNumber', custody_test, 'withholds wrong version number'),
 ('skip-native-state', snapshot, '["adopted", "superseded", "repealed"].includes(version.state)', 'true', public_test, 'refuses unfrozen version'),
 ('skip-report-pointer', snapshot, 'version.published_report_id === report.id', 'true', public_test, 'refuses wrong report pointer'),
 ('skip-native-error', snapshot, '!result?.error', 'true', custody_test, 'withholds unreadable native version'),
 ('trust-self-rehashed-artifact', snapshot, 'version.content_hash', 'metadata.contentHash', custody_test, 'withholds self-rehashed artifact'),
 ('skip-frozen-hash', snapshot, 'readFrozenPlanIdentity(frozen, report.land_use_plan_id, version.id, version.version_number, version.content_hash)', '(frozen.plan as NonNullable<ReturnType<typeof readFrozenPlanIdentity>>)', public_test, 'refuses altered saved disclosure fields'),
 ('skip-context-verification', snapshot, 'readFrozenPlanIdentity(frozen, report.land_use_plan_id, version.id, version.version_number, version.content_hash)', '(frozen.plan as NonNullable<ReturnType<typeof readFrozenPlanIdentity>>)', custody_test, 'withholds invalid retained context'),
 ('use-service-client', reader, 'scope?.client ?? createServiceRoleClient()', 'createServiceRoleClient()', public_test, 'reads the superseded'),
 ('skip-gis-workspace-query', reader, 'if (scope) query = query.eq("workspace_id", scope.workspaceId);', '', public_test, 'reads the superseded'),
 ('skip-gis-projection', reader, 'id, workspace_id, feature_hash, ingest_status', 'id, ingest_status', public_test, 'reads the superseded'),
 ('skip-gis-hash', reader, 'versionResult.data.feature_hash !== expectedFeatureHash', 'false', public_test, 'refuses changed GIS feature hash'),
 ('skip-gis-id', reader, 'versionResult.data.id !== versionId', 'false', public_test, 'refuses wrong GIS version'),
 ('skip-gis-state', reader, 'versionResult.data.ingest_status !== "ready"', 'false', public_test, 'refuses unfinished GIS ingest'),
 ('skip-gis-workspace', reader, 'scope && versionResult.data.workspace_id !== scope.workspaceId', 'false', public_test, 'refuses wrong GIS workspace'),
 ('skip-gis-read-error', reader, 'if (versionResult.error)', 'if (false)', public_test, 'refuses GIS version read error'),
 ('skip-feature-read-error', reader, 'if (error)', 'if (false)', public_test, 'distinguishes a feature read failure'),
 ('leak-private-fields', reader, 'pickPublicAttributes(source, publicFields)', 'source', public_test, 'reads the superseded'),
 ('wrong-viewport-query', reader, 'p_west: bbox[0]', 'p_west: 0', public_test, 'reads the superseded'),
 ('wrong-layer-query', reader, 'p_version_id: versionId', 'p_version_id: designationId', public_test, 'reads the superseded'),
 ('invalid-count-fail-open', reader, '  if (!Number.isSafeInteger(matchedCount) || matchedCount < 0\n    || rows.some(row => String(row.matched_count) !== String(rawCount))) {\n    return { ok: false as const, reason: "incomplete" as const };\n  }\n', '  if (!Number.isSafeInteger(matchedCount) || matchedCount < 0\n    || rows.some(row => String(row.matched_count) !== String(rawCount))) {\n    return { ok: true as const, payload: { features: [] } };\n  }\n', public_test, 'refuses unavailable or invalid counts'),
 ('inconsistent-count-fail-open', reader, '  if (!Number.isSafeInteger(matchedCount) || matchedCount < 0\n    || rows.some(row => String(row.matched_count) !== String(rawCount))) {\n    return { ok: false as const, reason: "incomplete" as const };\n  }\n', '  if (!Number.isSafeInteger(matchedCount) || matchedCount < 0\n    || rows.some(row => String(row.matched_count) !== String(rawCount))) {\n    return { ok: true as const, payload: { features: [] } };\n  }\n', public_test, 'refuses inconsistent counts'),
 ('ignore-partial-features', reader, 'if (!tooDenseToDraw && features.length !== matchedCount) return { ok: false as const, reason: "incomplete" as const };', '', public_test, 'refuses an incomplete feature list'),
 ('reject-zero-count', reader, 'matchedCount < 0', 'matchedCount <= 0', public_test, 'accepts the native zero-count sentinel'),
 ('misclassify-dense', reader, 'const tooDenseToDraw = publicMapIsTooDense(matchedCount);', 'const tooDenseToDraw = false;', public_test, 'draws nothing and reports the count'),
 ('latest-public-map-route', detail, '`/api/reports/${report.id}/land-use-map/${id}`', '`/api/public/land-use-plans/${plan.id}/map/${id}`', public_test, 'uses the report map endpoint'),
 ('omit-map-extent', detail, 'bbox={evidence.bbox}', 'bbox={null}', public_test, 'uses the report map endpoint'),
 ('omit-map-note', detail, '{text(designation, "map_note")}</p>', '</p>', public_test, 'uses the report map endpoint'),
 ('omit-map-hash', detail, 'text(evidence, "feature_hash")', 'null', public_test, 'uses the report map endpoint'),
 ('omit-empty-map-note', detail, 'No mapped designations were retained with this version.', '', public_test, 'discloses no retained designation'),
 ('omit-missing-map-alert', detail, 'role="alert">This designation', '>This designation', public_test, 'discloses a missing retained map identifier'),
 ('stale-features-after-http-error', mapview, 'source?.setData({ type: "FeatureCollection", features: [] });', '', recovery_test, 'clears prior features on an authorization failure'),
 ('stale-features-after-fetch-error', mapview, 'source?.setData({ type: "FeatureCollection", features: [] });', '', recovery_test, 'clears prior features and offers retry after transport'),
 ('stale-features-after-json-error', mapview, 'source?.setData({ type: "FeatureCollection", features: [] });', '', recovery_test, 'clears prior features and offers retry after invalid JSON'),
 ('stale-failure-overwrites-success', mapview, 'if (current !== requestNumber) return;', 'if (false) return;', recovery_test, 'keeps a newer successful view'),
 ('draw-after-unmount', mapview, 'requestNumber += 1;', 'requestNumber += 0;', recovery_test, 'does not draw after the map unmounts'),
 ('omit-map-labels', mapview, 'label: payload.legendField ? String(feature.properties.attributes[payload.legendField] ?? "") : ""', 'label: ""', recovery_test, 'loads the report viewport'),
 ('omit-report-adoption', detail, '{retainedAdoption}', '', adoption_test, 'renders the retained decision'),
]
results=[]
def run(name,tests,expected=None):
 with (out/(name+'.log')).open('w') as log:
  r=subprocess.run(['npm','exec','--','vitest','run',*tests,'--maxWorkers=1'],cwd=root,stdout=log,stderr=subprocess.STDOUT)
 text=(out/(name+'.log')).read_text()
 passed=r.returncode==0 if expected is None else r.returncode!=0 and 'FAIL' in text and expected in text and ('AssertionError' in text or 'TestingLibraryElementError' in text or 'Error: expect(element).toHaveAttribute' in text or 'Error: expect(element).toHaveTextContent' in text or 'Error: expect(element).toHaveClass' in text)
 results.append({'name':name,'exitCode':r.returncode,'verified':passed,'expectedFailure':expected})
 (out/'report.json').write_text(json.dumps({'state':'running','cases':results},indent=2))
 if not passed:raise RuntimeError('Control did not satisfy expected result: '+name)
try:
 run('baseline',[public_test,custody_test,adoption_test,recovery_test])
 for p in paths:p.write_bytes(original[p]+b'\n// Harmless observation-control comment.\n')
 run('harmless',[public_test,custody_test,adoption_test,recovery_test])
 for p in paths:p.write_bytes(original[p])
 for name,p,before,after,test,expected in cases:
  source=original[p].decode();assert source.count(before)>=1,(name,source.count(before))
  try:
   p.write_text(source.replace(before,after));run(name,[test],expected)
  finally:p.write_bytes(original[p])
finally:
 for p in paths:p.write_bytes(original[p])
 restored=all(p.read_bytes()==original[p] for p in paths)
 (out/'report.json').write_text(json.dumps({'state':'complete' if len(results)==len(cases)+2 and all(r['verified'] for r in results) and restored else 'incomplete','cases':results,'restored':restored,'sourceHashes':{str(p.relative_to(root)):hashlib.sha256(b).hexdigest() for p,b in original.items()},'blindCategory':'Mounted pages and projected mocks only. Does not prove native authorization, browser download, layout, or practitioner acceptance.'},indent=2)+'\n')
