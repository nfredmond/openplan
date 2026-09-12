from pathlib import Path
import json,subprocess
root=Path(__file__).resolve().parents[3]/'openplan'
e=Path('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12')
route=root/'src/app/api/workspaces/provider-api-connections/route.ts'
helper=root/'src/lib/integrations/provider-api-connections.ts'
originals={route:route.read_text(),helper:helper.read_text()}
cases=[
 ('harmless-comment',helper,'// Retry recovery compares the decrypted key;','// Save recovery compares the decrypted key;',1,None),
 ('browser-origin',route,'    requireProviderBrowserOrigin(request);','',2,'cross-origin'),
 ('manager-before-private-read',route,'const access = await requireIntegrationKeyManager(body.workspaceId);','const access = { ok: true, userId: (await providerUser()).userId };',2,'refuses member PUT'),
 ('save-revision-identity',helper,'result.revision.id !== args.revisionId || ','',1,'different revision'),
 ('retry-key-binding',helper,'openProviderApiRevisionCredential({ ...draft, credentialCiphertext: credential.credential_ciphertext }) !== openProviderApiRevisionCredential(draft)','false',1,'changed retry apiKey'),
 ('scoped-private-reads',helper,'.eq("workspace_id", draft.workspaceId)','',2,'randomized encryption on retry'),
 ('revision-projection',helper,'.select(API_REVISION_COLUMNS)','.select("*")',1,'randomized encryption on retry'),
 ('credential-projection',helper,'.select("revision_id,connection_id,workspace_id,credential_ciphertext")','.select("*")',1,'randomized encryption on retry'),
 ('concurrent-save-recovery',helper,'if (attempt === 0 && ["PT409", "23505"].includes(saved.error?.code ?? "")) continue;','',1,'concurrent identical save'),
 ('revoke-identity',route,'connection.id !== body.connectionId || ','',1,'exact revocation identity'),
 ('metadata-join',route,'workspace_provider_api_revisions!workspace_provider_api_current_revision','workspace_provider_api_credentials',1,'narrow query projection'),
]
records=[]
try:
 for name,path,before,after,count,target in cases:
  original=originals[path];assert original.count(before)==count,(name,original.count(before))
  path.write_text(original.replace(before,after))
  report=e/f'route-mutation-{name}.json'
  run=subprocess.run(['npm','exec','--','vitest','run','src/test/provider-api-connection-routes.test.ts','--reporter=default','--reporter=json','--outputFile',str(report)],cwd=root,text=True,capture_output=True,timeout=30)
  path.write_text(original)
  (e/f'route-mutation-{name}.log').write_text(run.stdout+run.stderr)
  data=json.loads(report.read_text());failures=[a['fullName'] for s in data['testResults'] for a in s['assertionResults'] if a['status']=='failed']
  if target is None: assert run.returncode==0 and data['numPassedTests']==20,(name,data)
  else: assert run.returncode!=0 and any(target in f for f in failures),(name,failures)
  records.append({'mutation':name,'outcome':'survived' if target is None else 'failed','target':target,'failedTests':failures})
  print(name,records[-1]['outcome'],flush=True)
  (e/'route-mutations-progress.json').write_text(json.dumps(records,indent=2)+'\n')
finally:
 for p,s in originals.items():p.write_text(s)
(e/'route-mutations.json').write_text(json.dumps({'mutations':records,'blindCategories':['Mocked queries assert projections and scope filters but do not execute RLS or SQL constraints.','No browser navigation or real provider generation is covered.']},indent=2)+'\n')
