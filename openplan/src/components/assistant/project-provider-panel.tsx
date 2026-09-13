"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AssistantChatProposal } from "@/lib/assistant/chat-tools";
import { providerApiConnectionPage, providerApiRevisionMetadata, type ApiListedConnection } from "@/lib/integrations/provider-api-metadata";

const connectionSchema = z.object({ id: z.string().uuid(), workspace_id: z.string().uuid(), project_id: z.string().uuid(),
  provider: z.enum(["codex", "claude", "opencode"]), device_label: z.string(), expected_auth_mode: z.enum(["chatgpt", "apiKey", "claude_subscription", "opencode_api"]), expires_at: z.string(), revoked_at: z.string().nullable(), last_status: z.string() });
const proposalSchema = z.object({ status: z.literal("proposed"), kind: z.literal("create_project_record"),
  approval: z.literal("approval_required"), description: z.string(),
  payload: z.object({ kind: z.literal("create_project_record"), recordType: z.literal("submittal"), projectId: z.string().uuid(),
    title: z.string().min(1).max(160), submittalType: z.enum(["authorization_packet", "invoice_backup", "environmental_package", "hearing_record", "ps_e", "reimbursement", "progress_report", "other"]),
    status: z.literal("draft").optional(), notes: z.string().max(4000).optional() }).strict() }).strict();
const turnBaseSchema = z.object({ id: z.string().uuid(), request_id: z.string().uuid(), workspace_id: z.string().uuid(), project_id: z.string().uuid(),
  provider: z.enum(["codex", "claude", "opencode", "anthropic"]), model_id: z.string(), auth_mode: z.string(), question: z.string(), packet_hash: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(["queued", "running", "succeeded", "failed", "cancelled", "interrupted"]), failure_code: z.string().nullable(), created_at: z.string(),
  result: z.object({ answer: z.string(), citations: z.array(z.object({ id: z.string(), label: z.string(), href: z.string() })).length(1), proposal: proposalSchema.nullable() }).strict().nullable() });
const turnSchema = z.discriminatedUnion("provider", [turnBaseSchema, turnBaseSchema.extend({
  provider: z.literal("api_connection"), auth_mode: z.enum(["connection_api_key", "connection_no_key"]),
  api_connection_id: z.string().uuid(), api_revision_id: z.string().uuid(), api_configuration_hash: z.string().regex(/^[a-f0-9]{64}$/),
  api_configuration_canonical: z.string(), api_charge_ack: z.literal(true),
}).superRefine((turn, context) => {
  try {
    const config = providerApiRevisionMetadata.shape.configuration.parse(JSON.parse(turn.api_configuration_canonical));
    if (!config.modelIds.includes(turn.model_id) || turn.auth_mode !== (config.authMode === "api_key" ? "connection_api_key" : "connection_no_key")) throw new Error();
  } catch { context.addIssue({ code: "custom", message: "The retained API configuration could not be read." }); }
})]);
type Connection = z.infer<typeof connectionSchema>;
type Turn = z.infer<typeof turnSchema>;
const setupBase = z.object({ appUrl: z.string().url(), connectionId: z.string().uuid(), workspaceId: z.string().uuid(), projectId: z.string().uuid(),
  token: z.string().regex(/^op_pc_[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/) });
const setupSchema = z.discriminatedUnion("version", [
  setupBase.extend({ version: z.literal(1), expectedAuthMode: z.enum(["chatgpt", "apiKey"]) }).strict(),
  setupBase.extend({ version: z.literal(2), provider: z.enum(["codex", "claude", "opencode"]), expectedAuthMode: z.enum(["chatgpt", "apiKey", "claude_subscription", "opencode_api"]) }).strict(),
]);
type Provider = "codex" | "claude" | "opencode" | "anthropic" | "api_connection";
type RequestBody = { workspaceId: string; projectId: string; requestId: string; question: string; model: string; provider: Provider;
  connectionId: string | null; authMode: string; acceptApiCharges?: true; revisionId?: string; configurationHash?: string };
function matchesRequest(turn: Turn, body: RequestBody) {
  return turn.request_id === body.requestId && turn.project_id === body.projectId && turn.workspace_id === body.workspaceId &&
    turn.provider === body.provider && turn.model_id === body.model && turn.auth_mode === body.authMode && turn.question === body.question &&
    (body.provider !== "api_connection" || turn.provider === "api_connection" && turn.api_connection_id === body.connectionId &&
      turn.api_revision_id === body.revisionId && turn.api_configuration_hash === body.configurationHash);
}
export type ProviderProposalReview = { id: string; question: string; answer: string; proposal: AssistantChatProposal };
const authLabels: Record<string, string> = { connection_api_key: "Saved API key", connection_no_key: "No API key sent", chatgpt: "Native ChatGPT account", claude_subscription: "Native Claude subscription", opencode_api: "OpenCode OpenAI API key (provider charges)", apiKey: "Native API key (provider charges)", workspace_api_key: "Workspace API key (provider charges)", deployment_api_key: "Deployment API key (provider charges)" };
const inputClass = "mt-1 w-full min-w-0 rounded border border-white/20 bg-slate-900 px-3 py-2 text-sm text-white";
const outlineButtonClass = "h-auto min-h-10 min-w-0 max-w-full whitespace-normal [overflow-wrap:anywhere] border-white/30 bg-slate-900 text-slate-100 hover:border-sky-300 hover:bg-slate-800 hover:text-white";

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
  const [provider, setProvider] = useState<Provider>("codex");
  const [apiConnections, setApiConnections] = useState<ApiListedConnection[]>([]);
  const [apiSelection, setApiSelection] = useState<ApiListedConnection | null>(null);
  const [apiNext, setApiNext] = useState<number | null>(null);
  const [apiLoading, setApiLoading] = useState(false);
  const [apiReadError, setApiReadError] = useState<string | null>(null);
  const apiReadVersion = useRef(0);
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

  const loadApiConnections = useCallback(async (offset = 0) => {
    const version = ++apiReadVersion.current;
    setApiLoading(true); setApiReadError(null);
    try {
      const page = providerApiConnectionPage.parse(await requestJson(`/api/workspaces/provider-api-connections?workspaceId=${workspaceId}&offset=${offset}`));
      if (page.offset !== offset || page.nextOffset !== null && page.nextOffset <= offset ||
        page.connections.some(row => row.workspace_id !== workspaceId || row.current_revision &&
          (row.current_revision.workspace_id !== workspaceId || row.current_revision.connection_id !== row.id || row.current_revision.id !== row.current_revision_id))) throw new Error();
      if (version !== apiReadVersion.current || !mounted.current) return;
      setApiConnections(prior => offset === 0 ? page.connections : [...prior.filter(row => !page.connections.some(next => next.id === row.id)), ...page.connections]);
      setApiNext(page.nextOffset);
    } catch { if (version === apiReadVersion.current && mounted.current) setApiReadError("API choices could not be refreshed. Refresh them before sending a new request."); }
    finally { if (version === apiReadVersion.current && mounted.current) setApiLoading(false); }
  }, [workspaceId]);
  const invalidateApiReads = useCallback(() => { apiReadVersion.current++; }, []);
  useEffect(() => {
    if (expanded && provider === "api_connection") void loadApiConnections();
    return invalidateApiReads;
  }, [expanded, provider, loadApiConnections, invalidateApiReads]);
  const nativeProvider = provider === "codex" || provider === "claude" || provider === "opencode";
  const apiRevision = apiSelection?.current_revision;
  const apiSelectionCurrent = Boolean(apiSelection && !apiSelection.revoked_at && apiRevision && apiConnections.some(row =>
    row.id === apiSelection.id && !row.revoked_at && row.current_revision_id === apiRevision.id && row.current_revision?.configuration_hash === apiRevision.configuration_hash));
  const connectionMode = provider === "opencode" ? "opencode_api" : provider === "claude" ? "claude_subscription" : nativeMode;
  async function createConnection() {
    setSaving(true); setError(null); setNotice(null);
    let confirmed = false;
    try {
      const data = z.object({ connection: z.object({ id: z.string().uuid() }), setup: setupSchema }).parse(await requestJson("/api/assistant/providers/connections", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, projectId, label, provider, authMode: connectionMode }),
      }));
      if (!mounted.current) return;
      if (data.setup.workspaceId !== workspaceId || data.setup.projectId !== projectId || data.setup.expectedAuthMode !== connectionMode ||
        (data.setup.version === 2 ? data.setup.provider : "codex") !== provider ||
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
      if (!matchesRequest(data.turn, body)) throw new Error("The returned request did not match this project and selected revision.");
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
  const providerConnections = connections.filter(connection => connection.provider === provider);
  const active = providerConnections.filter(connection => !connection.revoked_at && Date.parse(connection.expires_at) > Date.now());
  const selected = active.find(connection => connection.id === connectionId);
  const canSend = !busy && !saving && !cancelling && !pending && question.trim().length > 0 && model.trim().length > 0 &&
    (provider === "api_connection" ? apiSelectionCurrent && !apiLoading && !apiReadError && Boolean(apiRevision?.configuration.modelIds.includes(model)) && charges :
      nativeProvider ? Boolean(selected) && (!["apiKey", "opencode_api"].includes(selected?.expected_auth_mode ?? "") || charges) : charges);
  function sendNew() {
    if (!canSend) return;
    if (provider === "api_connection" && apiSelection && apiRevision) {
      void send({ workspaceId, projectId, requestId: crypto.randomUUID(), question: question.trim(), model, provider,
        connectionId: apiSelection.id, revisionId: apiRevision.id, configurationHash: apiRevision.configuration_hash,
        authMode: apiRevision.configuration.authMode === "api_key" ? "connection_api_key" : "connection_no_key", acceptApiCharges: true });
      return;
    }
    void send({ workspaceId, projectId, requestId: crypto.randomUUID(), question: question.trim(), model: model.trim(), provider,
      connectionId: nativeProvider ? connectionId : null, authMode: nativeProvider ? selected!.expected_auth_mode : apiMode,
      ...(provider === "anthropic" || ["apiKey", "opencode_api"].includes(selected?.expected_auth_mode ?? "") ? { acceptApiCharges: true } : {}) });
  }

  return <section className="rounded-lg border border-sky-300/25 bg-sky-950/25 p-3 text-slate-100" aria-label="Project provider task">
    <Button type="button" variant="outline" className={`${outlineButtonClass} w-full`} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>Project task · choose provider</Button>
    {expanded && <div className="mt-3 space-y-4">
      <p className="text-sm">Ask about this project&apos;s stored name, summary and status, or draft a submittal. Only that project record and your question go to the selected provider. Documents and other project records are outside this task.</p>
      {error && <p role="alert" className="rounded border border-rose-300/30 p-2 text-sm text-rose-100">{error}</p>}
      {notice && <p role="status" className="text-sm text-sky-100">{notice}</p>}
      <label className="block text-sm">Provider<select className={inputClass} value={provider} disabled={saving || Boolean(pending)} onChange={event => { setProvider(event.target.value as Provider); setApiSelection(null); setModel(""); setCharges(false); setConnectionId(""); setSetup(null); }}>
        <option value="codex">Installed Codex</option><option value="claude">Installed Claude Code</option><option value="opencode">Installed OpenCode</option><option value="anthropic">Anthropic API</option><option value="api_connection">Saved workspace API</option>
      </select></label>
      {provider === "api_connection" ? <div className="space-y-3">
        <p className="text-xs">Choose a saved OpenAI-compatible Chat Completions destination. Requests wait for your OpenPlan API worker; provider availability and account access are checked only when it runs.</p>
        <a className="text-xs underline" href="/workspace">Manage saved APIs in Workspace settings</a>
        {apiReadError && <p role="alert" className="text-sm text-rose-100">{apiReadError}</p>}
        <label className="block text-sm">Saved API connection<select className={inputClass} value={apiSelectionCurrent ? apiSelection?.id : ""} disabled={saving || Boolean(pending) || apiLoading} onChange={event => {
          setApiSelection(apiConnections.find(row => row.id === event.target.value) ?? null); setModel(""); setCharges(false);
        }}><option value="">Choose a saved API</option>{apiConnections.filter(row => !row.revoked_at && row.current_revision).map(row =>
          <option key={row.id} value={row.id}>{row.current_revision!.configuration.label}</option>)}</select></label>
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className={outlineButtonClass} disabled={apiLoading} onClick={() => void loadApiConnections()}>Refresh API choices</Button>
          {apiNext !== null && <Button type="button" variant="outline" className={outlineButtonClass} disabled={apiLoading} onClick={() => void loadApiConnections(apiNext)}>Load more API choices</Button>}</div>
        {apiSelection && !apiSelectionCurrent && !apiLoading && <p role="alert" className="text-sm">This API selection changed or is unavailable. Choose its current revision before sending a new request.</p>}
        {apiRevision && <div className="space-y-1 text-xs [overflow-wrap:anywhere]">
          <p>Destination: {apiRevision.configuration.endpoint}</p><p>{apiRevision.configuration.authMode === "api_key" ? "The saved revision's API key will be sent." : "No API key will be sent. The endpoint may still apply its own usage charges."}</p>
          <p>Only this project&apos;s stored record and your question are shared. No other provider or account will be substituted.</p>
        </div>}
      </div> : nativeProvider ? <>
        <label className="block text-sm">Project connection<select className={inputClass} value={connectionId} disabled={saving || Boolean(pending)} onChange={event => { setConnectionId(event.target.value); setCharges(false); }}>
          <option value="">Choose a connection</option>{active.map(connection => <option key={connection.id} value={connection.id}>{connection.device_label} · {connection.last_status.replaceAll("_", " ")}</option>)}
        </select></label>
        {selected && <p className="text-xs">{authLabels[selected.expected_auth_mode]} · Expires {new Date(selected.expires_at).toLocaleDateString()}. Native account limits still apply.</p>}
        <details className="rounded border border-white/15 p-2"><summary className="cursor-pointer text-sm font-semibold">Connect or revoke a computer</summary><div className="mt-3 space-y-3">
          <p className="text-xs">Use {provider === "opencode" ? "OpenCode 1.18.30" : provider === "claude" ? "Claude Code 2.1.263" : "Codex 0.154.0"} on Linux. Sign in through that application itself. The connector uses your existing native account and does not switch billing modes.</p>
          <label className="block text-sm">Computer label<input className={inputClass} maxLength={120} value={label} onChange={event => setLabel(event.target.value)} /></label>
          {provider === "opencode" ? <p className="text-xs">Expected account: OpenAI API key configured in OpenCode. Provider charges apply. OpenCode subscription sign-in and other providers are not supported by this connector yet.</p> : provider === "claude" ? <p className="text-xs">Expected account: Claude subscription. Subscription limits apply. Disable paid extra usage in Claude to prevent additional charges. OpenPlan cannot inspect that setting.</p> : <label className="block text-sm">Expected native account<select className={inputClass} value={nativeMode} onChange={event => setNativeMode(event.target.value as "chatgpt" | "apiKey")}><option value="chatgpt">ChatGPT account</option><option value="apiKey">Native API key (provider charges)</option></select></label>}
          <Button type="button" onClick={() => void createConnection()} disabled={saving || !label.trim()}>Create project connection</Button>
          {setup !== null && <Button type="button" variant="outline" className={outlineButtonClass} onClick={() => {
            const url = URL.createObjectURL(new Blob([JSON.stringify(setup, null, 2)], { type: "application/json" }));
            const anchor = document.createElement("a"); anchor.href = url; anchor.download = "openplan-connection.json"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}>Download connection file</Button>}
          <p className="text-xs">Keep the connection file private. From your OpenPlan checkout, use the connector README to configure this file, check native sign-in and start receiving requests.</p>
          <a className="text-xs underline" href="https://github.com/nfredmond/openplan/blob/main/workers/planner_agent_connector/README.md" target="_blank" rel="noreferrer">Local connector instructions</a>
          {providerConnections.map(connection => <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-2" key={connection.id}>
            <span className="min-w-0 max-w-full [overflow-wrap:anywhere] text-xs">{connection.device_label} · {connection.last_status.replaceAll("_", " ")}</span>
            {!connection.revoked_at && <Button type="button" variant="outline" className={outlineButtonClass} size="sm" disabled={saving} onClick={() => void mutate("/api/assistant/providers/connections", { connectionId: connection.id })}>Revoke {connection.device_label}</Button>}
          </div>)}
        </div></details>
      </> : <label className="block text-sm">API key source<select className={inputClass} value={apiMode} disabled={saving || Boolean(pending)} onChange={event => { setApiMode(event.target.value); setCharges(false); }}><option value="workspace_api_key">Team API key</option><option value="deployment_api_key">Deployment API key</option></select></label>}
      {provider === "api_connection" ? <label className="block text-sm">Model ID<select className={inputClass} value={model} disabled={saving || Boolean(pending) || !apiSelectionCurrent} onChange={event => { setModel(event.target.value); setCharges(false); }}>
        <option value="">Choose a configured model</option>{apiRevision?.configuration.modelIds.map(id => <option key={id} value={id}>{id}</option>)}
      </select></label> : <label className="block text-sm">Model ID<input className={inputClass} maxLength={160} value={model} disabled={saving || Boolean(pending)} onChange={event => setModel(event.target.value)} placeholder="Exact model ID from your provider" /></label>}
      {provider !== "api_connection" && <p className="text-xs">Use a model your account can access. Unsupported models fail without substitution. For Codex, the connector&apos;s models command lists current choices. For Claude, it checks sign-in but does not list models; use an exact claude- model ID supported by your account. For OpenCode, the command reads its offline OpenAI catalog. Those IDs do not establish account access or current availability; use the ID without the openai/ prefix.</p>}
      {provider === "api_connection" && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={charges} disabled={saving || Boolean(pending)} onChange={event => setCharges(event.target.checked)} />I authorize sharing this project record and question with the selected API destination and accept any provider charges.</label>}
      {(provider === "anthropic" || ["apiKey", "opencode_api"].includes(selected?.expected_auth_mode ?? "")) && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={charges} disabled={saving || Boolean(pending)} onChange={event => setCharges(event.target.checked)} />I authorize this request to use the selected API key and incur provider charges.</label>}
      <label className="block text-sm">Project question<Textarea className={`${inputClass} min-h-24`} maxLength={2000} value={question} disabled={saving || Boolean(pending)} onChange={event => setQuestion(event.target.value)} onKeyDown={event => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && canSend) { event.preventDefault(); sendNew(); }
      }} /></label>
      <Button type="button" disabled={!canSend} onClick={sendNew}>{saving ? "Saving request…" : "Send project request"}</Button>
      {pending && !saving && <div className="space-y-2 text-sm"><p>The response was interrupted. This retry uses the original question, model and request identity.</p>
        <Button type="button" variant="outline" className={outlineButtonClass} disabled={busy} onClick={() => void send(pending)}>Retry same request</Button>
        <Button type="button" variant="outline" className={outlineButtonClass} onClick={() => { void requestJson(`/api/assistant/providers/turns?${query}&requestId=${pending.requestId}`).then(data => {
          const rows = z.object({ turns: z.array(turnSchema) }).parse(data).turns;
          const saved = rows.find(row => matchesRequest(row, pending));
          if (saved) { setPending(null); setQuestion(""); setNotice("The original request was recovered without another generation."); setError(null); void refresh().catch(() => setError("The request was recovered, but the recent history could not be refreshed.")); }
          else setNotice("No saved request is visible yet. Retry the same request to avoid creating a different one.");
        }).catch(failure => setError(failure.message)); }}>Check saved request</Button>
      </div>}
      <div className="space-y-3 border-t border-white/15 pt-3"><h3 className="text-sm font-semibold">Saved project requests</h3>
        <p className="text-xs">The latest 20 requests stay here after reloading. Failed or interrupted attempts never restart automatically.</p>
        {turns.length === 0 && <p className="text-sm">No saved requests for this project.</p>}
        {turns.map(turn => <article className="space-y-2 rounded border border-white/15 p-3" key={turn.id} aria-label={`Provider request: ${turn.question}`}>
          <p className="whitespace-pre-wrap break-words text-sm font-semibold">{turn.question}</p>
          <p className="break-words text-xs">{turn.provider === "codex" ? "Installed Codex" : turn.provider === "claude" ? "Installed Claude Code" : turn.provider === "opencode" ? "Installed OpenCode" : turn.provider === "api_connection" ? "Saved workspace API" : "Anthropic API"} · {turn.model_id} · {authLabels[turn.auth_mode] ?? turn.auth_mode}</p>
          {turn.provider === "api_connection" && <p className="text-xs [overflow-wrap:anywhere]">Original destination: {providerApiRevisionMetadata.shape.configuration.parse(JSON.parse(turn.api_configuration_canonical)).endpoint}</p>}
          <p role="status" className="text-xs">Status: {turn.state}</p>
          {turn.failure_code && <p className="text-sm">{readableError(turn.failure_code)}</p>}
          {["queued", "running"].includes(turn.state) && <Button type="button" variant="outline" className={outlineButtonClass} size="sm" disabled={busy || cancelling === turn.id} onClick={() => void cancelTurn(turn)}>Cancel request</Button>}
          {turn.state === "succeeded" && turn.result && <>
            <p className="whitespace-pre-wrap break-words text-sm">{turn.result.answer}</p>
            <a className="text-xs underline" href={turn.result.citations[0].href}>{turn.result.citations[0].label} · stored project source</a>
            {turn.result.proposal && <Button type="button" variant="outline" className={outlineButtonClass} disabled={busy || saving} onClick={() => { onReview({ id: turn.id, question: turn.question, answer: turn.result!.answer, proposal: turn.result!.proposal! }); setExpanded(false); }}>Review draft submittal in conversation</Button>}
          </>}
          <details className="text-xs"><summary className="cursor-pointer">Retained request identity</summary><p className="mt-1 break-all">Request {turn.request_id}<br />Packet SHA-256 {turn.packet_hash}{turn.provider === "api_connection" && <><br />API connection {turn.api_connection_id}<br />API revision {turn.api_revision_id}<br />Configuration SHA-256 {turn.api_configuration_hash}</>}</p></details>
        </article>)}
      </div>
    </div>}
  </section>;
}
