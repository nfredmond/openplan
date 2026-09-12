from pathlib import Path
import subprocess,json
root=Path('/home/nathaniel/.local/state/openplan/agent-hold-receipts-2026-09-10/openplan')
out=Path('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12')
panel=root/'src/components/workspaces/workspace-api-connections-panel.tsx'
route=root/'src/app/api/workspaces/provider-api-connections/route.ts'
test='src/test/workspace-api-connections-panel.test.tsx'
rt='src/test/provider-api-connection-routes.test.ts'
cases=[
('control',panel,'// A workspace change','// Harmless wording: a workspace change',test,None),
('key-local-storage',panel,'const configuration = { label:', 'localStorage.setItem("bad-key", draft.apiKey);\n    const configuration = { label:',test,'without storing the key locally'),
('retry-changed-body',panel,'body: change.body, signal:', 'body: JSON.stringify({ ...JSON.parse(change.body), revisionId: crypto.randomUUID() }), signal:',test,'retries the exact body'),
('uncertain-form-enabled',panel,'disabled={busy || !!pending} className="space-y-4"','disabled={busy} className="space-y-4"',test,'freezes an uncertain save'),
('duplicate-generation',panel,'if (writing.current || !canManage) return;', 'if (!canManage) return;',test,'does not dispatch twice'),
('wire-duplicate',panel,'const response = await fetch("/api/workspaces/provider-api-connections", {', 'void fetch("/api/workspaces/provider-api-connections", { method: change.method, body: change.body }); const response = await fetch("/api/workspaces/provider-api-connections", {',test,'does not dispatch twice'),
('pagination-replaces',panel,'[...rows.filter(row => !page.connections.some(next => next.id === row.id)), ...page.connections]', 'page.connections',test,'subsequent connection and history pages'),
('history-pagination-replaces',panel,'[...(prior?.revisions ?? []).filter(row => !page.revisions.some(next => next.id === row.id)), ...page.revisions]', 'page.revisions',test,'subsequent connection and history pages'),
('revoke-unconfirmed',panel,'|| !saved.revoked_at', '|| false',test,'response leaves the connection active'),
('duplicate-models',panel,'new Set(configuration.modelIds).size !== configuration.modelIds.length','false',test,'distinct model IDs'),
('save-foreign-revision',panel,'saved.revision.workspace_id !== workspaceId ||','false ||',test,'another workspace or revision identity'),
('edit-predecessor',panel,'expectedRevisionId: editing?.current_revision_id ?? null','expectedRevisionId: null',test,'new revision for edits'),
('keyless-key-leak',panel,'apiKey: draft.authMode === "none" ? null : draft.apiKey','apiKey: draft.apiKey',test,'keyless operation'),
('refresh-erases-records',panel,'if (version === readVersion.current) setReadError(', 'setConnections([]); if (version === readVersion.current) setReadError(',test,'last successful list'),
('wrong-current-revision',panel,'row.current_revision.id !== row.current_revision_id','false',test,'different current revision'),
('history-other-connection',panel,'row.connection_id !== connection.id','false',test,'history from another connection'),
('revoke-predecessor',panel,'expectedRevisionId: connection.current_revision_id','expectedRevisionId: connection.id',test,'expected revision in retries'),
('history-projection',route,'.select(API_REVISION_COLUMNS, { count: "exact" })','.select("*", { count: "exact" })',rt,'reads revision history'),
('history-workspace',route,'.eq("workspace_id", scope.workspaceId).eq("connection_id", scope.connectionId)','.eq("connection_id", scope.connectionId)',rt,'reads revision history'),
('history-connection',route,'.eq("workspace_id", scope.workspaceId).eq("connection_id", scope.connectionId)','.eq("workspace_id", scope.workspaceId)',rt,'reads revision history'),
('history-not-found',route,'if (!connection.data) return providerJson','if (false) return providerJson',rt,'missing or inaccessible connection'),
]
results=[]
for name,path,old,new,target,match in cases:
 original=path.read_text()
 assert old in original,(name,'missing target')
 try:
  path.write_text(original.replace(old,new,1))
  cmd=['node','node_modules/vitest/vitest.mjs','run',target]
  if match: cmd += ['-t',match]
  result=subprocess.run(cmd,cwd=root,capture_output=True,text=True)
  (out/f'settings-mutation-{name}.log').write_text(result.stdout+result.stderr)
  results.append({'name':name,'exit':result.returncode,'expected':'survive' if name=='control' else 'fail','test':match})
  print(name,result.returncode,flush=True)
 finally: path.write_text(original)
(out/'settings-mutations.json').write_text(json.dumps(results,indent=2)+'\n')
