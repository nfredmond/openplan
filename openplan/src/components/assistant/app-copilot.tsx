"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Bot, ChevronDown, ChevronRight, Eye, EyeOff, Loader2, Pin, Send, Sparkles, User, X } from "lucide-react";
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
import type {
  AssistantLocalConsoleFilter,
  AssistantLocalConsoleState,
  AssistantLocalConsoleViewMode,
} from "@/lib/assistant/local-console-state";
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
const OPERATION_PINNED_STORAGE_KEY = "openplan:planner-agent:operation-pinned-state";
const OPERATION_SNOOZED_STORAGE_KEY = "openplan:planner-agent:operation-snoozed-state";
const OPERATION_SESSION_SNOOZED_STORAGE_KEY = "openplan:planner-agent:operation-session-snoozed";
const OPERATION_SHOW_SNOOZED_STORAGE_KEY = "openplan:planner-agent:operation-show-snoozed";
const OPERATION_NOTE_STORAGE_KEY = "openplan:planner-agent:operation-notes";
const RETURNING_SOON_WINDOW_MS = 1000 * 60 * 60 * 6;

type OperationFilter = AssistantLocalConsoleFilter;
type OperationViewMode = AssistantLocalConsoleViewMode;
type OperationGroupState = Record<AssistantOperationGroupKey, boolean>;
type OperationPreferenceState = Record<string, boolean>;
type OperationSessionSnoozeState = Record<string, boolean>;
type OperationSnoozeRecord = {
  mode: "until_reopened" | "until_tomorrow";
  until: string | null;
};
type OperationPersistentSnoozeState = Record<string, OperationSnoozeRecord>;
type OperationNotesState = Record<string, string>;
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

function parseOperationPreferenceState(value: string | null): OperationPreferenceState {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
  } catch {
    return {};
  }
}

function parseOperationSessionSnoozeState(value: string | null): OperationSessionSnoozeState {
  return parseOperationPreferenceState(value);
}

function parseOperationPersistentSnoozeState(value: string | null): OperationPersistentSnoozeState {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const now = Date.now();
    const next: OperationPersistentSnoozeState = {};

    for (const [key, raw] of Object.entries(parsed)) {
      if (!raw || typeof raw !== "object") continue;
      const candidate = raw as { mode?: unknown; until?: unknown };
      if (candidate.mode === "until_reopened") {
        next[key] = { mode: "until_reopened", until: null };
        continue;
      }
      if (candidate.mode === "until_tomorrow" && typeof candidate.until === "string") {
        const expiresAt = Date.parse(candidate.until);
        if (!Number.isNaN(expiresAt) && expiresAt > now) {
          next[key] = { mode: "until_tomorrow", until: candidate.until };
        }
      }
    }

    return next;
  } catch {
    return {};
  }
}

function parseOperationNotesState(value: string | null): OperationNotesState {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

function getOperationStorageKey(link: AssistantQuickLink): string {
  return `${link.id}::${link.href}`;
}

function buildTomorrowBoundaryIso(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow.toISOString();
}

function resolveSnoozeLabel(
  operationKey: string,
  sessionSnoozeState: OperationSessionSnoozeState,
  persistentSnoozeState: OperationPersistentSnoozeState
): string | null {
  if (sessionSnoozeState[operationKey]) return "This session";
  const record = persistentSnoozeState[operationKey];
  if (!record) return null;
  return record.mode === "until_tomorrow" ? "Until tomorrow" : "Until reopened";
}

function resolveSnoozeReturnDetail(
  operationKey: string,
  sessionSnoozeState: OperationSessionSnoozeState,
  persistentSnoozeState: OperationPersistentSnoozeState
): string | null {
  if (sessionSnoozeState[operationKey]) return "Returns when this browser session closes.";
  const record = persistentSnoozeState[operationKey];
  if (!record) return null;
  if (record.mode === "until_tomorrow") return "Returns at the next day boundary.";
  return "Returns only after you explicitly reopen it.";
}

function resolveSnoozeReturnTimestamp(
  operationKey: string,
  persistentSnoozeState: OperationPersistentSnoozeState
): number | null {
  const record = persistentSnoozeState[operationKey];
  if (!record?.until) return null;
  const parsed = Date.parse(record.until);
  return Number.isNaN(parsed) ? null : parsed;
}

function isReturningSoon(
  operationKey: string,
  persistentSnoozeState: OperationPersistentSnoozeState,
  nowMs = Date.now()
): boolean {
  const record = persistentSnoozeState[operationKey];
  if (!record || record.mode !== "until_tomorrow") return false;
  const returnAt = resolveSnoozeReturnTimestamp(operationKey, persistentSnoozeState);
  if (!returnAt) return false;
  const remainingMs = returnAt - nowMs;
  return remainingMs > 0 && remainingMs <= RETURNING_SOON_WINDOW_MS;
}

function formatRemainingSnoozeTime(returnAtMs: number | null, nowMs = Date.now()): string | null {
  if (!returnAtMs) return null;
  const remainingMs = returnAtMs - nowMs;
  if (remainingMs <= 0) return "Returning now";
  const totalMinutes = Math.max(1, Math.ceil(remainingMs / (1000 * 60)));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function buildBoardStateNarrative(args: {
  viewMode: OperationViewMode;
  filter: OperationFilter;
  shapedCount: number;
  snoozedCount: number;
  returningSoonCount: number;
  hiddenSnoozedCount: number;
  showSnoozed: boolean;
}): { title: string; detail: string } {
  const filterLabel =
    args.filter === "all"
      ? "all operation groups"
      : args.filter === "act_now"
        ? "act-now pressure"
        : args.filter === "review_soon"
          ? "review-soon work"
          : "support context";

  if (args.viewMode === "triage") {
    return {
      title: "Triage mode is shaping the board",
      detail:
        args.returningSoonCount > 0
          ? `The console is narrowed to act-now pressure, with ${args.returningSoonCount} snoozed operation${args.returningSoonCount === 1 ? "" : "s"} returning soon.`
          : `The console is narrowed to act-now pressure while ${filterLabel} stays available underneath the full board view.`,
    };
  }

  if (args.returningSoonCount > 0) {
    return {
      title: "Returning pressure is approaching",
      detail: `${args.returningSoonCount} snoozed operation${args.returningSoonCount === 1 ? " is" : "s are"} nearing its return window while ${args.shapedCount} shaped item${args.shapedCount === 1 ? " remains" : "s remain"} under active operator control.`,
    };
  }

  if (args.hiddenSnoozedCount > 0 && !args.showSnoozed) {
    return {
      title: "Some pressure is intentionally tucked away",
      detail: `${args.hiddenSnoozedCount} snoozed operation${args.hiddenSnoozedCount === 1 ? " is" : "s are"} hidden from the active board, while ${filterLabel} stays in view.`,
    };
  }

  if (args.shapedCount > 0) {
    return {
      title: "The board reflects local operator judgment",
      detail: `${args.shapedCount} operation${args.shapedCount === 1 ? " is" : "s are"} currently pinned or snoozed, and the board is focused on ${filterLabel}.`,
    };
  }

  return {
    title: "The board is running in clean review mode",
    detail: `No local pin or snooze state is active right now, and the console is showing ${filterLabel}.`,
  };
}

function buildLocalConsoleStateSnapshot(
  links: AssistantQuickLink[] | undefined,
  nowMs = Date.now()
): AssistantLocalConsoleState | null {
  if (!links?.length || typeof window === "undefined") return null;

  const filterSaved = window.localStorage.getItem(OPERATION_FILTER_STORAGE_KEY);
  const filter = isOperationFilter(filterSaved) ? filterSaved : "all";
  const viewModeSaved = window.localStorage.getItem(OPERATION_VIEW_MODE_STORAGE_KEY);
  const viewMode = isOperationViewMode(viewModeSaved) ? viewModeSaved : "full";
  const pinnedState = parseOperationPreferenceState(window.localStorage.getItem(OPERATION_PINNED_STORAGE_KEY));
  const sessionSnoozeState = parseOperationSessionSnoozeState(window.sessionStorage.getItem(OPERATION_SESSION_SNOOZED_STORAGE_KEY));
  const persistentSnoozeState = parseOperationPersistentSnoozeState(window.localStorage.getItem(OPERATION_SNOOZED_STORAGE_KEY));
  const showSnoozed = window.localStorage.getItem(OPERATION_SHOW_SNOOZED_STORAGE_KEY) === "true";

  const snoozedCount = links.filter((link) => resolveSnoozeLabel(getOperationStorageKey(link), sessionSnoozeState, persistentSnoozeState)).length;
  const returningSoonCount = links.filter((link) => isReturningSoon(getOperationStorageKey(link), persistentSnoozeState, nowMs)).length;
  const shapedCount = links.filter(
    (link) => pinnedState[getOperationStorageKey(link)] || resolveSnoozeLabel(getOperationStorageKey(link), sessionSnoozeState, persistentSnoozeState)
  ).length;
  const hiddenSnoozedCount = showSnoozed ? 0 : snoozedCount;
  const narrative = buildBoardStateNarrative({
    viewMode,
    filter,
    shapedCount,
    snoozedCount,
    returningSoonCount,
    hiddenSnoozedCount,
    showSnoozed,
  });

  return {
    title: narrative.title,
    detail: narrative.detail,
    shapedCount,
    snoozedCount,
    returningSoonCount,
    viewMode,
    filter,
  };
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
  const [pinnedState, setPinnedState] = useState<OperationPreferenceState>(() => {
    if (typeof window === "undefined") return {};
    return parseOperationPreferenceState(window.localStorage.getItem(OPERATION_PINNED_STORAGE_KEY));
  });
  const [sessionSnoozeState, setSessionSnoozeState] = useState<OperationSessionSnoozeState>(() => {
    if (typeof window === "undefined") return {};
    return parseOperationSessionSnoozeState(window.sessionStorage.getItem(OPERATION_SESSION_SNOOZED_STORAGE_KEY));
  });
  const [persistentSnoozeState, setPersistentSnoozeState] = useState<OperationPersistentSnoozeState>(() => {
    if (typeof window === "undefined") return {};
    return parseOperationPersistentSnoozeState(window.localStorage.getItem(OPERATION_SNOOZED_STORAGE_KEY));
  });
  const [operationNotes, setOperationNotes] = useState<OperationNotesState>(() => {
    if (typeof window === "undefined") return {};
    return parseOperationNotesState(window.localStorage.getItem(OPERATION_NOTE_STORAGE_KEY));
  });
  const [showSnoozed, setShowSnoozed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(OPERATION_SHOW_SNOOZED_STORAGE_KEY) === "true";
  });
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const groups = groupAssistantOperations(links).map((group) => {
    const sortedItems = [...group.items].sort((a, b) => {
      const aPinned = pinnedState[getOperationStorageKey(a)] ? 1 : 0;
      const bPinned = pinnedState[getOperationStorageKey(b)] ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      return 0;
    });
    const visibleItems = sortedItems.filter((link) => {
      if (showSnoozed) return true;
      return !resolveSnoozeLabel(getOperationStorageKey(link), sessionSnoozeState, persistentSnoozeState);
    });
    return {
      ...group,
      totalItems: sortedItems.length,
      snoozedCount: sortedItems.length - visibleItems.length,
      items: visibleItems,
    };
  });
  const summary = summarizeAssistantOperations(links);
  const pinnedCount = links.filter((link) => pinnedState[getOperationStorageKey(link)]).length;
  const snoozedCount = links.filter((link) => resolveSnoozeLabel(getOperationStorageKey(link), sessionSnoozeState, persistentSnoozeState)).length;
  const sessionSnoozedCount = links.filter((link) => sessionSnoozeState[getOperationStorageKey(link)]).length;
  const tomorrowSnoozedCount = links.filter(
    (link) => persistentSnoozeState[getOperationStorageKey(link)]?.mode === "until_tomorrow"
  ).length;
  const reopenedSnoozedCount = links.filter(
    (link) => persistentSnoozeState[getOperationStorageKey(link)]?.mode === "until_reopened"
  ).length;
  const returningSoonOperations = links.filter((link) => isReturningSoon(getOperationStorageKey(link), persistentSnoozeState, nowMs));
  const returningSoonCount = returningSoonOperations.length;
  const shapedOperations = links
    .filter(
      (link) =>
        pinnedState[getOperationStorageKey(link)] ||
        resolveSnoozeLabel(getOperationStorageKey(link), sessionSnoozeState, persistentSnoozeState)
    )
    .sort((a, b) => {
      const aPinned = pinnedState[getOperationStorageKey(a)] ? 1 : 0;
      const bPinned = pinnedState[getOperationStorageKey(b)] ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      const aReturningSoon = isReturningSoon(getOperationStorageKey(a), persistentSnoozeState, nowMs) ? 1 : 0;
      const bReturningSoon = isReturningSoon(getOperationStorageKey(b), persistentSnoozeState, nowMs) ? 1 : 0;
      if (aReturningSoon !== bReturningSoon) return bReturningSoon - aReturningSoon;
      const aSnoozed = resolveSnoozeLabel(getOperationStorageKey(a), sessionSnoozeState, persistentSnoozeState) ? 1 : 0;
      const bSnoozed = resolveSnoozeLabel(getOperationStorageKey(b), sessionSnoozeState, persistentSnoozeState) ? 1 : 0;
      if (aSnoozed !== bSnoozed) return bSnoozed - aSnoozed;
      return a.label.localeCompare(b.label);
    });
  const hiddenSnoozedCount = showSnoozed ? 0 : snoozedCount;
  const boardNarrative = buildBoardStateNarrative({
    viewMode,
    filter,
    shapedCount: shapedOperations.length,
    snoozedCount,
    returningSoonCount,
    hiddenSnoozedCount,
    showSnoozed,
  });
  const filteredGroups = (filter === "all" ? groups : groups.filter((group) => group.key === filter)).filter(
    (group) => group.items.length > 0
  );
  const visibleGroups = viewMode === "triage" ? filteredGroups.filter((group) => group.key === "act_now") : filteredGroups;
  const hasActNowGroup = groups.some((group) => group.key === "act_now");

  function clearOperationSnooze(operationKey: string) {
    setSessionSnoozeState((current) => {
      if (!current[operationKey]) return current;
      const next = { ...current };
      delete next[operationKey];
      return next;
    });
    setPersistentSnoozeState((current) => {
      if (!current[operationKey]) return current;
      const next = { ...current };
      delete next[operationKey];
      return next;
    });
  }

  function setOperationSnoozeMode(operationKey: string, mode: "session" | "until_tomorrow" | "until_reopened") {
    if (mode === "session") {
      setSessionSnoozeState((current) => ({ ...current, [operationKey]: true }));
      setPersistentSnoozeState((current) => {
        if (!current[operationKey]) return current;
        const next = { ...current };
        delete next[operationKey];
        return next;
      });
      return;
    }

    setSessionSnoozeState((current) => {
      if (!current[operationKey]) return current;
      const next = { ...current };
      delete next[operationKey];
      return next;
    });
    setPersistentSnoozeState((current) => ({
      ...current,
      [operationKey]: {
        mode,
        until: mode === "until_tomorrow" ? buildTomorrowBoundaryIso() : null,
      },
    }));
  }

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(OPERATION_PINNED_STORAGE_KEY, JSON.stringify(pinnedState));
  }, [pinnedState]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(OPERATION_SNOOZED_STORAGE_KEY, JSON.stringify(persistentSnoozeState));
  }, [persistentSnoozeState]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(OPERATION_SESSION_SNOOZED_STORAGE_KEY, JSON.stringify(sessionSnoozeState));
  }, [sessionSnoozeState]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(OPERATION_NOTE_STORAGE_KEY, JSON.stringify(operationNotes));
  }, [operationNotes]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(OPERATION_SHOW_SNOOZED_STORAGE_KEY, String(showSnoozed));
  }, [showSnoozed]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000 * 60);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

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

          <button
            type="button"
            onClick={() => setShowSnoozed((current) => !current)}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold tracking-[0.04em] transition ${
              showSnoozed
                ? "border-sky-300/35 bg-sky-400/14 text-white"
                : "border-white/10 bg-white/[0.05] text-slate-200/82 hover:border-sky-300/22 hover:bg-sky-400/10"
            }`}
          >
            {showSnoozed ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {showSnoozed ? "Snoozed visible" : "Snoozed hidden"}
            <span className="rounded-full bg-black/18 px-1.5 py-0.5 text-[0.64rem] text-slate-100">{snoozedCount}</span>
          </button>
        </div>

        <p className="mt-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-slate-400/82">
          {viewMode === "triage"
            ? hasActNowGroup
              ? "Triage mode narrows the board to act-now pressure only."
              : "Triage mode is on, but no act-now operations are currently available."
            : "Full board mode keeps every operation group available for deeper review."}
        </p>

        <div className="mt-2 flex flex-wrap gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-slate-400/82">
          <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-slate-100">
            Pinned · {pinnedCount}
          </span>
          <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-slate-100">
            Snoozed · {snoozedCount}
          </span>
          <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-slate-100">
            Session · {sessionSnoozedCount}
          </span>
          <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-slate-100">
            Tomorrow · {tomorrowSnoozedCount}
          </span>
          <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-slate-100">
            Reopen · {reopenedSnoozedCount}
          </span>
          {returningSoonCount > 0 ? (
            <span className="inline-flex items-center rounded-full border border-amber-300/24 bg-amber-400/12 px-2 py-0.5 text-amber-100">
              Returning soon · {returningSoonCount}
            </span>
          ) : null}
        </div>

        {snoozedCount > 0 ? (
          <p className="mt-2 text-xs leading-relaxed text-slate-300/74">
            Snooze timing: {sessionSnoozedCount} this session, {tomorrowSnoozedCount} until tomorrow, {reopenedSnoozedCount} until manually reopened.
          </p>
        ) : null}
        {returningSoonCount > 0 ? (
          <p className="mt-1 text-xs leading-relaxed text-amber-100/84">
            {returningSoonCount} tomorrow-snoozed operation{returningSoonCount === 1 ? " is" : "s are"} approaching the return window.
          </p>
        ) : null}

        <div className="mt-3 rounded-[18px] border border-white/8 bg-black/10 px-3.5 py-3">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-400">Board cue</p>
          <p className="mt-2 text-sm font-semibold text-white">{boardNarrative.title}</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-300/82">{boardNarrative.detail}</p>
        </div>
      </div>
      {shapedOperations.length ? (
        <div className="rounded-[22px] border border-fuchsia-300/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-400">Shaped operations</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-300/82">
                Local queue-shaping decisions stay visible here so pinned and snoozed items carry operator context, not just hidden state.
              </p>
              {snoozedCount > 0 ? (
                <p className="mt-2 text-xs leading-relaxed text-slate-300/74">
                  {sessionSnoozedCount} return this session, {tomorrowSnoozedCount} return tomorrow, and {reopenedSnoozedCount} stay hidden until reopened.
                </p>
              ) : null}
              {returningSoonCount > 0 ? (
                <p className="mt-1 text-xs leading-relaxed text-amber-100/84">
                  {returningSoonCount} snoozed operation{returningSoonCount === 1 ? " is" : "s are"} coming back soon.
                </p>
              ) : null}
            </div>
            <StatusBadge tone="info" className="border-white/10 bg-white/[0.05] text-slate-100">
              {shapedOperations.length} tracked
            </StatusBadge>
          </div>

          <div className="mt-3 space-y-3">
            {shapedOperations.map((link) => {
              const operationKey = getOperationStorageKey(link);
              const note = operationNotes[operationKey] ?? "";
              const isPinned = Boolean(pinnedState[operationKey]);
              const snoozeLabel = resolveSnoozeLabel(operationKey, sessionSnoozeState, persistentSnoozeState);
              const snoozeReturnDetail = resolveSnoozeReturnDetail(operationKey, sessionSnoozeState, persistentSnoozeState);
              const returningSoon = isReturningSoon(operationKey, persistentSnoozeState, nowMs);
              const returnAtMs = resolveSnoozeReturnTimestamp(operationKey, persistentSnoozeState);
              const returnSoonLabel = returningSoon ? formatRemainingSnoozeTime(returnAtMs, nowMs) : null;
              const isSnoozed = Boolean(snoozeLabel);

              return (
                <div key={`shaped-${operationKey}`} className="rounded-[18px] border border-white/8 bg-black/10 px-3.5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-50">{link.label}</p>
                      <p className="mt-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-slate-400/88">
                        {formatAssistantOperationActionClass(link)} · {resolveAssistantOperationUrgency(link)}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {isPinned ? (
                          <span className="inline-flex items-center rounded-full border border-fuchsia-300/22 bg-fuchsia-400/12 px-2 py-0.5 text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-fuchsia-100">
                            Pinned
                          </span>
                        ) : null}
                        {isSnoozed ? (
                          <span className="inline-flex items-center rounded-full border border-sky-300/20 bg-sky-400/10 px-2 py-0.5 text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-sky-100">
                            {snoozeLabel}
                          </span>
                        ) : null}
                        {returningSoon ? (
                          <span className="inline-flex items-center rounded-full border border-amber-300/24 bg-amber-400/12 px-2 py-0.5 text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-amber-100">
                            Returning soon{returnSoonLabel ? ` · ${returnSoonLabel}` : ""}
                          </span>
                        ) : null}
                      </div>
                      {snoozeReturnDetail ? <p className="mt-2 text-xs leading-relaxed text-slate-300/74">{snoozeReturnDetail}</p> : null}
                    </div>

                    <Link
                      href={link.href}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-emerald-100 transition hover:border-emerald-300/35 hover:bg-emerald-400/16 hover:text-white"
                    >
                      <ArrowUpRight className="h-3.5 w-3.5" />
                      Open
                    </Link>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setPinnedState((current) => ({
                          ...current,
                          [operationKey]: !isPinned,
                        }))
                      }
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[0.64rem] font-semibold uppercase tracking-[0.14em] transition ${
                        isPinned
                          ? "border-fuchsia-300/28 bg-fuchsia-400/12 text-fuchsia-100"
                          : "border-white/10 bg-white/[0.05] text-slate-200/82 hover:border-fuchsia-300/22 hover:bg-fuchsia-400/10"
                      }`}
                    >
                      <Pin className="h-3 w-3" />
                      {isPinned ? "Unpin" : "Pin"}
                    </button>
                    <button
                      type="button"
                      onClick={() => (isSnoozed ? clearOperationSnooze(operationKey) : setOperationSnoozeMode(operationKey, "session"))}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[0.64rem] font-semibold uppercase tracking-[0.14em] transition ${
                        isSnoozed
                          ? "border-sky-300/28 bg-sky-400/12 text-sky-100"
                          : "border-white/10 bg-white/[0.05] text-slate-200/82 hover:border-sky-300/22 hover:bg-sky-400/10"
                      }`}
                    >
                      {isSnoozed ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                      {isSnoozed ? "Resume" : "This session"}
                    </button>
                    {!isSnoozed ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setOperationSnoozeMode(operationKey, "until_tomorrow")}
                          className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-slate-200/82 transition hover:border-sky-300/22 hover:bg-sky-400/10"
                        >
                          Tomorrow
                        </button>
                        <button
                          type="button"
                          onClick={() => setOperationSnoozeMode(operationKey, "until_reopened")}
                          className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-slate-200/82 transition hover:border-sky-300/22 hover:bg-sky-400/10"
                        >
                          Reopened
                        </button>
                      </>
                    ) : null}
                  </div>

                  <div className="mt-3">
                    <p className="mb-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-slate-400/88">Operator note</p>
                    <Textarea
                      value={note}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setOperationNotes((current) => {
                          if (!nextValue.trim()) {
                            const next = { ...current };
                            delete next[operationKey];
                            return next;
                          }
                          return {
                            ...current,
                            [operationKey]: nextValue,
                          };
                        });
                      }}
                      placeholder="Why is this pinned or snoozed?"
                      rows={2}
                      className="min-h-[70px] border-white/10 bg-white/[0.04] text-sm text-slate-100 placeholder:text-slate-500"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
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
                  {group.snoozedCount > 0 ? (
                    <span className="inline-flex items-center rounded-full border border-sky-300/16 bg-sky-400/10 px-2 py-0.5 text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-sky-100">
                      Snoozed {group.snoozedCount}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-300/74">{group.description}</p>
                {!expanded ? (
                  <p className="mt-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-slate-400/88">
                    {group.items.length} visible of {group.totalItems} operation{group.totalItems === 1 ? "" : "s"}
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
                  const operationKey = getOperationStorageKey(link);
                  const badge = quickLinkBadge(link);
                  const priorityBadge = quickLinkPriorityBadge(link);
                  const urgency = resolveAssistantOperationUrgency(link);
                  const isPinned = Boolean(pinnedState[operationKey]);
                  const snoozeLabel = resolveSnoozeLabel(operationKey, sessionSnoozeState, persistentSnoozeState);
                  const isSnoozed = Boolean(snoozeLabel);
                  return (
                    <div
                      key={`${group.key}-${link.label}-${link.href}`}
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
                            {isPinned ? (
                              <span className="inline-flex items-center rounded-full border border-fuchsia-300/22 bg-fuchsia-400/12 px-2 py-0.5 text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-fuchsia-100">
                                Pinned
                              </span>
                            ) : null}
                            {isSnoozed ? (
                              <span className="inline-flex items-center rounded-full border border-sky-300/20 bg-sky-400/10 px-2 py-0.5 text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-sky-100">
                                {snoozeLabel}
                              </span>
                            ) : null}
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
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                setPinnedState((current) => ({
                                  ...current,
                                  [operationKey]: !isPinned,
                                }))
                              }
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[0.64rem] font-semibold uppercase tracking-[0.14em] transition ${
                                isPinned
                                  ? "border-fuchsia-300/28 bg-fuchsia-400/12 text-fuchsia-100"
                                  : "border-white/10 bg-white/[0.05] text-slate-200/82 hover:border-fuchsia-300/22 hover:bg-fuchsia-400/10"
                              }`}
                            >
                              <Pin className="h-3 w-3" />
                              {isPinned ? "Pinned" : "Pin"}
                            </button>
                            <button
                              type="button"
                              onClick={() => (isSnoozed ? clearOperationSnooze(operationKey) : setOperationSnoozeMode(operationKey, "session"))}
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[0.64rem] font-semibold uppercase tracking-[0.14em] transition ${
                                isSnoozed
                                  ? "border-sky-300/28 bg-sky-400/12 text-sky-100"
                                  : "border-white/10 bg-white/[0.05] text-slate-200/82 hover:border-sky-300/22 hover:bg-sky-400/10"
                              }`}
                            >
                              {isSnoozed ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                              {isSnoozed ? "Resume" : "Session"}
                            </button>
                            {!isSnoozed ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setOperationSnoozeMode(operationKey, "until_tomorrow")}
                                  className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-slate-200/82 transition hover:border-sky-300/22 hover:bg-sky-400/10"
                                >
                                  Tomorrow
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setOperationSnoozeMode(operationKey, "until_reopened")}
                                  className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-slate-200/82 transition hover:border-sky-300/22 hover:bg-sky-400/10"
                                >
                                  Reopen
                                </button>
                              </>
                            ) : null}
                          </div>
                          <span
                            className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[0.64rem] font-semibold uppercase tracking-[0.14em] ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-emerald-200/82">
                        <Link href={link.href} className="inline-flex items-center gap-1 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-emerald-100 transition hover:border-emerald-300/35 hover:bg-emerald-400/16 hover:text-white">
                          <ArrowUpRight className="h-3.5 w-3.5" />
                          Open surface · {link.id}
                        </Link>
                        {link.auditEvent ? <span className="text-slate-400/82">{link.auditEvent}</span> : null}
                      </div>
                    </div>
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

    const latestAssistantQuickLinks = [...messages]
      .reverse()
      .find((entry): entry is Extract<ConversationEntry, { type: "response" }> => entry.type === "response" && Boolean(entry.response.quickLinks?.length))
      ?.response.quickLinks;
    const localConsoleState = buildLocalConsoleStateSnapshot(preview?.quickLinks ?? latestAssistantQuickLinks);

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
          localConsoleState,
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
