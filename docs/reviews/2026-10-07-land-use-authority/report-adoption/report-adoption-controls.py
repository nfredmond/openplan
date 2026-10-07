from pathlib import Path
import subprocess, json, hashlib, time
root=Path('/home/nathaniel/.local/state/openplan/land-use-plan-kinds-20261007/openplan')
out=Path('/home/nathaniel/.local/state/openplan/t3-restart-recovery-20261006/land-use-authority/report-adoption-controls')
out.mkdir(exist_ok=True)
page=root/'src/components/reports/land-use-plan-report-page.tsx'
detail=root/'src/components/reports/land-use-plan-report-detail.tsx'
adoption=root/'src/components/reports/land-use-plan-report-adoption.tsx'
paths=[page,detail,adoption]
original={p:p.read_bytes() for p in paths}
public_test='src/test/land-use-plan-report-adoption.test.tsx'
cases=[
 ('omit-adoption-slot', detail, '{retainedAdoption}', '', public_test, 'renders the retained decision'),
 ('legacy-not-disclosed', adoption, 'metadata.adoptionManifest == null && metadata.adoptionManifestHash == null', 'false', public_test, 'discloses a legacy'),
 ('partial-record-as-legacy', adoption, 'metadata.adoptionManifest == null && metadata.adoptionManifestHash == null', 'metadata.adoptionManifest == null || metadata.adoptionManifestHash == null', public_test, 'withholds manifest without hash'),
 ('partial-record-as-legacy-2', adoption, 'metadata.adoptionManifest == null && metadata.adoptionManifestHash == null', 'metadata.adoptionManifest == null || metadata.adoptionManifestHash == null', public_test, 'withholds hash without manifest'),
 ('ignore-native-plan_id', adoption, 'native.plan_id === planId', 'true', public_test, 'withholds wrong native plan'),
 ('ignore-native-version_id', adoption, 'native.version_id === versionId', 'true', public_test, 'withholds wrong native version'),
 ('ignore-native-version_content_hash', adoption, 'native.version_content_hash === contentHash', 'true', public_test, 'withholds wrong native content hash'),
 ('ignore-native-adoption_manifest_hash', adoption, 'native.adoption_manifest_hash === manifestHash', 'true', public_test, 'withholds wrong native manifest hash'),
 ('ignore-native-review_release_id', adoption, 'native.review_release_id === parsed.data.reviewReleaseId', 'true', public_test, 'withholds wrong native review release'),
 ('ignore-manifest-planId', adoption, 'parsed.data.planId === planId', 'true', public_test, 'withholds wrong manifest plan'),
 ('ignore-manifest-versionId', adoption, 'parsed.data.versionId === versionId', 'true', public_test, 'withholds wrong manifest version'),
 ('ignore-manifest-versionContentHash', adoption, 'parsed.data.versionContentHash === contentHash', 'true', public_test, 'withholds wrong manifest content hash'),
 ('ignore-manifest-reviewReleaseId', adoption, 'parsed.data.reviewReleaseId === metadata.reviewReleaseId', 'true', public_test, 'withholds wrong artifact review release'),
 ('ignore-full-record-decision', adoption, 'isDeepStrictEqual(native.adoption_manifest, metadata.adoptionManifest)', 'true', public_test, 'withholds changed artifact decision'),
 ('ignore-full-record-evidence', adoption, 'isDeepStrictEqual(native.adoption_manifest, metadata.adoptionManifest)', 'true', public_test, 'withholds changed ancillary evidence'),
 ('order-sensitive-comparison', adoption, 'isDeepStrictEqual(native.adoption_manifest, metadata.adoptionManifest)', 'JSON.stringify(native.adoption_manifest) === JSON.stringify(metadata.adoptionManifest)', public_test, 'accepts reordered native keys'),
 ('ignore-read-error', adoption, '!result?.error', 'true', public_test, 'withholds unreadable native decision'),
 ('fabricate-missing-native', adoption, 'const native = result?.data;', 'const native = result?.data ?? { plan_id: planId, version_id: versionId, version_content_hash: contentHash, review_release_id: metadata.reviewReleaseId, adoption_manifest_hash: manifestHash, adoption_manifest: metadata.adoptionManifest };', public_test, 'withholds missing native decision'),
 ('accept-invalid-date', adoption, 'decidedOn: z.string().date()', 'decidedOn: z.string()', public_test, 'withholds invalid decision shape'),
 ('accept-invalid-hash', adoption, ' && /^[a-f0-9]{64}$/.test(metadata.adoptionManifestHash)', '', public_test, 'withholds invalid manifest hash'),
 ('omit-vote-missing', adoption, 'decision.vote || "Not recorded"', 'decision.vote || ""', public_test, 'labels missing vote and effective date'),
 ('omit-effective-missing', adoption, 'decision.effectiveOn ?? "Not recorded"', 'decision.effectiveOn ?? ""', public_test, 'labels missing vote and effective date'),
 ('omit-native-projection', adoption, 'review_release_id, adoption_manifest, adoption_manifest_hash', 'review_release_id, adoption_manifest_hash', public_test, 'renders the retained decision'),
 ('omit-query-plan_id', adoption, '.eq("plan_id", planId)', '', public_test, 'renders the retained decision'),
 ('omit-query-version_id', adoption, '.eq("version_id", versionId)', '', public_test, 'renders the retained decision'),
 ('omit-query-adoption_manifest_hash', adoption, '.eq("adoption_manifest_hash", manifestHash)', '', public_test, 'renders the retained decision'),
 ('omit-relationships', detail, 'records(frozen?.relationships)', '[]', public_test, 'renders related plan labels'),
 ('omit-related-label', detail, 'text(relationship, "related_plan_label")', 'null', public_test, 'renders related plan labels'),
 ('omit-related-kind', detail, 'text(relationship, "relationship_kind")', 'null', public_test, 'renders related plan labels'),
 ('omit-related-notes', detail, '{text(relationship, "notes")}</p>', '</p>', public_test, 'renders related plan labels'),
 ('omit-empty-disclosure', detail, 'No related-plan references were retained with this version.', '', public_test, 'distinguishes an empty retained relationship list'),
 ('omit-incomplete-label', detail, 'Related plan label not recorded', '', public_test, 'does not infer labels or kinds'),
 ('omit-incomplete-kind', detail, '?? "not recorded"', '?? ""', public_test, 'does not infer labels or kinds'),
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
 run('baseline',[public_test])
 for p in paths:p.write_bytes(original[p]+b'\n// Harmless observation-control comment.\n')
 run('harmless',[public_test])
 for p in paths:p.write_bytes(original[p])
 for name,p,before,after,test,expected in cases:
  source=original[p].decode();assert source.count(before)==1,(name,source.count(before))
  try:
   p.write_text(source.replace(before,after));run(name,[test],expected)
  finally:p.write_bytes(original[p])
finally:
 for p in paths:p.write_bytes(original[p])
 restored=all(p.read_bytes()==original[p] for p in paths)
 (out/'report.json').write_text(json.dumps({'state':'complete' if len(results)==len(cases)+2 and all(r['verified'] for r in results) and restored else 'incomplete','cases':results,'restored':restored,'sourceHashes':{str(p.relative_to(root)):hashlib.sha256(b).hexdigest() for p,b in original.items()},'blindCategory':'Mounted pages and projected mocks only. Does not prove native authorization, browser download, layout, or practitioner acceptance.'},indent=2)+'\n')
