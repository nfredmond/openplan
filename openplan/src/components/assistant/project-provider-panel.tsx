"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AssistantChatProposal } from "@/lib/assistant/chat-tools";

const connectionSchema = z.object({ id: z.string().uuid(), workspace_id: z.string().uuid(), project_id: z.string().uuid(),
  device_label: z.string(), expected_auth_mode: z.enum(["chatgpt", "apiKey"]), expires_at: z.string(), revoked_at: z.string().nullable(), last_status: z.string() });
const proposalSchema = z.object({ status: z.literal("proposed"), kind: z.literal("create_project_record"),
  approval: z.literal("approval_required"), description: z.string(),
  payload: z.object({ kind: z.literal("create_project_record"), recordType: z.literal("submittal"), projectId: z.string().uuid(),
    title: z.string().min(1).max(160), submittalType: z.enum(["authorization_packet", "invoice_backup", "environmental_package", "hearing_record", "ps_e", "reimbursement", "progress_report", "other"]),
    status: z.literal("draft").optional(), notes: z.string().max(4000).optional() }).strict() }).strict();
const turnSchema = z.object({ id: z.string().uuid(), request_id: z.string().uuid(), workspace_id: z.string().uuid(), project_id: z.string().uuid(),
  provider: z.enum(["codex", "anthropic"]), model_id: z.string(), auth_mode: z.string(), question: z.string(), packet_hash: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(["queued", "running", "succeeded", "failed", "cancelled", "interrupted"]), failure_code: z.string().nullable(), created_at: z.string(),
  result: z.object({ answer: z.string(), citations: z.array(z.object({ id: z.string(), label: z.string(), href: z.string() })).length(1), proposal: proposalSchema.nullable() }).strict().nullable() });
type Connection = z.infer<typeof connectionSchema>;
type Turn = z.infer<typeof turnSchema>;
const setupSchema = z.object({ version: z.literal(1), appUrl: z.string().url(), connectionId: z.string().uuid(), workspaceId: z.string().uuid(), projectId: z.string().uuid(),
  expectedAuthMode: z.enum(["chatgpt", "apiKey"]), token: z.string().regex(/^op_pc_[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/) }).strict();
type RequestBody = { workspaceId: string; projectId: string; requestId: string; question: string; model: string; provider: "codex" | "anthropic";
  connectionId: string | null; authMode: string; acceptApiCharges?: true };
export type ProviderProposalReview = { id: string; question: string; answer: string; proposal: AssistantChatProposal };
const authLabels: Record<string, string> = { chatgpt: "Native ChatGPT account", apiKey: "Native API key (provider charges)", workspace_api_key: "Workspace API key (provider charges)", deployment_api_key: "Deployment API key (provider charges)" };
const inputClass = "mt-1 w-full min-w-0 rounded border border-white/20 bg-slate-900 px-3 py-2 text-sm text-white";

function readableError(code: unknown): string {
  switch (code) {
    case "provider_auth_mode_changed": case "native_auth_mode_changed": return "The account mode changed. Check the selected connection and sign-in before sending a new request.";
    case "native_usage_limit": return "The native account reached a usage limit. No other provider or billing mode was used.";
    case "provider_needs_api_key": return "The selected API key is unavailable. A workspace administrator can configure it on the dashboard.";
    case "provider_access_denied": case "provider_token_required": return "This connection or project is no longer accessible. Check the project and connection.";
    case "provider_rate_limited": return "The workspace AI request limit was reached. Wait before sending a new request.";
    case "provider_retry_conflict": return "The saved request or result differs from this retry. Check the retained request before making a new one.";
    case "cancelled_by_user": return "The request was cancelled. No automatic retry will start.";
    case "connection_revoked": return "The project connection was revoked. No automatic retry will start.";
    case "native_connector_interrupted": case "provider_interrupted": case "provider_attempt_expired": case "native_attempt_expired": return "The attempt was interrupted. It will not restart automatically.";
    default: return "The request could not be confirmed. Check saved requests before retrying; no different provider was selected.";
  }
}
async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init });
  const data = await response.json();
  if (!response.ok) throw new Error(readableError(data?.error));
  return data;
}

// This is a narrow alternative inside the existing Planner Agent. It shares
// only this project's stored record; the normal chat and approval flow remain
// separate, and a returned proposal does not execute during polling or recovery.
export function ProjectProviderPanel({ workspaceId, projectId, busy, onReview }: {
  workspaceId: string; projectId: string; busy: boolean; onReview: (review: ProviderProposalReview) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [provider, setProvider] = useState<"codex" | "anthropic">("codex");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [apiMode, setApiMode] = useState("workspace_api_key");
  const [model, setModel] = useState("");
  const [question, setQuestion] = useState("");
  const [charges, setCharges] = useState(false);
  const [label, setLabel] = useState("My computer");
  const [nativeMode, setNativeMode] = useState<"chatgpt" | "apiKey">("chatgpt");
  const [setup, setSetup] = useState<unknown>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState<RequestBody | null>(null);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const readVersion = useRef(0);
  const invalidateReads = useCallback(() => { readVersion.current++; }, []);
  const mounted = useRef(true);
  const activeRequest = useRef<{ requestId: string; controller: AbortController } | null>(null);
  const settledRequests = useRef(new Map<string, string>());
  const stopClientRequest = useCallback(() => activeRequest.current?.controller.abort(), []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stopClientRequest(); }; }, [stopClientRequest]);
  const query = `workspaceId=${workspaceId}&projectId=${projectId}`;

  const refresh = useCallback(async () => {
    const version = ++readVersion.current;
    const [connectionData, turnData] = await Promise.all([
      requestJson(`/api/assistant/providers/connections?${query}`), requestJson(`/api/assistant/providers/turns?${query}`),
    ]);
    const nextConnections = z.object({ connections: z.array(connectionSchema) }).parse(connectionData).connections;
    const nextTurns = z.object({ turns: z.array(turnSchema) }).parse(turnData).turns;
    if (nextConnections.some(row => row.workspace_id !== workspaceId || row.project_id !== projectId) || nextTurns.some(row =>
      row.workspace_id !== workspaceId || row.project_id !== projectId || row.result && (row.result.citations[0].id !== `project:${projectId}` ||
        row.result.citations[0].href !== `/projects/${projectId}` || row.result.proposal && row.result.proposal.payload.projectId !== projectId))) throw new Error("The saved response did not match this project.");
    if (mounted.current && version === readVersion.current) { setConnections(nextConnections); setTurns(nextTurns); }
    return nextTurns;
  }, [query, workspaceId, projectId]);

  useEffect(() => {
    if (!expanded) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { await refresh(); } catch (failure) { if (!stopped) setError(failure instanceof Error ? failure.message : "Saved requests could not be read."); }
      if (!stopped) timer = setTimeout(() => void poll(), 3000);
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); invalidateReads(); };
  }, [expanded, refresh, invalidateReads]);

  async function createConnection() {
    setSaving(true); setError(null); setNotice(null);
    let confirmed = false;
    try {
      const data = z.object({ connection: z.object({ id: z.string().uuid() }), setup: setupSchema }).parse(await requestJson("/api/assistant/providers/connections", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, projectId, label, authMode: nativeMode }),
      }));
      if (!mounted.current) return;
      if (data.setup.workspaceId !== workspaceId || data.setup.projectId !== projectId || data.setup.expectedAuthMode !== nativeMode ||
        data.setup.connectionId !== data.connection.id || !data.setup.token.startsWith(`op_pc_${data.connection.id}.`) || data.setup.appUrl !== window.location.origin) throw new Error("The connection file did not match this project and app.");
      confirmed = true; setSetup(data.setup); setConnectionId(data.connection.id);
      setNotice("Connection created. Download its file, then start the local connector. The token is shown only in that file.");
      await refresh();
    } catch (failure) { setError(confirmed ? "The connection was created, but the list could not be refreshed. Download its file before closing this panel." : failure instanceof Error ? failure.message : "Connection could not be created. Check the list before trying again."); }
    finally { setSaving(false); }
  }
  async function mutate(url: string, body: unknown) {
    setSaving(true); setError(null);
    let confirmed = false;
    try { await requestJson(url, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); confirmed = true; await refresh(); }
    catch (failure) { setError(confirmed ? "The change was saved, but the list could not be refreshed. Reopen this panel to read the latest status." : failure instanceof Error ? failure.message : "The change could not be confirmed."); }
    finally { setSaving(false); }
  }
  async function send(body: RequestBody) {
    setPending(body); setSaving(true); setError(null); setNotice(null);
    const controller = new AbortController(); activeRequest.current = { requestId: body.requestId, controller };
    let confirmed = false;
    try {
      const data = z.object({ turn: turnSchema }).parse(await requestJson("/api/assistant/providers/turns", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal }));
      if (!mounted.current) return;
      if (data.turn.request_id !== body.requestId || data.turn.project_id !== projectId || data.turn.workspace_id !== workspaceId ||
        data.turn.provider !== body.provider || data.turn.model_id !== body.model || data.turn.auth_mode !== body.authMode || data.turn.question !== body.question) throw new Error("The returned request did not match this project.");
      confirmed = true; setPending(current => current?.requestId === body.requestId ? null : current); setQuestion(""); setNotice("Request saved. Its original packet and result remain available after reloading."); await refresh();
    } catch (failure) {
      if (!mounted.current) return;
      const settled = settledRequests.current.get(body.requestId);
      if (settled) {
        setPending(current => current?.requestId === body.requestId ? null : current); setError(null);
        setNotice(settled === "cancelled" ? "Request cancelled. No automatic retry will start." : "The request had already finished. Its saved result was kept.");
      } else setError(confirmed ? "The request was saved, but its history could not be refreshed. Reopen this panel to read the retained result; do not send it again." : failure instanceof Error ? failure.message : "The request could not be confirmed.");
    } finally { if (activeRequest.current?.requestId === body.requestId) { activeRequest.current = null; setSaving(false); } }
  }
  async function cancelTurn(turn: Turn) {
    setCancelling(turn.id); setError(null);
    let confirmed = false;
    try {
      const result = z.object({ cancelled: z.boolean(), state: z.enum(["cancelled", "succeeded", "failed", "interrupted"]), turnId: z.literal(turn.id) }).parse(await requestJson("/api/assistant/providers/turns", {
        method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ turnId: turn.id }),
      }));
      if (result.cancelled !== (result.state === "cancelled")) throw new Error("Cancellation could not be confirmed.");
      confirmed = true; settledRequests.current.set(turn.request_id, result.state);
      if (activeRequest.current?.requestId === turn.request_id) { activeRequest.current.controller.abort(); setQuestion(""); }
      setPending(current => current?.requestId === turn.request_id ? null : current);
      setNotice(result.cancelled ? "Request cancelled. No automatic retry will start." : "The request had already finished. Its saved result was kept.");
      await refresh();
    } catch (failure) { setError(confirmed ? "The final request state was confirmed, but its history could not be refreshed. Reopen this panel to read it." : failure instanceof Error ? failure.message : "Cancellation could not be confirmed."); }
    finally { setCancelling(null); }
  }
  const active = connections.filter(connection => !connection.revoked_at && Date.parse(connection.expires_at) > Date.now());
  const selected = active.find(connection => connection.id === connectionId);
  const canSend = !busy && !saving && !cancelling && !pending && question.trim().length > 0 && model.trim().length > 0 &&
    (provider === "codex" ? Boolean(selected) && (selected?.expected_auth_mode !== "apiKey" || charges) : charges);
  function sendNew() {
    if (!canSend) return;
    void send({ workspaceId, projectId, requestId: crypto.randomUUID(), question: question.trim(), model: model.trim(), provider,
      connectionId: provider === "codex" ? connectionId : null, authMode: provider === "codex" ? selected!.expected_auth_mode : apiMode,
      ...(provider === "anthropic" || selected?.expected_auth_mode === "apiKey" ? { acceptApiCharges: true } : {}) });
  }

  return <section className="rounded-lg border border-sky-300/25 bg-sky-950/25 p-3 text-slate-100" aria-label="Project provider task">
    <Button type="button" variant="outline" className="w-full whitespace-normal" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>Project task · choose provider</Button>
    {expanded && <div className="mt-3 space-y-4">
      <p className="text-sm">Ask about this project&apos;s stored name, summary and status, or draft a submittal. Only that project record and your question go to the selected provider. Documents and other project records are outside this task.</p>
      {error && <p role="alert" className="rounded border border-rose-300/30 p-2 text-sm text-rose-100">{error}</p>}
      {notice && <p role="status" className="text-sm text-sky-100">{notice}</p>}
      <label className="block text-sm">Provider<select className={inputClass} value={provider} disabled={saving || Boolean(pending)} onChange={event => { setProvider(event.target.value as "codex" | "anthropic"); setModel(""); setCharges(false); }}>
        <option value="codex">Installed Codex</option><option value="anthropic">Anthropic API</option>
      </select></label>
      {provider === "codex" ? <>
        <label className="block text-sm">Project connection<select className={inputClass} value={connectionId} disabled={saving || Boolean(pending)} onChange={event => { setConnectionId(event.target.value); setCharges(false); }}>
          <option value="">Choose a connection</option>{active.map(connection => <option key={connection.id} value={connection.id}>{connection.device_label} · {connection.last_status.replaceAll("_", " ")}</option>)}
        </select></label>
        {selected && <p className="text-xs">{authLabels[selected.expected_auth_mode]} · Expires {new Date(selected.expires_at).toLocaleDateString()}. Native account limits still apply.</p>}
        <details className="rounded border border-white/15 p-2"><summary className="cursor-pointer text-sm font-semibold">Connect or revoke a computer</summary><div className="mt-3 space-y-3">
          <p className="text-xs">Use installed Codex 0.154.0 on Linux. Sign in through Codex itself. The connector uses your existing native account and does not switch billing modes.</p>
          <label className="block text-sm">Computer label<input className={inputClass} maxLength={120} value={label} onChange={event => setLabel(event.target.value)} /></label>
          <label className="block text-sm">Expected native account<select className={inputClass} value={nativeMode} onChange={event => setNativeMode(event.target.value as "chatgpt" | "apiKey")}><option value="chatgpt">ChatGPT account</option><option value="apiKey">Native API key (provider charges)</option></select></label>
          <Button type="button" onClick={() => void createConnection()} disabled={saving || !label.trim()}>Create project connection</Button>
          {setup !== null && <Button type="button" variant="outline" onClick={() => {
            const url = URL.createObjectURL(new Blob([JSON.stringify(setup, null, 2)], { type: "application/json" }));
            const anchor = document.createElement("a"); anchor.href = url; anchor.download = "openplan-connection.json"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}>Download connection file</Button>}
          <p className="text-xs">Keep the connection file private. From your OpenPlan checkout, use the connector README to configure this file, list your available native models and start receiving requests.</p>
          <a className="text-xs underline" href="https://github.com/nfredmond/openplan/blob/main/workers/planner_agent_connector/README.md" target="_blank" rel="noreferrer">Local connector instructions</a>
          {connections.map(connection => <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-2" key={connection.id}>
            <span className="break-words text-xs">{connection.device_label} · {connection.last_status.replaceAll("_", " ")}</span>
            {!connection.revoked_at && <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => void mutate("/api/assistant/providers/connections", { connectionId: connection.id })}>Revoke {connection.device_label}</Button>}
          </div>)}
        </div></details>
      </> : <label className="block text-sm">API key source<select className={inputClass} value={apiMode} disabled={saving || Boolean(pending)} onChange={event => { setApiMode(event.target.value); setCharges(false); }}><option value="workspace_api_key">Workspace API key</option><option value="deployment_api_key">Deployment API key</option></select></label>}
      <label className="block text-sm">Model ID<input className={inputClass} maxLength={160} value={model} disabled={saving || Boolean(pending)} onChange={event => setModel(event.target.value)} placeholder="Exact model ID from your provider" /></label>
      <p className="text-xs">Use a model your account can access. Unsupported models fail without substitution. For Codex, the connector&apos;s models command lists current choices.</p>
      {(provider === "anthropic" || selected?.expected_auth_mode === "apiKey") && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={charges} disabled={saving || Boolean(pending)} onChange={event => setCharges(event.target.checked)} />I authorize this request to use the selected API key and incur provider charges.</label>}
      <label className="block text-sm">Project question<Textarea className={`${inputClass} min-h-24`} maxLength={2000} value={question} disabled={saving || Boolean(pending)} onChange={event => setQuestion(event.target.value)} onKeyDown={event => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && canSend) { event.preventDefault(); sendNew(); }
      }} /></label>
      <Button type="button" disabled={!canSend} onClick={sendNew}>{saving ? "Saving request…" : "Send project request"}</Button>
      {pending && !saving && <div className="space-y-2 text-sm"><p>The response was interrupted. This retry uses the original question, model and request identity.</p>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void send(pending)}>Retry same request</Button>
        <Button type="button" variant="outline" onClick={() => { void requestJson(`/api/assistant/providers/turns?${query}&requestId=${pending.requestId}`).then(data => {
          const rows = z.object({ turns: z.array(turnSchema) }).parse(data).turns;
          const saved = rows.find(row => row.request_id === pending.requestId && row.project_id === projectId && row.workspace_id === workspaceId && row.question === pending.question && row.provider === pending.provider && row.model_id === pending.model && row.auth_mode === pending.authMode);
          if (saved) { setPending(null); setQuestion(""); setNotice("The original request was recovered without another generation."); setError(null); void refresh().catch(() => setError("The request was recovered, but the recent history could not be refreshed.")); }
          else setNotice("No saved request is visible yet. Retry the same request to avoid creating a different one.");
        }).catch(failure => setError(failure.message)); }}>Check saved request</Button>
      </div>}
      <div className="space-y-3 border-t border-white/15 pt-3"><h3 className="text-sm font-semibold">Saved project requests</h3>
        <p className="text-xs">The latest 20 requests stay here after reloading. Failed or interrupted attempts never restart automatically.</p>
        {turns.length === 0 && <p className="text-sm">No saved requests for this project.</p>}
        {turns.map(turn => <article className="space-y-2 rounded border border-white/15 p-3" key={turn.id} aria-label={`Provider request: ${turn.question}`}>
          <p className="whitespace-pre-wrap break-words text-sm font-semibold">{turn.question}</p>
          <p className="break-words text-xs">{turn.provider === "codex" ? "Installed Codex" : "Anthropic API"} · {turn.model_id} · {authLabels[turn.auth_mode] ?? turn.auth_mode}</p>
          <p role="status" className="text-xs">Status: {turn.state}</p>
          {turn.failure_code && <p className="text-sm">{readableError(turn.failure_code)}</p>}
          {["queued", "running"].includes(turn.state) && <Button type="button" variant="outline" size="sm" disabled={busy || cancelling === turn.id} onClick={() => void cancelTurn(turn)}>Cancel request</Button>}
          {turn.state === "succeeded" && turn.result && <>
            <p className="whitespace-pre-wrap break-words text-sm">{turn.result.answer}</p>
            <a className="text-xs underline" href={turn.result.citations[0].href}>{turn.result.citations[0].label} · stored project source</a>
            {turn.result.proposal && <Button type="button" variant="outline" disabled={busy || saving} onClick={() => { onReview({ id: turn.id, question: turn.question, answer: turn.result!.answer, proposal: turn.result!.proposal! }); setExpanded(false); }}>Review draft submittal in conversation</Button>}
          </>}
          <details className="text-xs"><summary className="cursor-pointer">Retained request identity</summary><p className="mt-1 break-all">Request {turn.request_id}<br />Packet SHA-256 {turn.packet_hash}</p></details>
        </article>)}
      </div>
    </div>}
  </section>;
}
