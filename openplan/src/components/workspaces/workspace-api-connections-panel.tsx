"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  providerApiConnectionMetadata, providerApiConnectionPage, providerApiRevisionPage, providerApiSavedRevision,
  type ApiListedConnection, type ApiRevisionMetadata,
} from "@/lib/integrations/provider-api-metadata";

type Draft = { label: string; endpoint: string; models: string; authMode: "api_key" | "none"; apiKey: string; timeout: string };
type Pending = { method: "PUT" | "DELETE"; body: string; connectionId: string; revisionId: string };
const emptyDraft = (): Draft => ({ label: "", endpoint: "", models: "", authMode: "api_key", apiKey: "", timeout: "120" });
const dateLabel = (value: string) => new Date(value).toLocaleString();

// A workspace change remounts the state, clearing credentials and pending writes.
export function WorkspaceApiConnectionsPanel(props: { workspaceId: string; canManage: boolean }) {
  return <ApiConnections key={props.workspaceId} {...props} />;
}

function ApiConnections({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const { confirm, confirmDialog } = useConfirmDialog();
  const [connections, setConnections] = useState<ApiListedConnection[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<ApiListedConnection | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const readVersion = useRef(0);
  const historyVersion = useRef(0);
  const [history, setHistory] = useState<{ connection: ApiListedConnection; revisions: ApiRevisionMetadata[]; next: number | null; total: number } | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const load = useCallback(async (offset = 0) => {
    const version = ++readVersion.current;
    setLoading(true);
    try {
      const response = await fetch(`/api/workspaces/provider-api-connections?workspaceId=${encodeURIComponent(workspaceId)}&offset=${offset}`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error();
      const page = providerApiConnectionPage.parse(await response.json());
      if (page.offset !== offset || page.connections.some(row => row.workspace_id !== workspaceId || (row.current_revision &&
        (row.current_revision.workspace_id !== workspaceId || row.current_revision.connection_id !== row.id || row.current_revision.id !== row.current_revision_id)))) throw new Error();
      if (version !== readVersion.current) return;
      setConnections(rows => offset === 0 ? page.connections : [...rows.filter(row => !page.connections.some(next => next.id === row.id)), ...page.connections]);
      setNextOffset(page.nextOffset); setTotal(page.total); setReadError(null);
    } catch {
      if (version === readVersion.current) setReadError("Could not refresh API connections. Any records below are from the last successful read.");
    } finally { if (version === readVersion.current) setLoading(false); }
  }, [workspaceId]);
  const invalidateReads = useCallback(() => { readVersion.current++; historyVersion.current++; }, []);
  useEffect(() => { void load(); return invalidateReads; }, [load, invalidateReads]);

  async function loadHistory(connection: ApiListedConnection, offset = 0) {
    const version = ++historyVersion.current;
    if (history?.connection.id !== connection.id) setHistory(null);
    setHistoryBusy(true); setHistoryError(null);
    try {
      const response = await fetch(`/api/workspaces/provider-api-connections?workspaceId=${encodeURIComponent(workspaceId)}&connectionId=${connection.id}&offset=${offset}`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error();
      const page = providerApiRevisionPage.parse(await response.json());
      if (page.offset !== offset || page.revisions.some(row => row.workspace_id !== workspaceId || row.connection_id !== connection.id)) throw new Error();
      if (version !== historyVersion.current) return;
      setHistory(prior => ({ connection, revisions: offset === 0 ? page.revisions : [...(prior?.revisions ?? []).filter(row => !page.revisions.some(next => next.id === row.id)), ...page.revisions], next: page.nextOffset, total: page.total }));
    } catch { if (version === historyVersion.current) setHistoryError("Could not refresh revision history. Previously loaded revisions have been kept."); }
    finally { if (version === historyVersion.current) setHistoryBusy(false); }
  }

  async function send(change: Pending) {
    if (writing.current || !canManage) return;
    writing.current = true; setBusy(true); setPending(change); setWriteError(null); setMessage(null);
    try {
      const response = await fetch("/api/workspaces/provider-api-connections", {
        method: change.method, headers: { "content-type": "application/json" }, body: change.body, signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error();
      const body: unknown = await response.json();
      if (change.method === "PUT") {
        const saved = providerApiSavedRevision.parse(body);
        if (saved.connection.workspace_id !== workspaceId || saved.connection.id !== change.connectionId ||
          saved.revision.workspace_id !== workspaceId || saved.revision.connection_id !== change.connectionId || saved.revision.id !== change.revisionId) throw new Error();
        setMessage("Revision saved. Saving did not contact or test the model provider.");
      } else {
        const saved = providerApiConnectionMetadata.parse((body as { connection?: unknown }).connection);
        if (saved.workspace_id !== workspaceId || saved.id !== change.connectionId || saved.current_revision_id !== change.revisionId || !saved.revoked_at) throw new Error();
        setMessage("Connection revoked. Its revision history is retained.");
      }
      setPending(null); setDraft(emptyDraft()); setEditing(null);
      historyVersion.current++; setHistory(null); setHistoryBusy(false); setHistoryError(null);
      await load();
    } catch {
      setWriteError("The change could not be confirmed. It may already be saved. Retry the same change, or discard this local draft and refresh before starting another.");
    } finally { writing.current = false; setBusy(false); }
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || writing.current || !canManage) return;
    const connectionId = editing?.id ?? crypto.randomUUID(), revisionId = crypto.randomUUID();
    const configuration = { label: draft.label.trim(), protocol: "openai_chat_completions", endpoint: draft.endpoint.trim(),
      modelIds: draft.models.split(/\r?\n/).map(value => value.trim()).filter(Boolean), structuredOutput: true,
      authMode: draft.authMode, timeoutSeconds: Number(draft.timeout) };
    if (configuration.modelIds.length < 1 || configuration.modelIds.length > 32 || new Set(configuration.modelIds).size !== configuration.modelIds.length || configuration.modelIds.some(id => /\s/.test(id) || id.length > 160)) {
      setWriteError("Enter 1 to 32 distinct model IDs, one per line, without spaces."); return;
    }
    void send({ method: "PUT", connectionId, revisionId, body: JSON.stringify({ workspaceId, connectionId, revisionId,
      expectedRevisionId: editing?.current_revision_id ?? null, configuration, apiKey: draft.authMode === "none" ? null : draft.apiKey }) });
  }

  function edit(connection: ApiListedConnection) {
    if (pending || writing.current || !canManage || connection.revoked_at || !connection.current_revision) return;
    const config = connection.current_revision.configuration;
    setEditing(connection); setDraft({ label: config.label, endpoint: config.endpoint, models: config.modelIds.join("\n"), authMode: config.authMode, apiKey: "", timeout: String(config.timeoutSeconds) });
    setWriteError(null); setMessage(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    formRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }

  async function revoke(connection: ApiListedConnection) {
    if (pending || writing.current || !canManage || !connection.current_revision_id || connection.revoked_at) return;
    writing.current = true; setBusy(true);
    try {
      const accepted = await confirm({ headline: `Revoke ${connection.current_revision?.configuration.label ?? "this API connection"}?`,
        consequence: "This connection cannot be reactivated. Its configuration history remains available. Create a new connection if you need it again.", confirmLabel: "Revoke connection" });
      writing.current = false;
      if (accepted) await send({ method: "DELETE", connectionId: connection.id, revisionId: connection.current_revision_id,
        body: JSON.stringify({ workspaceId, connectionId: connection.id, expectedRevisionId: connection.current_revision_id }) });
    } finally { writing.current = false; setBusy(false); }
  }

  async function discard() {
    const accepted = !pending || await confirm({ headline: "Discard the local draft?", consequence: "This clears the key from this form. It does not undo a change the server may already have saved. The connection list will refresh.", confirmLabel: "Discard local draft" });
    if (!accepted) return;
    setPending(null); setDraft(emptyDraft()); setEditing(null); setWriteError(null); setMessage(null); await load();
  }

  return <section className="mt-6 min-w-0 rounded-xl border border-border/70 p-5" aria-labelledby="api-connections-title">
    {confirmDialog}
    <div className="module-section-heading"><h2 id="api-connections-title" className="module-section-title">AI API connections</h2></div>
    <p className="text-sm text-muted-foreground">Save named API destinations and exact model IDs for your team. Each edit retains the previous version. Use these destinations in a project’s Planner Agent under Project task · choose provider. Your OpenPlan API worker must be running to process requests.</p>
    <p className="mt-2 text-sm text-muted-foreground">Requires an OpenAI-compatible Chat Completions endpoint with structured JSON output. Saving does not test compatibility or make a model request. Workspace members can read destination details; saved keys are never shown.</p>
    {readError && <p role="alert" className="mt-3 text-sm text-destructive">{readError}</p>}
    <div className="my-4 flex flex-wrap items-center gap-3">
      <Button variant="outline" disabled={loading || busy} onClick={() => void load()}>Refresh connections</Button>
      <span role="status" className="text-sm text-muted-foreground">{loading ? "Loading connections…" : total === null ? "Connection count unavailable" : `${connections.length} of ${total} connections shown`}</span>
    </div>
    {!loading && !readError && total === 0 && <p className="text-sm">No API connections configured.</p>}
    <div className="space-y-4">
      {connections.map(connection => <article key={connection.id} className="border-t pt-4 min-w-0">
        <h3 className="font-semibold break-words">{connection.current_revision?.configuration.label ?? "Configuration unavailable"}</h3>
        <p className="text-sm">{connection.revoked_at ? `Revoked ${dateLabel(connection.revoked_at)}` : "Configured · compatibility untested"}</p>
        {connection.current_revision && <><p className="mt-1 break-all text-sm">{connection.current_revision.configuration.endpoint}</p>
          <p className="break-words text-sm">Models: {connection.current_revision.configuration.modelIds.join(", ")}</p>
          <p className="text-sm text-muted-foreground">{connection.current_revision.configuration.authMode === "none" ? "No API key" : "API key stored"} · {connection.current_revision.configuration.timeoutSeconds} second timeout</p></>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" aria-label={`History for ${connection.current_revision?.configuration.label}`} disabled={historyBusy} onClick={() => void loadHistory(connection)}>History</Button>
          {canManage && !connection.revoked_at && <><Button variant="outline" aria-label={`Edit ${connection.current_revision?.configuration.label}`} disabled={busy || !!pending || !connection.current_revision} onClick={() => edit(connection)}>Edit</Button>
            <Button variant="outline" aria-label={`Revoke ${connection.current_revision?.configuration.label}`} disabled={busy || !!pending} onClick={() => void revoke(connection)}>Revoke</Button></>}
        </div>
      </article>)}
    </div>
    {nextOffset !== null && <Button className="mt-4" variant="outline" disabled={loading} onClick={() => void load(nextOffset)}>Load more connections</Button>}
    {historyBusy && <p role="status" className="mt-4 text-sm">Loading revision history…</p>}
    {historyError && <p role="alert" className="mt-4 text-sm text-destructive">{historyError}</p>}
    {history && <section className="mt-6 border-t pt-4" aria-label="Revision history">
      <h3 className="font-semibold">History for {history.connection.current_revision?.configuration.label}</h3>
      <p className="text-sm text-muted-foreground">{history.revisions.length} of {history.total} revisions shown. Keys are excluded.</p>
      <ol className="mt-3 space-y-4">{history.revisions.map(revision => <li key={revision.id} className="text-sm">
        <p className="font-medium">{revision.configuration.label} · {dateLabel(revision.created_at)}</p>
        <p className="break-all">{revision.configuration.endpoint}</p><p className="break-words">Models: {revision.configuration.modelIds.join(", ")}</p>
        <p>{revision.configuration.authMode === "none" ? "No API key" : "API key"} · {revision.configuration.timeoutSeconds} second timeout</p>
        <details><summary className="cursor-pointer">Revision evidence</summary><p className="break-all">Revision: {revision.id}</p><p className="break-all">Previous: {revision.previous_revision_id ?? "Original"}</p><p className="break-all">Configured by: {revision.configured_by}</p><p className="break-all">Configuration SHA-256: {revision.configuration_hash}</p></details>
      </li>)}</ol>
      {history.next !== null && <Button className="mt-3" variant="outline" disabled={historyBusy} onClick={() => void loadHistory(history.connection, history.next!)}>Load older revisions</Button>}
    </section>}
    {message && <p role="status" className="mt-4 text-sm">{message}</p>}
    {writeError && <p role="alert" className="mt-4 text-sm text-destructive">{writeError}</p>}
    {canManage ? <form ref={formRef} onSubmit={save} className="mt-6 border-t pt-4">
      <h3 className="mb-3 font-semibold">{editing ? `New revision of ${editing.current_revision?.configuration.label}` : "Add an API connection"}</h3>
      <fieldset disabled={busy || !!pending} className="space-y-4">
        <div className="text-sm"><label htmlFor="api-connection-name">Connection name</label><Input id="api-connection-name" required maxLength={120} value={draft.label} onChange={event => setDraft({ ...draft, label: event.target.value })} /></div>
        <div className="text-sm"><label htmlFor="api-connection-url">API base URL</label><Input id="api-connection-url" aria-describedby="api-url-help" required type="url" autoComplete="off" placeholder="https://provider.example/v1/" value={draft.endpoint} onChange={event => setDraft({ ...draft, endpoint: event.target.value })} /><p id="api-url-help" className="text-muted-foreground">Use the base URL before /chat/completions. Local HTTP requires a destination approved by the server administrator.</p></div>
        <div className="text-sm"><label htmlFor="api-connection-models">Model IDs, one per line</label><Textarea id="api-connection-models" required value={draft.models} onChange={event => setDraft({ ...draft, models: event.target.value })} /></div>
        <div className="text-sm"><label htmlFor="api-connection-auth">Authentication</label><select id="api-connection-auth" className="mt-1 block w-full rounded-xl border bg-background p-3" value={draft.authMode} onChange={event => setDraft({ ...draft, authMode: event.target.value as Draft["authMode"], apiKey: "" })}><option value="api_key">API key</option><option value="none">No API key</option></select></div>
        {draft.authMode === "api_key" && <div className="text-sm"><label htmlFor="api-connection-key">{editing ? "API key for this revision" : "API key"}</label><Input id="api-connection-key" aria-describedby="api-key-help" required type="password" autoComplete="new-password" maxLength={8192} value={draft.apiKey} onChange={event => setDraft({ ...draft, apiKey: event.target.value })} /><p id="api-key-help" className="text-muted-foreground">Enter the key for this exact destination. Existing keys cannot be read back.</p></div>}
        <div className="text-sm"><label htmlFor="api-connection-timeout">Request timeout in seconds</label><Input id="api-connection-timeout" required type="number" min={1} max={900} step={1} value={draft.timeout} onChange={event => setDraft({ ...draft, timeout: event.target.value })} /></div>
        <Button type="submit">Save configuration</Button>
      </fieldset>
      <div className="mt-3 flex flex-wrap gap-2">
        {pending && <Button type="button" disabled={busy} onClick={() => void send(pending)}>Retry same change</Button>}
        {(pending || editing) && <Button type="button" variant="outline" disabled={busy} onClick={() => void discard()}>Discard local draft</Button>}
      </div>
    </form> : <p className="mt-6 text-sm text-muted-foreground">An owner or admin can add, revise or revoke API connections.</p>}
  </section>;
}
