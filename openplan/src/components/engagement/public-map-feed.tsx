"use client";

import { useEffect, useRef } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, MapPinOff, MessageSquare, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PortalTranslator } from "@/lib/engagement/portal-i18n/translator";
import { formatPortalDate, formatPortalNumber } from "@/lib/engagement/portal-i18n/format";
import { portalTextDisclosureView, portalTextLang } from "@/lib/engagement/portal-i18n/provenance";
import { UNCATEGORIZED_MAP_COLOR } from "@/lib/engagement/participant-category-colors";
import { participantItemGeometry, type ParticipantMapItem } from "./public-map-stage";
import { OperatorLine } from "./public-close-loop";
import type { SidebarCategory } from "./public-map-sidebar";

/** The "No topic" filter, for comments sent without one. */
export const NO_TOPIC_FILTER_ID = "__no-topic__";

/** The one-line version of a comment: its title, or the start of what it says. */
function headline(item: ParticipantMapItem): string {
  return item.title?.trim() || item.body.trim().split("\n")[0];
}

/**
 * Closed, the comment list is this one button, docked above the map controls.
 */
export function PublicMapFeedButton({
  open,
  total,
  readFailed,
  onOpen,
  translator,
}: {
  open: boolean;
  total: number;
  /** A failed read has no count: "0" would say nobody commented. */
  readFailed: boolean;
  onOpen: () => void;
  translator: PortalTranslator;
}) {
  const { t } = translator;
  if (open) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="portal-feed-open"
      className="flex min-h-11 w-full items-center gap-2 rounded-xl bg-slate-900/90 px-3.5 text-sm font-semibold text-white shadow-lg backdrop-blur-sm transition hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <MessageSquare className="h-4 w-4" aria-hidden="true" />
      <span>{t("portal.feedOpen")}</span>
      {readFailed ? null : (
        <span className="ms-auto rounded-full bg-white/15 px-2 py-0.5 text-xs tabular-nums">
          {formatPortalNumber(total, translator.bcp47)}
        </span>
      )}
    </button>
  );
}

/**
 * WHAT OTHER PEOPLE SAID, BESIDE THE MAP THEY SAID IT ON.
 *
 * The list used to live only on the about page, so a resident could see pins
 * or read comments but never both at once. The list and the map share one
 * selection: a tap on a pin opens its comment here, and a comment chosen here
 * is ringed and brought into view on the map. Search and topic filters narrow
 * the map and the list together, so the two never disagree about what is shown.
 */
export function PublicMapFeedPanel({
  open,
  onClose,
  items,
  totalCount,
  readFailed,
  categories,
  topicsInUse,
  hiddenCategoryIds,
  onToggleCategory,
  query,
  onQueryChange,
  selectedItemId,
  onSelect,
  onSupport,
  hasVoted,
  previewMode,
  translator,
}: {
  open: boolean;
  onClose: () => void;
  /** The comments left after search and topic filters, in list order. */
  items: ParticipantMapItem[];
  /** Every approved comment, before filtering. */
  totalCount: number;
  readFailed: boolean;
  categories: SidebarCategory[];
  /**
   * Topics at least one comment uses, plus `NO_TOPIC_FILTER_ID` when a comment
   * has none. Only these get a filter: a switch for an empty topic does nothing.
   */
  topicsInUse: readonly string[];
  hiddenCategoryIds: readonly string[];
  onToggleCategory: (categoryId: string) => void;
  query: string;
  onQueryChange: (next: string) => void;
  selectedItemId: string | null;
  onSelect: (itemId: string | null) => void;
  onSupport: (itemId: string) => void;
  hasVoted: (itemId: string) => boolean;
  previewMode: boolean;
  translator: PortalTranslator;
}) {
  const { t, bcp47 } = translator;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const lastListItemRef = useRef<string | null>(null);
  /** Set by previous/next, so stepping keeps focus on the button pressed. */
  const steppedRef = useRef(false);

  const selectedIndex = selectedItemId ? items.findIndex((item) => item.id === selectedItemId) : -1;
  const selected = selectedIndex >= 0 ? items[selectedIndex] : null;

  // A newly opened comment takes focus, so a screen reader reads it and the
  // next Tab reaches its buttons rather than the top of the list.
  useEffect(() => {
    if (!open || !selected) return;
    lastListItemRef.current = selected.id;
    if (steppedRef.current) {
      steppedRef.current = false;
      // Unless the button just pressed became disabled at the end of the list.
      const pressed = document.activeElement as HTMLButtonElement | null;
      if (pressed && pressed !== document.body && !pressed.disabled) return;
    }
    detailRef.current?.focus();
  }, [open, selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opening the list, or going back to it, keeps focus inside it: on the
  // comment the resident just left, or else on the heading. The button that
  // opened the list is gone once it is open.
  useEffect(() => {
    if (!open || selected) return;
    const left = lastListItemRef.current && document.getElementById(`portal-feed-item-${lastListItemRef.current}`);
    if (left) left.focus();
    else headingRef.current?.focus();
  }, [open, selected]);

  if (!open) return null;

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const hidden = new Set(hiddenCategoryIds);
  const filtered = items.length !== totalCount;
  const inUse = new Set(topicsInUse);
  const topicChips = [
    ...categories
      .filter((category) => inUse.has(category.id))
      .map((category) => ({
        id: category.id,
        color: category.color ?? UNCATEGORIZED_MAP_COLOR,
        label: <span lang={portalTextLang(category.labelText)}>{category.labelText.text}</span>,
      })),
    ...(inUse.has(NO_TOPIC_FILTER_ID) && categories.length > 0
      ? [{ id: NO_TOPIC_FILTER_ID, color: UNCATEGORIZED_MAP_COLOR, label: <span>{t("portal.feedNoTopic")}</span> }]
      : []),
  ];
  const machineTopic = categories.find(
    (category) => inUse.has(category.id) && category.labelText.provenance !== "operator"
  );
  const topicDisclosure = machineTopic ? portalTextDisclosureView(machineTopic.labelText, translator) : null;

  const topicName = (item: ParticipantMapItem) => {
    const category = item.categoryId ? categoryById.get(item.categoryId) : undefined;
    return category ? (
      <span lang={portalTextLang(category.labelText)}>{category.labelText.text}</span>
    ) : null;
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (selected) onSelect(null);
    else onClose();
  };

  return (
    <section
      data-map-overlay-panel
      data-testid="portal-feed-panel"
      aria-label={t("portal.feedOpen")}
      onKeyDown={handleKeyDown}
      className={cn(
        "absolute inset-x-3 top-3 z-20 flex max-h-[70%] flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-xl",
        "sm:bottom-3 sm:right-auto sm:max-h-none sm:w-[22rem]"
      )}
    >
      {selected ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1.5">
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {t("portal.feedBack")}
            </button>
            <span className="ms-auto text-xs tabular-nums text-muted-foreground" data-testid="portal-feed-position">
              {t("portal.feedPosition", {
                position: formatPortalNumber(selectedIndex + 1, bcp47),
                total: formatPortalNumber(items.length, bcp47),
              })}
            </span>
            <button
              type="button"
              aria-label={t("portal.feedPrevious")}
              disabled={selectedIndex <= 0}
              onClick={() => {
                steppedRef.current = true;
                onSelect(items[selectedIndex - 1].id);
              }}
              className="inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-muted disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={t("portal.feedNext")}
              disabled={selectedIndex >= items.length - 1}
              onClick={() => {
                steppedRef.current = true;
                onSelect(items[selectedIndex + 1].id);
              }}
              className="inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-muted disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRight className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
            </button>
          </div>

          <div
            ref={detailRef}
            tabIndex={-1}
            data-testid="portal-feed-detail"
            className="min-h-0 flex-1 overflow-y-auto px-4 py-3 focus-visible:outline-none"
          >
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: selected.color ?? UNCATEGORIZED_MAP_COLOR }}
              />
              {topicName(selected)}
              {selected.createdAt ? <span>{formatPortalDate(selected.createdAt, bcp47)}</span> : null}
              {selected.submittedBy ? <span>{selected.submittedBy}</span> : null}
            </p>
            {/* A resident's own words: no `lang`, because nobody recorded which language they wrote in. */}
            {selected.title ? (
              <h3 className="mt-2 text-base font-semibold leading-snug text-foreground">{selected.title}</h3>
            ) : null}
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{selected.body}</p>
            {selected.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-TTL signed URL from a private bucket
              <img
                src={selected.photoUrl}
                alt={t("portal.photoItemAlt")}
                className="mt-3 max-h-56 w-auto max-w-full rounded-lg"
              />
            ) : null}
            {participantItemGeometry(selected) ? null : (
              <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <MapPinOff className="h-3.5 w-3.5" aria-hidden="true" />
                {t("portal.feedNoPlace")}
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {previewMode ? null : (
                <button
                  type="button"
                  onClick={() => onSupport(selected.id)}
                  disabled={hasVoted(selected.id)}
                  aria-pressed={hasVoted(selected.id)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-semibold text-foreground hover:bg-muted disabled:cursor-default disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span aria-hidden="true">▲</span>
                  {hasVoted(selected.id) ? t("portal.supported") : t("portal.support")}
                  <span className="tabular-nums">· {formatPortalNumber(selected.votesCount ?? 0, bcp47)}</span>
                </button>
              )}
            </div>

            {/*
              WHAT THE TEAM DID ABOUT IT, on the comment it answers. The agency's
              words keep their translation caveat; this is where a resident sees
              that somebody read what they wrote.
            */}
            {selected.teamResponses && selected.teamResponses.length > 0 ? (
              <section className="mt-5 space-y-3 border-t border-border/60 pt-4" data-testid="portal-feed-team-response">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("portal.feedTeamResponse")}
                </h4>
                {selected.teamResponses.map((response) => (
                  <div key={response.id}>
                    <OperatorLine
                      value={response.themeTitleText}
                      translator={translator}
                      className="text-sm font-semibold text-foreground"
                    />
                    <OperatorLine
                      value={response.weDidText}
                      translator={translator}
                      className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground"
                    />
                  </div>
                ))}
              </section>
            ) : null}

            {selected.replies && selected.replies.length > 0 ? (
              <section className="mt-5 border-t border-border/60 pt-4" data-testid="portal-feed-replies">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("portal.feedReplies", { count: formatPortalNumber(selected.replies.length, bcp47) })}
                </h4>
                <ul className="mt-2 space-y-3">
                  {selected.replies.map((reply) => (
                    <li key={reply.id} className="border-s-2 border-border ps-3">
                      <p className="text-xs text-muted-foreground">
                        {formatPortalDate(reply.createdAt, bcp47)}
                        {reply.submittedBy ? ` · ${reply.submittedBy}` : ""}
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">{reply.body}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-border/60 py-1.5 pe-1.5 ps-4">
            <h2 ref={headingRef} tabIndex={-1} className="text-sm font-semibold text-foreground focus-visible:outline-none">
              {t("portal.feedOpen")}
            </h2>
            <span className="text-xs tabular-nums text-muted-foreground" data-testid="portal-feed-count">
              {readFailed ? null : filtered
                ? t("portal.feedShowing", {
                    shown: formatPortalNumber(items.length, bcp47),
                    total: formatPortalNumber(totalCount, bcp47),
                  })
                : formatPortalNumber(totalCount, bcp47)}
            </span>
            <button
              type="button"
              aria-label={t("portal.feedClose")}
              onClick={onClose}
              className="ms-auto inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {totalCount > 0 ? (
            <div className="space-y-2 border-b border-border/60 px-3 py-2.5">
              <label className="relative block">
                <span className="sr-only">{t("portal.feedSearch")}</span>
                <Search
                  className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => onQueryChange(event.target.value)}
                  placeholder={t("portal.feedSearch")}
                  className="h-10 w-full rounded-lg border border-input bg-background pe-3 ps-9 text-sm outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
                />
              </label>
              {topicChips.length > 1 ? (
                // One row that scrolls sideways, so topics never push the comments down.
                <div
                  role="group"
                  aria-label={t("portal.feedTopics")}
                  className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 [scrollbar-width:thin]"
                >
                  {topicChips.map((chip) => {
                    const shown = !hidden.has(chip.id);
                    return (
                      <button
                        key={chip.id}
                        type="button"
                        aria-pressed={shown}
                        onClick={() => onToggleCategory(chip.id)}
                        className={cn(
                          "inline-flex min-h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          shown
                            ? "border-border bg-background text-foreground"
                            : "border-dashed border-border/70 bg-muted/40 text-muted-foreground line-through"
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn("h-2.5 w-2.5 rounded-full", shown ? "" : "opacity-40")}
                          style={{ backgroundColor: chip.color }}
                        />
                        {chip.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {topicDisclosure ? (
                <p className="text-xs text-muted-foreground" lang={topicDisclosure.lang} dir={topicDisclosure.dir}>
                  {topicDisclosure.sentence}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {readFailed ? (
              <p className="px-4 py-4 text-sm text-muted-foreground">{t("portal.feedbackUnavailable")}</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground">
                {totalCount === 0 ? t("portal.feedEmpty") : t("portal.feedNoMatches")}
              </p>
            ) : (
              <ul role="list" className="divide-y divide-border/60" data-testid="portal-feed-list">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      id={`portal-feed-item-${item.id}`}
                      onClick={() => onSelect(item.id)}
                      className="flex w-full items-start gap-3 px-4 py-3 text-start hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <span
                        aria-hidden="true"
                        className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: item.color ?? UNCATEGORIZED_MAP_COLOR }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-sm font-medium text-foreground">{headline(item)}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          {topicName(item)}
                          {item.createdAt ? <span>{formatPortalDate(item.createdAt, bcp47)}</span> : null}
                          {item.votesCount ? (
                            <span className="tabular-nums">▲ {formatPortalNumber(item.votesCount, bcp47)}</span>
                          ) : null}
                          {participantItemGeometry(item) ? null : (
                            <span className="inline-flex items-center gap-1">
                              <MapPinOff className="h-3 w-3" aria-hidden="true" />
                              {t("portal.feedNoPlace")}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
