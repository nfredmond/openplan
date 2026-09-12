from pathlib import Path
import json, subprocess
root=Path(__file__).resolve().parents[3]/'openplan'
p=root/'src/lib/integrations/provider-api-credentials.ts'
original=p.read_text()
e=Path('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12')
cases=[
 ('harmless-comment','// Parsing never contacts a provider.','// Configuration parsing never contacts a provider.',None),
 ('workspace-binding','envelope.workspaceId !== stored.workspaceId || ','','another workspaceId'),
 ('revision-binding','envelope.revisionId !== stored.revisionId ||','false ||','another revisionId'),
 ('envelope-config-binding','envelope.configurationHash !== stored.configurationHash','false','recomputed configuration hash'),
 ('stored-config-binding','configurationHash(stored.configuration) !== stored.configurationHash','false','changed endpoint'),
 ('keyless-ciphertext','if (stored.credentialCiphertext !== null) throw new Error();','','keyless local configuration'),
 ('explicit-keyless','z.null().parse(args.apiKey)','null','explicit null key'),
 ('label','label: z.string().trim().min(1).max(120)','label: z.string().trim().max(120)','configuration label'),
 ('protocol','protocol: z.literal("openai_chat_completions")','protocol: z.string()','configuration protocol'),
 ('endpoint','return apiEndpointUrl(value).href','return value','configuration endpoint'),
 ('models-empty','z.array(modelSchema).min(1).max(32)','z.array(modelSchema).max(32)','configuration modelIds'),
 ('models-duplicate','.refine(ids => new Set(ids).size === ids.length)','','configuration duplicateModels'),
 ('model-whitespace',r'.regex(/^[^\s\u0000-\u001f\u007f]+$/)','','configuration whitespaceModel'),
 ('structured-output','structuredOutput: z.literal(true)','structuredOutput: z.boolean()','configuration structuredOutput'),
 ('auth-mode','authMode: z.enum(["api_key", "none"])','authMode: z.string()','configuration authMode'),
 ('timeout-max','.int().min(1).max(900)','.int().min(1)','configuration timeoutSeconds'),
 ('config-unknown-fields','}).strict();\nexport type ProviderApiConfiguration','});\nexport type ProviderApiConfiguration','configuration headers'),
 ('key-byte-limit','.min(1).max(8192)','.min(1)','invalid key 8193'),
 ('key-empty',r'z.string().min(1).max(8192).regex(/^[\x21-\x7e]+$/)',r'z.string().max(8192).regex(/^[\x21-\x7e]*$/)','invalid key 0'),
 ('key-header-characters',r'.regex(/^[\x21-\x7e]+$/)','','invalid key 10'),
 ('envelope-version','version: z.literal(1)','version: z.number()','wrong-envelope-version'),
 ('encryption-failure','throw new ProviderApiCredentialError("api_connection_not_stored");','return {} as StoredProviderApiRevision;','without an operator secret'),
 ('decrypt-failure','throw new ProviderApiCredentialError("api_connection_credential_unavailable");','return process.env.OPENAI_API_KEY ?? null;','rotated-secret'),
]
records=[]
try:
 for name,before,after,target in cases:
  assert original.count(before)==1,(name,original.count(before))
  p.write_text(original.replace(before,after))
  report=e/f'credential-mutation-{name}.json'
  run=subprocess.run(['bwrap','--die-with-parent','--unshare-net','--bind','/','/','--','npm','exec','--','vitest','run','src/test/provider-api-credentials.test.ts','--reporter=default','--reporter=json','--outputFile',str(report)],cwd=root,text=True,capture_output=True,timeout=30)
  (e/f'credential-mutation-{name}.log').write_text(run.stdout+run.stderr)
  data=json.loads(report.read_text())
  failures=[a['fullName'] for suite in data['testResults'] for a in suite['assertionResults'] if a['status']=='failed']
  if target is None: assert run.returncode==0 and data['numPassedTests']==34,(name,data)
  else: assert run.returncode!=0 and any(target in f for f in failures),(name,failures)
  records.append({'mutation':name,'outcome':'survived' if target is None else 'failed','target':target,'failedTests':failures})
  print(name,records[-1]['outcome'],flush=True)
  (e/'credential-mutations-progress.json').write_text(json.dumps(records,indent=2)+'\n')
finally: p.write_text(original)
(e/'credential-mutations.json').write_text(json.dumps({'mutations':records,'blindCategories':['No workspace authorization or database immutability is implemented by the credential helpers.','A compromised operator secret or application server is outside this boundary.','No real provider or external account was contacted.']},indent=2)+'\n')
