"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Bot, ChevronDown, ChevronRight, Loader2, Send, Sparkles, User, X } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  formatAssistantOperationActionClass,
  groupAssistantOperations,
  resolveAssistantOperationTone,
  resolveAssistantOperationUrgency,
  resolveAssistantTarget,
  summarizeAssistantOperations,
  type AssistantPreview,
  type AssistantQuickLink,
  type AssistantResponse,
  type AssistantAction,
  type AssistantOperationGroupKey,
} from "@/lib/assistant/catalog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";

type AppCopilotProps = {
  workspaceId: string | null;
  workspaceName: string;
};

type ConversationEntry =
  | { id: string; role: "assistant"; type: "intro"; preview: AssistantPreview }
  | { id: string; role: "assistant"; type: "response"; response: AssistantResponse }
  | { id: string; role: "user"; type: "prompt"; text: string };

const OPERATION_FILTER_STORAGE_KEY = "openplan:planner-agent:operation-filter";
const OPERATION_GROUP_STATE_STORAGE_KEY = "openplan:planner-agent:operation-group-state";
const OPERATION_VIEW_MODE_STORAGE_KEY = "openplan:planner-agent:operation-view-mode";

type OperationFilter = "all" | "act_now" | "review_soon" | "support_context";
type OperationViewMode = "full" | "triage";
type OperationGroupState = Record<AssistantOperationGroupKey, boolean>;

const DEFAULT_OPERATION_GROUP_STATE: OperationGroupState = {
  act_now: true,
  review_soon: true,
  support_context: false,
};

function isOperationFilter(value: string | null): value is OperationFilter {
  return value === "all" || value === "act_now" || value === "review_soon" || value === "support_context";
}

function parseOperationGroupState(value: string | null): OperationGroupState {
  if (!value) return DEFAULT_OPERATION_GROUP_STATE;

  try {
    const parsed = JSON.parse(value) as Partial<Record<AssistantOperationGroupKey, unknown>>;
    return {
      act_now: typeof parsed.act_now === "boolean" ? parsed.act_now : DEFAULT_OPERATION_GROUP_STATE.act_now,
      review_soon: typeof parsed.review_soon === "boolean" ? parsed.review_soon : DEFAULT_OPERATION_GROUP_STATE.review_soon,
      support_context:
        typeof parsed.support_context === "boolean" ? parsed.support_context : DEFAULT_OPERATION_GROUP_STATE.support_context,
    };
  } catch {
    return DEFAULT_OPERATION_GROUP_STATE;
  }
}

function isOperationViewMode(value: string | null): value is OperationViewMode {
  return value === "full" || value === "triage";
}

function actionLabel(action: AssistantAction) {
  return action.label;
}

function quickLinkBadge(link: AssistantQuickLink) {
  switch (link.approval) {
    case "approval_required":
      return { label: "Approval", className: "border-amber-300/25 bg-amber-400/14 text-amber-100" };
    case "review":
      return { label: "Review", className: "border-sky-300/22 bg-sky-400/12 text-sky-100" };
    case "safe":
    default:
      return { label: "Open", className: "border-emerald-300/22 bg-emerald-400/12 text-emerald-100" };
  }
}

function quickLinkPriorityBadge(link: AssistantQuickLink) {
  switch (link.priority) {
    case "primary":
      return { label: "Primary", className: "border-fuchsia-300/22 bg-fuchsia-400/12 text-fuchsia-100" };
    case "secondary":
      return { label: "Secondary", className: "border-violet-300/22 bg-violet-400/12 text-violet-100" };
    case "supporting":
    default:
      return { label: "Supporting", className: "border-slate-300/18 bg-slate-400/10 text-slate-100" };
  }
}

function operationCardClasses(link: AssistantQuickLink) {
  const tone = resolveAssistantOperationTone(link);
  const urgency = resolveAssistantOperationUrgency(link);

  if (tone === "danger") {
    return "border-rose-300/26 bg-rose-400/10 hover:border-rose-300/40 hover:bg-rose-400/14";
  }
  if (tone === "warning") {
    return urgency === "high"
      ? "border-amber-300/28 bg-amber-400/10 hover:border-amber-300/42 hover:bg-amber-400/14"
      : "border-amber-300/20 bg-amber-400/8 hover:border-amber-300/34 hover:bg-amber-400/12";
  }
  if (tone === "info") {
    return "border-sky-300/20 bg-sky-400/8 hover:border-sky-300/34 hover:bg-sky-400/12";
  }
  if (tone === "success") {
    return "border-emerald-300/20 bg-emerald-400/8 hover:border-emerald-300/34 hover:bg-emerald-400/12";
  }
  return "border-white/10 bg-white/[0.04] hover:border-emerald-300/26 hover:bg-emerald-400/10";
}

function QuickLinkGrid({ links }: { links: AssistantQuickLink[] }) {
  const [filter, setFilter] = useState<OperationFilter>(() => {
    if (typeof window === "undefined") return "all";
    const saved = window.localStorage.getItem(OPERATION_FILTER_STORAGE_KEY);
    return isOperationFilter(saved) ? saved : "all";
  });
  const [viewMode, setViewMode] = useState<OperationViewMode>(() => {
    if (typeof window === "undefined") return "full";
    const saved = window.localStorage.getItem(OPERATION_VIEW_MODE_STORAGE_KEY);
    return isOperationViewMode(saved) ? saved : "full";
  });
  const [groupState, setGroupState] = useState<OperationGroupState>(() => {
    if (typeof window === "undefined") return DEFAULT_OPERATION_GROUP_STATE;
    return parseOperationGroupState(window.localStorage.getItem(OPERATION_GROUP_STATE_STORAGE_KEY));
  });
  const groups = groupAssistantOperations(links);
  const summary = summarizeAssistantOperations(links);
  const filteredGroups = filter === "all" ? groups : groups.filter((group) => group.key === filter);
  const visibleGroups = viewMode === "triage" ? filteredGroups.filter((group) => group.key === "act_now") : filteredGroups;
  const hasActNowGroup = groups.some((group) => group.key === "act_now");

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(OPERATION_FILTER_STORAGE_KEY, filter);
  }, [filter]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(OPERATION_VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(OPERATION_GROUP_STATE_STORAGE_KEY, JSON.stringify(groupState));
  }, [groupState]);

  return (
    <div className="space-y-4">
      <div className="rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-400">Operations summary</p>
            <p className="mt-1 text-sm leading-relaxed text-slate-300/82">
              {summary.total} tracked operation{summary.total === 1 ? "" : "s"} are visible from this grounded assistant context.
            </p>
          </div>
          <StatusBadge tone={summary.actNow > 0 ? "warning" : "neutral"} className="border-white/10 bg-white/[0.05] text-slate-100">
            Act now · {summary.actNow}
          </StatusBadge>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/8 bg-black/10 px-3 py-2.5">
            <p className="text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-slate-400">Review soon</p>
            <p className="mt-1 text-lg font-semibold text-white">{summary.reviewSoon}</p>
          </div>
          <div className="rounded-2xl border border-white/8 bg-black/10 px-3 py-2.5">
            <p className="text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-slate-400">Support context</p>
            <p className="mt-1 text-lg font-semibold text-white">{summary.supportContext}</p>
          </div>
          <div className="rounded-2xl border border-white/8 bg-black/10 px-3 py-2.5">
            <p className="text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-slate-400">Approval required</p>
            <p className="mt-1 text-lg font-semibold text-white">{summary.approvalRequired}</p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setViewMode((current) => (current === "triage" ? "full" : "triage"))}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold tracking-[0.04em] transition ${
              viewMode === "triage"
                ? "border-amber-300/35 bg-amber-400/14 text-white"
                : "border-white/10 bg-white/[0.05] text-slate-200/82 hover:border-amber-300/22 hover:bg-amber-400/10"
            }`}
          >
            {viewMode === "triage" ? "Triage mode" : "Full board"}
            <span className="rounded-full bg-black/18 px-1.5 py-0.5 text-[0.64rem] text-slate-100">
              {hasActNowGroup ? summary.actNow : 0}
            </span>
          </button>

          {[
            { key: "all", label: "All operations", count: summary.total },
            { key: "act_now", label: "Act now", count: summary.actNow },
            { key: "review_soon", label: "Review soon", count: summary.reviewSoon },
            { key: "support_context", label: "Support context", count: summary.supportContext },
          ].map((option) => {
            const active = filter === option.key;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => setFilter(option.key as OperationFilter)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold tracking-[0.04em] transition ${
                  active
                    ? "border-emerald-300/35 bg-emerald-400/14 text-white"
                    : "border-white/10 bg-white/[0.05] text-slate-200/82 hover:border-emerald-300/22 hover:bg-emerald-400/10"
                }`}
              >
                {option.label}
                <span className="rounded-full bg-black/18 px-1.5 py-0.5 text-[0.64rem] text-slate-100">{option.count}</span>
              </button>
            );
          })}
        </div>

        <p className="mt-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-slate-400/82">
          {viewMode === "triage"
            ? hasActNowGroup
              ? "Triage mode narrows the board to act-now pressure only."
              : "Triage mode is on, but no act-now operations are currently available."
            : "Full board mode keeps every operation group available for deeper review."}
        </p>
      </div>
      {!visibleGroups.length ? (
        <div className="rounded-[22px] border border-white/8 bg-black/10 px-4 py-3 text-sm text-slate-300/82">
          No operations match the current board mode and filter.
        </div>
      ) : null}
      {visibleGroups.map((group) => {
        const expanded = groupState[group.key] ?? DEFAULT_OPERATION_GROUP_STATE[group.key];
        return (
          <section key={group.key} className="space-y-2">
            <button
              type="button"
              onClick={() => setGroupState((current) => ({ ...current, [group.key]: !expanded }))}
              className="flex w-full items-start justify-between gap-3 rounded-[18px] border border-white/8 bg-black/10 px-3.5 py-3 text-left transition hover:border-emerald-300/22 hover:bg-emerald-400/8"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {expanded ? <ChevronDown className="h-4 w-4 text-slate-300/82" /> : <ChevronRight className="h-4 w-4 text-slate-300/82" />}
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-400">{group.label}</p>
                  <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-slate-100">
                    {group.items.length}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-300/74">{group.description}</p>
                {!expanded ? (
                  <p className="mt-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-slate-400/88">
                    {group.items.length} operation{group.items.length === 1 ? "" : "s"} hidden
                  </p>
                ) : null}
              </div>
              <StatusBadge tone={expanded ? "info" : "neutral"} className="border-white/10 bg-white/[0.05] text-slate-100">
                {expanded ? "Expanded" : "Collapsed"}
              </StatusBadge>
            </button>

            {expanded ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {group.items.map((link) => {
                  const badge = quickLinkBadge(link);
                  const priorityBadge = quickLinkPriorityBadge(link);
                  const urgency = resolveAssistantOperationUrgency(link);
                  return (
                    <Link
                      key={`${group.key}-${link.label}-${link.href}`}
                      href={link.href}
                      className={`rounded-[20px] border px-3.5 py-3 text-left transition ${operationCardClasses(link)}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-50">{link.label}</p>
                          <p className="mt-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-slate-400/88">
                            {formatAssistantOperationActionClass(link)} · {link.executionMode === "navigate" ? "Navigate" : "Agent action"} · {urgency}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.64rem] font-semibold uppercase tracking-[0.14em] ${priorityBadge.className}`}
                            >
                              {priorityBadge.label}
                            </span>
                            {link.statusLabel ? (
                              <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-slate-100">
                                {link.statusLabel}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-2 text-xs leading-relaxed text-slate-200/88">
                            {link.reason ?? "Open this surface to continue the grounded operator workflow."}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-slate-300/78">
                            {link.auditNote ?? "Operator review is still expected in the destination surface."}
                          </p>
                        </div>
                        <span
                          className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[0.64rem] font-semibold uppercase tracking-[0.14em] ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-emerald-200/82">
                        <div className="flex items-center gap-1">
                          <ArrowUpRight className="h-3.5 w-3.5" />
                          {link.id}
                        </div>
                        {link.auditEvent ? <span className="text-slate-400/82">{link.auditEvent}</span> : null}
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

export function AppCopilot({ workspaceId, workspaceName }: AppCopilotProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<AssistantPreview | null>(null);
  const [messages, setMessages] = useState<ConversationEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [loadingContext, setLoadingContext] = useState(true);
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = useMemo(() => resolveAssistantTarget(pathname, searchParams), [pathname, searchParams]);
  const targetKey = JSON.stringify({ ...target, workspaceId: target.workspaceId ?? workspaceId ?? null });

  useEffect(() => {
    let ignore = false;

    async function loadContext() {
      setLoadingContext(true);
      setError(null);

      const params = new URLSearchParams();
      params.set("kind", target.kind);
      if (target.id) params.set("id", target.id);
      if (target.runId) params.set("runId", target.runId);
      if (target.baselineRunId) params.set("baselineRunId", target.baselineRunId);
      if (target.workspaceId ?? workspaceId) params.set("workspaceId", target.workspaceId ?? workspaceId ?? "");

      try {
        const response = await fetch(`/api/assistant/context?${params.toString()}`);
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? "Failed to load Planner Agent context");
        }

        const payload = (await response.json()) as { preview: AssistantPreview };
        if (ignore) return;

        setPreview(payload.preview);
        setMessages([
          {
            id: `intro-${Date.now()}`,
            role: "assistant",
            type: "intro",
            preview: payload.preview,
          },
        ]);
        setDraft("");
      } catch (loadError) {
        if (ignore) return;
        setPreview(null);
        setMessages([]);
        setError(loadError instanceof Error ? loadError.message : "Failed to load Planner Agent context");
      } finally {
        if (!ignore) {
          setLoadingContext(false);
        }
      }
    }

    void loadContext();

    return () => {
      ignore = true;
    };
  }, [targetKey, target.kind, target.id, target.runId, target.baselineRunId, target.workspaceId, workspaceId]);

  async function submitPrompt(options?: { workflowId?: string; question?: string; promptLabel?: string }) {
    const question = (options?.question ?? draft).trim();
    if (!question && !options?.workflowId) {
      return;
    }

    const promptLabel = options?.promptLabel ?? question;
    setResponding(true);
    setError(null);
    setMessages((current) => [
      ...current,
      {
        id: `user-${Date.now()}`,
        role: "user",
        type: "prompt",
        text: promptLabel,
      },
    ]);

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: target.kind,
          id: target.id,
          runId: target.runId,
          baselineRunId: target.baselineRunId,
          workspaceId: target.workspaceId ?? workspaceId,
          workflowId: options?.workflowId ?? null,
          question: question || null,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Failed to build Planner Agent response");
      }

      const payload = (await response.json()) as { response: AssistantResponse };
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          type: "response",
          response: payload.response,
        },
      ]);
      setDraft("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to build Planner Agent response");
    } finally {
      setResponding(false);
    }
  }

  const summaryLabel = preview?.title ?? workspaceName;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="fixed bottom-5 right-5 z-[95] h-11 rounded-full border-emerald-300/30 bg-[rgba(7,14,20,0.92)] px-4 text-slate-100 shadow-[0_18px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl hover:border-emerald-300/50 hover:bg-emerald-400/12 hover:text-white sm:bottom-6 sm:right-6"
        onClick={() => setOpen(true)}
      >
        <Sparkles className="h-4 w-4 text-emerald-300" />
        <span>Planner Agent</span>
      </Button>

      {open ? (
        <div className="fixed inset-0 z-[110] flex justify-end bg-slate-950/55 backdrop-blur-[2px]" role="dialog" aria-modal="true">
          <button type="button" className="flex-1 cursor-default" aria-label="Close Planner Agent overlay" onClick={() => setOpen(false)} />
          <aside className="relative flex h-full w-full max-w-[560px] flex-col border-l border-white/10 bg-[linear-gradient(180deg,rgba(6,12,18,0.98),rgba(9,16,24,0.985))] text-slate-100 shadow-[-24px_0_60px_rgba(2,8,15,0.34)]">
            <div className="border-b border-white/8 px-5 py-4 sm:px-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-400/12 text-emerald-200">
                      <Sparkles className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-[0.66rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Planner Agent</p>
                      <h2 className="truncate text-lg font-semibold text-white">{summaryLabel}</h2>
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-slate-300/82">
                    {preview?.summary ?? `Grounding to ${workspaceName}...`}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 rounded-2xl text-slate-300 hover:bg-white/7 hover:text-white"
                  onClick={() => setOpen(false)}
                  aria-label="Close Planner Agent"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <StatusBadge tone="info">{preview?.kind.replace(/_/g, " ") ?? "workspace"}</StatusBadge>
                {preview?.stats.map((stat) => (
                  <StatusBadge key={`${stat.label}-${stat.value}`} tone="neutral" className="border-white/10 bg-white/[0.05] text-slate-200/85">
                    {stat.label} · {stat.value}
                  </StatusBadge>
                ))}
              </div>

              {preview?.operatorCue ? (
                <div className="mt-4 rounded-[22px] border border-emerald-300/18 bg-emerald-400/10 px-4 py-3 shadow-[0_16px_30px_rgba(16,185,129,0.08)]">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-emerald-100/72">{preview.operatorCue.label}</p>
                  <p className="mt-2 text-sm font-semibold text-white">{preview.operatorCue.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-200/82">{preview.operatorCue.detail}</p>
                </div>
              ) : null}
            </div>

            <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto]">
              <div className="border-b border-white/8 px-5 py-3 sm:px-6">
                <div className="flex flex-wrap gap-2">
                  {(preview?.suggestedActions ?? []).map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold tracking-[0.04em] text-slate-100 transition hover:border-emerald-300/35 hover:bg-emerald-400/12 hover:text-white disabled:opacity-60"
                      onClick={() => submitPrompt({ workflowId: action.id, question: action.prompt, promptLabel: actionLabel(action) })}
                      disabled={responding || loadingContext}
                      title={action.description}
                    >
                      <Sparkles className="h-3.5 w-3.5 text-emerald-300" />
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>

              <ScrollArea className="min-h-0 px-5 py-4 sm:px-6">
                <div className="space-y-4 pb-2">
                  {loadingContext ? (
                    <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300/82">
                      <Loader2 className="h-4 w-4 animate-spin text-emerald-300" />
                      Loading Planner Agent context…
                    </div>
                  ) : null}

                  {error ? (
                    <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100/92">
                      {error}
                    </div>
                  ) : null}

                  {!loadingContext && messages.length === 0 ? (
                    <div className="rounded-3xl border border-white/10 bg-white/[0.04] px-4 py-4 text-sm text-slate-300/82">
                      No grounded context loaded yet.
                    </div>
                  ) : null}

                  {messages.map((message) => {
                    if (message.type === "prompt") {
                      return (
                        <div key={message.id} className="flex justify-end">
                          <div className="max-w-[88%] rounded-[22px] border border-emerald-300/20 bg-emerald-400/12 px-4 py-3 text-sm text-slate-50 shadow-[0_16px_34px_rgba(16,185,129,0.10)]">
                            <div className="mb-2 flex items-center justify-end gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-emerald-100/78">
                              You
                              <User className="h-3.5 w-3.5" />
                            </div>
                            <p>{message.text}</p>
                          </div>
                        </div>
                      );
                    }

                    if (message.type === "intro") {
                      return (
                        <div key={message.id} className="rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-4 shadow-[0_18px_34px_rgba(2,8,15,0.18)]">
                          <div className="mb-3 flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-300/72">
                            <Bot className="h-3.5 w-3.5 text-emerald-300" />
                            Planning context
                          </div>
                          <p className="text-sm leading-relaxed text-slate-100">{message.preview.summary}</p>
                          <ul className="mt-3 space-y-2 text-sm text-slate-300/82">
                            {message.preview.facts.map((fact) => (
                              <li key={fact} className="rounded-2xl border border-white/8 bg-black/10 px-3.5 py-2.5">
                                {fact}
                              </li>
                            ))}
                          </ul>

                          {message.preview.quickLinks?.length ? (
                            <div className="mt-4">
                              <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-400">Action surfaces</p>
                              <QuickLinkGrid links={message.preview.quickLinks} />
                            </div>
                          ) : null}
                        </div>
                      );
                    }

                    return (
                      <div key={message.id} className="rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-4 shadow-[0_18px_34px_rgba(2,8,15,0.18)]">
                        <div className="mb-3 flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-300/72">
                          <Bot className="h-3.5 w-3.5 text-emerald-300" />
                          {message.response.label}
                        </div>
                        <h3 className="text-lg font-semibold tracking-tight text-white">{message.response.title}</h3>
                        <p className="mt-2 text-sm leading-relaxed text-slate-300/88">{message.response.summary}</p>

                        <div className="mt-4 grid gap-4">
                          <section>
                            <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-400">Findings</p>
                            <ul className="space-y-2 text-sm text-slate-200/88">
                              {message.response.findings.map((finding) => (
                                <li key={finding} className="rounded-2xl border border-white/8 bg-black/10 px-3.5 py-2.5">
                                  {finding}
                                </li>
                              ))}
                            </ul>
                          </section>

                          <section>
                            <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-400">Next steps</p>
                            <ul className="space-y-2 text-sm text-slate-200/88">
                              {message.response.nextSteps.map((step) => (
                                <li key={step} className="rounded-2xl border border-emerald-300/16 bg-emerald-400/8 px-3.5 py-2.5">
                                  {step}
                                </li>
                              ))}
                            </ul>
                          </section>

                          <section>
                            <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-400">Evidence</p>
                            <div className="flex flex-wrap gap-2">
                              {message.response.evidence.map((item) => (
                                <StatusBadge key={item} tone="neutral" className="border-white/10 bg-white/[0.05] text-slate-200/85">
                                  {item}
                                </StatusBadge>
                              ))}
                            </div>
                          </section>

                          {message.response.quickLinks?.length ? (
                            <section>
                              <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-400">Take action</p>
                              <QuickLinkGrid links={message.response.quickLinks} />
                            </section>
                          ) : null}

                          {message.response.caution ? (
                            <div className="rounded-2xl border border-amber-300/16 bg-amber-400/10 px-3.5 py-3 text-sm text-amber-100/92">
                              {message.response.caution}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}

                  {responding ? (
                    <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300/82">
                      <Loader2 className="h-4 w-4 animate-spin text-emerald-300" />
                      Building grounded response…
                    </div>
                  ) : null}
                </div>
              </ScrollArea>

              <div className="border-t border-white/8 px-5 py-4 sm:px-6">
                <label className="mb-2 block text-[0.66rem] font-semibold uppercase tracking-[0.22em] text-slate-400">
                  Ask Planner Agent
                </label>
                <Textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Ask about project status, planning assumptions, report needs, or next steps…"
                  className="min-h-[108px] border-white/10 bg-white/[0.04] text-slate-50 placeholder:text-slate-400/75"
                />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-400">Grounded to {preview?.title ?? workspaceName}. Planner Agent only opens tracked surfaces for now, record changes still happen inside the destination screen.</p>
                  <Button
                    type="button"
                    onClick={() => submitPrompt()}
                    disabled={responding || loadingContext || (!draft.trim() && !preview)}
                    className="shrink-0"
                  >
                    {responding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Send
                  </Button>
                </div>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
