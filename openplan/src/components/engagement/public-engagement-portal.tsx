"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  groupApprovedItems,
  type ApprovedItem,
  type ApprovedItemGrouping,
} from "@/lib/engagement/approved-item-grouping";
import { ClipboardCheck, ClipboardList, Info, Loader2, MapPinned, MessageSquare, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { readStoredEngagementGeometry } from "@/lib/engagement/geometry";
import { ENGAGEMENT_TYPES } from "@/lib/engagement/catalog";
import {
  TRANSLATION_LANGUAGES,
  TRANSLATION_LANGUAGE_NATIVE_LABELS,
  type TranslationLanguage,
} from "@/lib/engagement/translation-languages";
import {
  PORTAL_DEFAULT_LOCALE,
  PORTAL_LOCALE_DIRECTION,
  type ResolvedPortalLocale,
} from "@/lib/engagement/portal-i18n/locales";
import {
  createPortalTranslator,
  type PortalMessageBundle,
  type PortalTranslator,
} from "@/lib/engagement/portal-i18n/translator";
import { formatPortalDate, formatPortalNumber } from "@/lib/engagement/portal-i18n/format";
import {
  portalMessageView,
  portalTextBadge,
  portalTextDisclosureView,
  portalTextLang,
  type PortalDisclosureView,
} from "@/lib/engagement/portal-i18n/provenance";
// Type-only: these modules reach a server-only Supabase client or the message
// catalog for every locale, and an `import type` is erased before the client
// bundle is built. A participant downloads their own language and nothing else.
import type { PortalText } from "@/lib/engagement/portal-i18n/operator-text";
import type { PortalMessageKey } from "@/lib/engagement/portal-i18n/messages";
import type { PortalMapFraming } from "@/lib/engagement/public-portal-data";
import type { ParticipantContextLayerSet } from "@/lib/engagement/context-layers";
import { LocationDisplayMap } from "./location-display-map";
import { PortalLanguageNotice, PortalLanguagePicker } from "./portal-language-picker";
import { PublicSurveyForm, type PortalSurveyQuestion } from "./public-survey-form";
import { PublicCloseLoop, type PublicCloseLoopEntry } from "./public-close-loop";
import { PublicSubscribeForm } from "./public-subscribe-form";
import { PortalSubmissionForm } from "./portal-submission-form";
import { PortalPendingCopyNotice } from "./portal-pending-copy-notice";

/**
 * WHAT IS STILL ENGLISH ON THIS SURFACE — the honest, and now short, list.
 *
 * `PENDING_PORTAL_TEXT` used to sit here: ten participant-facing strings this
 * component rendered in English to every reader, each waiting for a catalog key.
 * All ten landed in `EN_PORTAL_MESSAGES` on 2026-08-13 (with Spanish), the
 * object is gone, and every call site is an ordinary `t(...)`. The five
 * demographic labels among them were the odd case: the catalog had ALREADY
 * carried better wording for months ("Your age range", not "Age range"), so
 * this object was shadowing translations that existed.
 *
 * THREE SOURCES OF ENGLISH REMAIN, all outside this file, all disclosed rather
 * than papered over:
 *
 *   `demographicLabel` (`src/lib/engagement/demographics.ts`) — the age bands,
 *     languages, tenure and race/ethnicity OPTION text. Shared with the operator
 *     console's aggregate views, which must name a band identically, so it
 *     cannot simply become catalog keys.
 *   `PENDING_PORTAL_COPY` (`public-survey-form.tsx`) — 24 widget-level strings in
 *     the SURVEY: "Other", "Not rated", the selection-count hints, the file
 *     limits, the two client-side validation sentences. 12 of them interpolate a
 *     value, and 3 of those (`rankUpTo`, `fileHint`, `fileTooMany`) choose an
 *     English plural from a boolean — `file` / `files` — which the catalog has no
 *     mechanism to express at all. Closing this needs a plural rule per locale
 *     BEFORE it needs translations, which is why it is still open. The survey
 *     renders only on this component's survey tab, so it is reachable on
 *     `/engage/<token>/about` and `/embed/<token>` and nowhere else.
 *   `resolvePortalMapFraming` (`src/lib/engagement/public-portal-data.ts`) —
 *     `unreadableNote` and `submissionRule`, still composed as English prose
 *     server-side and still rendered with `lang="en"` beside the map they
 *     describe. Its `summary` field is NO LONGER printed to a resident by any
 *     surface: `portalMapFramingSentence` rebuilds that sentence from catalog
 *     keys for the map-first shell and for the submission form alike.
 *
 * `PortalPendingCopyNotice` therefore still has work to do, and still sits at
 * the TOP of the portal rather than beside one region: the survey is a tab away
 * and the demographics options are opt-in, so a notice attached to either would
 * be a disclosure a resident meets only after the English has already misled
 * them. Unlabelled English inside an otherwise-Spanish page tells a resident the
 * agency wrote it that way, and under Title VI that is a claim about what the
 * agency published.
 */

/**
 * A category as this component reads it — the operator's own words in the
 * participant's language, WITH the provenance that decides how they must be
 * labelled. Structurally what `loadPublicPortalBundle` produces.
 *
 * `label` and `description` are the SOURCE strings and are deliberately not
 * rendered; `labelText` / `descriptionText` are the translated answer. Both
 * survive because the loader builds both and an operator preview may want the
 * original.
 */
type CategoryOption = {
  id: string;
  label: string;
  description: string | null;
  color?: string | null;
  labelText: PortalText;
  descriptionText: PortalText | null;
};


/**
 * The preview of the comment being replied to. A resident's OWN words, so it is
 * neither OpenPlan copy nor operator text and gets no `lang` — nobody recorded
 * what language a comment was written in, and guessing would mispronounce it.
 */
function replyPreviewLabel(item: ApprovedItem): string {
  const source = item.title?.trim() || item.body.trim();
  return source.length > 60 ? `${source.slice(0, 60)}…` : source;
}

/**
 * A campaign's engagement mode, in the participant's language.
 *
 * The stored value is an internal enum. Keys exist for the three modes
 * `ENGAGEMENT_TYPES` declares; a value outside that set — which only a
 * hand-written database row can produce — returns null so the caller can fall
 * back rather than render a missing key.
 */
type EngagementModeKey = Extract<PortalMessageKey, `engagementType.${string}`>;

function engagementModeKey(value: string): EngagementModeKey | null {
  return (ENGAGEMENT_TYPES as readonly string[]).includes(value)
    ? (`engagementType.${value}` as EngagementModeKey)
    : null;
}

/**
 * Whether a comment carries a place, said in the participant's language.
 *
 * Collapses "a pin" and "a drawn line or area" into one translated word rather
 * than composing "{shape} drawn" out of `engagementGeometryTypeLabel`, whose
 * shape names are English and shared with the operator console. The map beside
 * the feed already shows WHICH shape it is; what the text has to convey is that
 * this comment is attached to a place at all.
 */
function itemIsLocated(item: ApprovedItem): boolean {
  if (readStoredEngagementGeometry(item.geometry ?? null)) return true;
  return item.latitude !== null && item.longitude !== null;
}

/**
 * ONE PIECE OF THE AGENCY'S OWN TEXT, rendered with what is true about it.
 *
 * The badge sits immediately beside the words it qualifies, never in a footer: a
 * resident reading a machine-translated campaign description has to be able to
 * see that it is machine-translated without scrolling. `lang` is the language the
 * text is ACTUALLY in, which is what lets a screen reader switch voices instead
 * of reading untranslated English with Spanish phonology.
 *
 * `compact` drops the sentence and keeps the badge, for chips and meta rows where
 * a full caveat would swamp the thing it qualifies. The badge alone still tells a
 * resident the two apart, which is the non-negotiable part.
 *
 * `dir` TRAVELS WITH `lang`, ON THE SAME ELEMENT, and setting one without the
 * other is the bug this note exists to stop coming back. Direction is not
 * inherited from a language tag by any browser: an untranslated English campaign
 * description inside an Arabic portal inherits the wrapper's `dir="rtl"` and is
 * laid out from the wrong edge — sentence-final punctuation thrown to the left,
 * the paragraph ragged on the side an English reader does not expect. The mirror
 * case is worse and just as reachable: an agency's own Arabic, rendered on an
 * English portal because the participant asked for English, runs left-to-right
 * and is unreadable. `PortalText.textLocale` already knows which language the
 * words are in, so both attributes come from one fact.
 */
function OperatorText({
  value,
  translator,
  as: Tag = "p",
  className,
  compact = false,
}: {
  value: PortalText;
  translator: PortalTranslator;
  as?: "p" | "h3" | "span" | "div";
  className?: string;
  compact?: boolean;
}) {
  const badge = portalTextBadge(value, translator);
  /*
    The VIEW, not the bare sentence, because it carries the language the sentence
    itself came out in. Every locale except Spanish has no catalog yet, so on
    those pages this caveat is the English source sitting inside a page that
    declares itself Korean or Farsi — the exact mismatch the caveat is warning
    about, made by the warning.

    Resolved even when `compact` drops the sentence: a badge is non-null exactly
    when a disclosure is (both are null for, and only for, `operator` text), so
    this is where the badge's own language comes from too, without a second
    switch over provenance that could drift from `provenance.ts`'s.
  */
  const disclosure = portalTextDisclosureView(value, translator);
  const textDirection = PORTAL_LOCALE_DIRECTION[value.textLocale];

  return (
    <>
      <Tag className={className} lang={portalTextLang(value)} dir={textDirection}>
        {value.text}
      </Tag>
      {badge ? (
        <span
          className="ms-1.5 inline-block rounded-full border border-border/70 px-1.5 py-0.5 align-middle text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground"
          lang={disclosure?.lang ?? translator.locale}
          dir={disclosure?.dir ?? translator.direction}
        >
          {badge}
        </span>
      ) : null}
      {disclosure && !compact ? (
        <span
          className="mt-1 block text-xs leading-snug text-muted-foreground"
          lang={disclosure.lang}
          dir={disclosure.dir}
        >
          {disclosure.sentence}
        </span>
      ) : null}
    </>
  );
}

function PortalTabButton({
  active,
  icon,
  label,
  count,
  bcp47,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  count?: number;
  /** The participant's locale, so a count is grouped the way they read numbers. */
  bcp47: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 items-center gap-2 border-b-2 px-1 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:ring-offset-2",
        active
          ? "border-[color:var(--pine)] text-foreground"
          : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
      )}
    >
      {icon}
      <span>{label}</span>
      {typeof count === "number" ? (
        <span className="text-xs font-semibold text-muted-foreground">({formatPortalNumber(count, bcp47)})</span>
      ) : null}
    </button>
  );
}

export function PublicEngagementPortal({
  shareToken,
  acceptingSubmissions,
  categories,
  approvedItems,
  readFailures = { comments: false, categories: false, closeLoop: false, project: false },
  engagementType,
  demographicsEnabled = false,
  projectContext,
  surveyQuestions = [],
  closeLoopEntries = [],
  emailUpdatesAvailable = false,
  mapFraming: framing,
  contextLayers = null,
  locale,
  messages,
  renderLanguagePicker = false,
  previewMode = false,
}: {
  shareToken: string;
  acceptingSubmissions: boolean;
  categories: CategoryOption[];
  approvedItems: ApprovedItem[];
  /**
   * Which of this portal's reads failed. Rendered, not just carried: a field
   * describing a failure that no surface shows is the same defect as the failure
   * being swallowed in the first place.
   */
  /*
    EVERY flag the loader produces is named here, and that is load-bearing rather
    than tidy. This prop arrives by JSX spread from two surfaces, and TypeScript
    does not excess-property-check a spread — so a flag the loader sets and this
    type omits is dropped silently, with a green build. That is exactly what
    happened to `closeLoop` and `project`: the loader raised them, nothing
    received them, and a failed close-the-loop read went on hiding the tab that
    proves an agency answered its community.
  */
  readFailures?: { comments: boolean; categories: boolean; closeLoop: boolean; project: boolean };
  engagementType: string;
  demographicsEnabled?: boolean;
  /**
   * The linked project this campaign belongs to.
   *
   * Rendered as the name and summary only, with no label of its own: the full
   * public page introduces the same project twice in its hero, and a third
   * introduction is copy a resident learns to skip. On the embeddable widget
   * this is the only place the project appears at all.
   */
  projectContext?: {
    name: string;
    summary: string | null;
  } | null;
  surveyQuestions?: PortalSurveyQuestion[];
  closeLoopEntries?: PublicCloseLoopEntry[];
  emailUpdatesAvailable?: boolean;
  /**
   * Where this map opens and why, resolved server-side by
   * `loadPublicPortalBundle` — the campaign's own area, then the linked
   * project's, then the workspace's, then the pins already on the map.
   *
   * It arrives resolved rather than as raw candidates because the campaign
   * console is shown the SAME object, so both surfaces state one fact instead of
   * two calculations that can drift.
   *
   * REQUIRED on purpose. The defect that keeps recurring in this repo is a
   * finished capability made unreachable by a prop nobody passed at the render
   * site; a required prop turns that into a build error instead of a map that
   * silently opens on the whole country. `resolvePortalMapFraming` always
   * returns a value — "nothing framed this map" is one of its answers, not an
   * absence — so there is nothing for a caller to be unable to supply.
   */
  mapFraming: PortalMapFraming;
  /**
   * The campaign's PUBLISHED GIS context — the proposed alignment, the parcels,
   * the existing network — drawn under the resident's own sketch and under the
   * community's pins, each with its name in the legend.
   *
   * Until this arrives, a resident is asked to comment on a bare basemap: "widen
   * it here" with no "it" on screen. Both maps below hand it straight to
   * `syncContextLayers`, and the whole set travels — including `readFailure`,
   * because a layer read that broke must not render as a campaign with no
   * geometry to show.
   *
   * `loadPublicPortalBundle` now calls `loadParticipantContextLayers` — the one
   * query that decides what the public may see — and puts the result on
   * `PublicPortalProps`, which both portal pages spread. It stays optional only
   * so the embed and preview surfaces that build props by hand keep compiling;
   * the portal itself is always given a set, and a null here draws no layers
   * rather than pretending there are none to draw.
   */
  contextLayers?: ParticipantContextLayerSet | null;
  /**
   * WHICH LANGUAGE THIS PORTAL IS IN, and how that was decided. Resolved once by
   * `loadPublicPortalBundle` and carried on `PublicPortalProps`, so the two
   * surfaces that render this component cannot disagree about it.
   *
   * Passed on to the language picker, which needs to know which option is the
   * current one. REQUIRED, like `mapFraming` and for the same reason: an
   * optional locale is one a render site can silently omit, and the symptom is a
   * resident who chose Vietnamese being answered in English by a page that says
   * nothing about it.
   */
  locale: ResolvedPortalLocale;
  /**
   * OpenPlan's own participant-facing copy in that language — this locale's
   * strings plus the list of keys that fell back to English.
   *
   * A plain object rather than a lookup function because functions do not cross
   * the server/client boundary; the translator is rebuilt here with
   * `createPortalTranslator`. It also means a participant downloads their own
   * language and not every other locale's.
   */
  messages: PortalMessageBundle;
  /**
   * WHETHER THIS COMPONENT PROVIDES THE PAGE'S LANGUAGE CHROME — the way into
   * another language, AND the disclosure of what this one is missing.
   *
   * The two travel together and must never be separated. A picker with no
   * notice leaves a resident an exit they have no reason to take, because
   * nothing told them the page they are reading is not really in their language.
   * A notice with no picker tells them something is wrong and gives them no way
   * to act on it. Either half alone is worse than the pair.
   *
   * Default FALSE because the surface that should own both is the ROUTE: it
   * knows its own path and its own query string, it can place them above the
   * campaign title where a resident meets them before reading anything, and it
   * can render them without JavaScript. The full public page does exactly that
   * (`/engage/[shareToken]/page.tsx` renders `PortalLanguagePicker` and
   * `PortalLanguageNotice` in its header), and a second copy of either one
   * screen below is noise a resident reads as a bug.
   *
   * TRUE is for a surface that has neither. The embeddable widget is that
   * surface: `/embed/[shareToken]/page.tsx` renders this component under a bare
   * header, so without this an iframe participant is held in whichever language
   * the request happened to resolve to AND is never told that the English they
   * are reading is a fallback rather than the agency's choice. Under Title VI
   * those are not equivalent, which is why the notice is part of this prop's job
   * and not a separate switch a caller could forget half of.
   *
   * WIRING IT INTO THE EMBED ROUTE IS A ONE-LINE CHANGE IN A FILE THIS WORK DOES
   * NOT OWN, and it is reported rather than claimed: until `/embed` passes this,
   * the capability below has no caller outside the tests.
   */
  renderLanguagePicker?: boolean;
  /**
   * OPERATOR PREVIEW: render exactly what a resident would see, and send
   * NOTHING. Set only by the member-gated preview page
   * (`/engagement/[campaignId]/preview`), never by a resident-facing route.
   *
   * Every network-calling surface in this component — the comment form, the
   * photo upload it triggers, votes, per-comment translation, the survey form,
   * the subscribe form — is short-circuited at the handler AND disabled at the
   * button when this is true. Both layers on purpose: a disabled button is the
   * honest UI, and the handler guard is what makes "a preview cannot write to
   * the public record" a property of the component rather than of the markup.
   *
   * The forms still RENDER, because the point of a preview is to see the page
   * residents will get — a preview that hides the submission form is previewing
   * a different page.
   */
  previewMode?: boolean;
}) {
  const hasSurvey = surveyQuestions.length > 0;
  /*
    The tab survives a failed read, and that is the whole point of the flag. An
    empty list and an unreadable one look identical here, but they say opposite
    things about the agency: one means it has not answered its community yet, the
    other means we could not tell. Hiding the tab on a failure asserts the first.
  */
  const hasCloseLoop = closeLoopEntries.length > 0 || readFailures.closeLoop;
  const [activeTab, setActiveTab] = useState<"submit" | "feedback" | "survey" | "closeloop">(
    acceptingSubmissions ? "submit" : "feedback"
  );
  const [sortOrder, setSortOrder] = useState<"newest" | "most_supported">("newest");
  const [supportedItemIds, setSupportedItemIds] = useState<Set<string>>(new Set());
  const [voteCounts, setVoteCounts] = useState<Record<string, number>>({});
  // E6 — the top-level comment the participant is replying to (null = a new
  // top-level submission). Set from a "Reply" button in the feed.
  const [replyTarget, setReplyTarget] = useState<{ id: string; label: string } | null>(null);
  // E8 — per-comment machine translation (null language = show original).
  const [translations, setTranslations] = useState<
    Record<string, { language: TranslationLanguage; text: string | null; status: "loading" | "done" | "unavailable" }>
  >({});

  // Rebuilt from the bundle rather than passed as a function, and memoised so the
  // `useMemo`s below that depend on it are not invalidated on every render.
  const translator = useMemo(() => createPortalTranslator(messages), [messages]);
  const { t, bcp47 } = translator;

  const supportedStorageKey = `openplan-engagement-supported-${shareToken}`;

  // localStorage memory of supported items is a soft client hint only — the
  // server-side unique constraint is the real idempotency guard.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(supportedStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        setSupportedItemIds(new Set(parsed.filter((value): value is string => typeof value === "string")));
      }
    } catch {
      // Ignore unreadable local storage.
    }
  }, [supportedStorageKey]);

  // The operator's own words for each topic, in the participant's language and
  // carrying their provenance — not the source label, which is what the feed
  // used to show a Spanish reader.
  const categoryMap = useMemo(() => {
    const map = new Map<string, PortalText>();
    for (const category of categories) {
      map.set(category.id, category.labelText);
    }
    return map;
  }, [categories]);

  const categoryColorMap = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const category of categories) {
      map.set(category.id, category.color ?? null);
    }
    return map;
  }, [categories]);

  const displayedVotes = (item: ApprovedItem): number => voteCounts[item.id] ?? item.votesCount ?? 0;

  // E6 — the feed is threaded: top-level comments with their approved replies
  // nested underneath. Sorting, the map, and counts operate on top-level items.
  const { topLevel, repliesByParent } = useMemo(() => groupApprovedItems(approvedItems), [approvedItems]);

  function startReply(item: ApprovedItem) {
    setReplyTarget({ id: item.id, label: replyPreviewLabel(item) });
    setActiveTab("submit");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function translateComment(itemId: string, language: TranslationLanguage) {
    // Preview sends nothing — see `previewMode` on the props.
    if (previewMode) return;
    setTranslations((previous) => ({ ...previous, [itemId]: { language, text: null, status: "loading" } }));
    try {
      const response = await fetch(`/api/engage/${shareToken}/items/${itemId}/translate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language }),
      });
      const payload = (await response.json()) as { translated?: string | null; source?: string };
      if (!response.ok || payload.source === "unavailable" || typeof payload.translated !== "string") {
        setTranslations((previous) => ({ ...previous, [itemId]: { language, text: null, status: "unavailable" } }));
        return;
      }
      setTranslations((previous) => ({ ...previous, [itemId]: { language, text: payload.translated as string, status: "done" } }));
    } catch {
      setTranslations((previous) => ({ ...previous, [itemId]: { language, text: null, status: "unavailable" } }));
    }
  }

  function clearTranslation(itemId: string) {
    setTranslations((previous) => {
      const next = { ...previous };
      delete next[itemId];
      return next;
    });
  }

  const sortedItems = useMemo(() => {
    if (sortOrder === "newest") return topLevel;
    return [...topLevel].sort((left, right) => {
      const voteDelta =
        (voteCounts[right.id] ?? right.votesCount ?? 0) - (voteCounts[left.id] ?? left.votesCount ?? 0);
      if (voteDelta !== 0) return voteDelta;
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });
  }, [topLevel, sortOrder, voteCounts]);

  function persistSupported(next: Set<string>) {
    setSupportedItemIds(next);
    try {
      window.localStorage.setItem(supportedStorageKey, JSON.stringify([...next]));
    } catch {
      // Ignore unwritable local storage.
    }
  }

  async function supportItem(itemId: string): Promise<number | null> {
    // A preview vote would be an operator's thumb on their own public record.
    if (previewMode) return null;
    if (supportedItemIds.has(itemId)) return null;

    const baseCount = voteCounts[itemId] ?? approvedItems.find((item) => item.id === itemId)?.votesCount ?? 0;

    // Optimistic update; the server response (including alreadyVoted replays)
    // settles the final count.
    persistSupported(new Set([...supportedItemIds, itemId]));
    setVoteCounts((previous) => ({ ...previous, [itemId]: baseCount + 1 }));

    try {
      const response = await fetch(`/api/engage/${shareToken}/items/${itemId}/vote`, { method: "POST" });
      const payload = (await response.json()) as { error?: string; votesCount?: number };
      if (!response.ok) {
        throw new Error(payload.error || t("portal.supportFailed"));
      }
      const confirmed = typeof payload.votesCount === "number" ? payload.votesCount : baseCount + 1;
      setVoteCounts((previous) => ({ ...previous, [itemId]: confirmed }));
      return confirmed;
    } catch {
      setVoteCounts((previous) => ({ ...previous, [itemId]: baseCount }));
      const reverted = new Set(supportedItemIds);
      reverted.delete(itemId);
      persistSupported(reverted);
      return null;
    }
  }

  /*
    The campaign's mode, in the participant's language when it is one of the
    three `ENGAGEMENT_TYPES` declares.

    The fallback branch renders a stored enum with its underscores removed, which
    only a hand-written database row can reach — and which is an English word
    either way. It is marked as English rather than inheriting the page's
    language for the same reason every other fallback here is: a screen reader
    told the page is Farsi would otherwise pronounce it with Farsi phonology.
  */
  const modeKey = engagementModeKey(engagementType);
  const mode: PortalDisclosureView = modeKey
    ? portalMessageView(translator, modeKey)
    : {
        sentence: engagementType.replaceAll("_", " "),
        lang: PORTAL_DEFAULT_LOCALE,
        dir: PORTAL_LOCALE_DIRECTION[PORTAL_DEFAULT_LOCALE],
      };

  function renderComment(item: ApprovedItem, options: { isReply: boolean }) {
    const categoryText = item.categoryId ? categoryMap.get(item.categoryId) ?? null : null;
    const supported = supportedItemIds.has(item.id);
    const replies = options.isReply ? [] : repliesByParent.get(item.id) ?? [];
    const translation = translations[item.id];

    return (
      <article
        key={item.id}
        className={`public-ledger-row public-ledger-row--feedback${options.isReply ? " public-ledger-row--reply" : ""}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="public-ledger-body">
            <div className="public-ledger-meta-row text-xs text-muted-foreground">
              {options.isReply ? <span className="public-inline-label">{t("portal.reply")}</span> : null}
              {categoryText ? (
                <span className="public-inline-label">
                  <OperatorText as="span" value={categoryText} translator={translator} compact />
                </span>
              ) : null}
              {itemIsLocated(item) ? (
                <span className="inline-flex items-center gap-1">
                  <MapPinned className="h-3 w-3" aria-hidden="true" />
                  {t("portal.located")}
                </span>
              ) : null}
              {/* The participant's locale, not the server's: most of the
                  languages this portal carries read 3/7/2026 as a different day
                  than en-US does. */}
              <span>{formatPortalDate(item.createdAt, bcp47)}</span>
              {/*
                A resident's own name, alone. "by X" would need a sentence the
                catalog does not carry yet, and a bare name in a meta row is
                legible in every language on the list.
              */}
              {item.submittedBy ? <span>{item.submittedBy}</span> : null}
            </div>
            {/*
              A resident's own words. No `lang`: nobody recorded which language a
              comment was written in, and asserting one would make a screen
              reader pronounce it wrongly with confidence.
            */}
            {item.title ? <h3 className="public-ledger-title">{item.title}</h3> : null}
            <p className="public-ledger-copy whitespace-pre-wrap text-sm leading-relaxed text-foreground">{item.body}</p>
            {item.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-TTL signed URL from a private bucket
              <img
                src={item.photoUrl}
                alt={t("portal.photoItemAlt")}
                className="mt-3 max-h-56 w-auto max-w-full rounded-lg border border-border/70"
              />
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <label className="inline-flex items-center gap-1.5 text-muted-foreground">
                {t("portal.translateInto")}
                <select
                  aria-label={t("portal.translateThis")}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-primary/50 focus-visible:ring-3 focus-visible:ring-primary/20"
                  value={translation?.language ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (!value) clearTranslation(item.id);
                    else void translateComment(item.id, value as TranslationLanguage);
                  }}
                >
                  <option value="">{t("portal.showOriginal")}</option>
                  {/*
                    Each language named in its OWN script. "Korean" is useless to
                    the reader who needs it; «한국어» is the one word in the list
                    they are certain to recognise.
                  */}
                  {TRANSLATION_LANGUAGES.map((language) => (
                    <option
                      key={language}
                      value={language}
                      lang={language}
                      dir={PORTAL_LOCALE_DIRECTION[language]}
                    >
                      {TRANSLATION_LANGUAGE_NATIVE_LABELS[language]}
                    </option>
                  ))}
                </select>
              </label>
              {translation?.status === "loading" ? (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  {t("portal.translating")}
                </span>
              ) : null}
            </div>
            {translation?.status === "done" && translation.text ? (
              <div className="mt-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                <p
                  className="whitespace-pre-wrap text-sm leading-relaxed text-foreground"
                  lang={translation.language}
                  dir={PORTAL_LOCALE_DIRECTION[translation.language]}
                >
                  {translation.text}
                </p>
                {/*
                  The same sentence the rest of the portal uses for machine
                  output. One wording for one promise: a resident who has learnt
                  what the badge means on a campaign description should not have
                  to learn a second phrasing here.
                */}
                <p className="mt-1.5 text-[0.7rem] text-muted-foreground">{t("provenance.machine.caveat")}</p>
              </div>
            ) : null}
            {translation?.status === "unavailable" ? (
              <p className="mt-2 text-xs text-muted-foreground">{t("portal.translationUnavailable")}</p>
            ) : null}
            {!options.isReply && acceptingSubmissions ? (
              <button
                type="button"
                onClick={() => startReply(item)}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition hover:text-[color:var(--pine)]"
              >
                <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" /> {t("portal.reply")}
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void supportItem(item.id)}
            disabled={supported || previewMode}
            aria-pressed={supported}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-foreground transition hover:border-[color:var(--pine)] hover:text-[color:var(--pine)] disabled:cursor-default disabled:opacity-70"
          >
            ▲ {supported ? t("portal.supported") : t("portal.support")} ·{" "}
            {formatPortalNumber(displayedVotes(item), bcp47)}
          </button>
        </div>
        {replies.length > 0 ? (
          // `border-s`/`ps` rather than `border-l`/`pl`: a reply thread has to
          // indent from the side the language starts on, or an Arabic thread
          // indents away from its own parent.
          <div className="mt-3 space-y-2 border-s-2 border-border/50 ps-4">
            {replies.map((reply) => renderComment(reply, { isReply: true }))}
          </div>
        ) : null}
      </article>
    );
  }

  return (
    // `dir` sits on the portal's OWN wrapper, not on the app shell: this is a
    // public surface and the shell is shared with the operator console, which is
    // not translated and must not flip. The full public page also sets `dir` on
    // its own section — same value, so nesting is a no-op — while the embed sets
    // nothing above this component, which is exactly why it belongs here.
    <div className="flex flex-col gap-4" dir={translator.direction} lang={bcp47}>
      {/*
        THE LANGUAGE CHROME, FIRST — before a resident reads a paragraph of
        unexpected English, not after it. Rendered only where the surrounding
        route provides none of its own; see `renderLanguagePicker`.

        POSITION IS THE POINT. A coverage notice below the comment feed is a
        disclosure a resident meets after the page has already misled them, and a
        picker below it is an exit found only by someone who kept scrolling
        through a language they cannot read. Both belong at the top of the
        surface, which on the embeddable widget is directly under its bare
        header.
      */}
      {/*
        A page-level disclosure for reads that failed, above everything they
        affect. It carries no database message on purpose — the reader here is a
        member of the public, and "which part failed" is what they need, not
        why. It renders on BOTH surfaces (portal route and embed), because the
        embed is the copy most likely to be read without the agency nearby.
      */}
      {readFailures.comments || readFailures.categories || readFailures.closeLoop || readFailures.project ? (
        <div
          role="status"
          className="rounded-lg border border-amber-300/60 bg-amber-50/60 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
        >
          {t("portal.partOfPageUnavailable")}
        </div>
      ) : null}

      {renderLanguagePicker ? (
        <div className="flex flex-col gap-2 border-b border-border/60 pb-3">
          <PortalLanguageNotice locale={locale} messages={messages} />
          <PortalLanguagePicker
            locale={locale}
            messages={messages}
            /*
              EMPTY ON PURPOSE, and it is what makes this correct on any route.
              `portalLocaleHref("", …, "es")` yields `?lang=es` — a query-only
              relative reference, which resolves against whatever path the
              document is served at. Two surfaces render this component,
              `/engage/<token>` and `/embed/<token>`, and naming either would
              send an iframe to the other. `usePathname` was the alternative and
              was worse: it couples every test that mocks `next/navigation` to
              this component, and buys only an absolute href a browser does not
              need.

              The cost is that any OTHER query parameter is dropped from these
              links. Preserving them would mean `useSearchParams`, whose
              static-render bailout is not worth taking on a public participant
              surface; a route that has the whole query string should render the
              chrome itself, which is what the full public page does.
            */
            pathname=""
          />
        </div>
      ) : null}

      {/*
        Said BEFORE the English, and before any tab of it — the map-framing
        sentence on the submit tab and the sort control on the feedback tab are
        both English on every locale, so a notice attached to one region of the
        form left the other undisclosed. Silent on an English portal and silent
        whenever the route's own `PortalLanguageNotice` is already saying it.
      */}
      <PortalPendingCopyNotice translator={translator} />

      <div className="public-content-grid public-content-grid--portal">
        <div className="public-surface">
          <div className="public-section-header border-b border-border/60 pb-4">
            {/*
              No kicker above this heading. It used to repeat `page.kicker`,
              which the hero one screen above already says — and a label a
              resident reads twice is a label they stop reading.
            */}
            <div>
              <h2 className="public-section-title">
                {activeTab === "submit"
                  ? t("portal.tab.submit")
                  : activeTab === "survey"
                    ? t("portal.tab.survey")
                    : activeTab === "closeloop"
                      ? t("portal.tab.closeLoop")
                      : t("portal.tab.feedback")}
              </h2>
            </div>
            <p className="public-section-description max-w-2xl">
              {activeTab === "submit"
                ? t("portal.yourInputHint")
                : activeTab === "survey"
                  ? t("portal.reviewNotice")
                  : activeTab === "closeloop"
                    ? t("closeLoop.intro")
                    : t("page.publishedFeedbackDetail")}
            </p>
          </div>

          <div className="public-tab-strip">
            {acceptingSubmissions ? (
              <PortalTabButton
                active={activeTab === "submit"}
                icon={<Send className="h-3.5 w-3.5" aria-hidden="true" />}
                label={t("portal.tab.submit")}
                bcp47={bcp47}
                onClick={() => setActiveTab("submit")}
              />
            ) : null}
            {hasSurvey ? (
              <PortalTabButton
                active={activeTab === "survey"}
                icon={<ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />}
                label={t("portal.tab.survey")}
                count={surveyQuestions.length}
                bcp47={bcp47}
                onClick={() => setActiveTab("survey")}
              />
            ) : null}
            {hasCloseLoop ? (
              <PortalTabButton
                active={activeTab === "closeloop"}
                icon={<ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />}
                label={t("portal.tab.closeLoop")}
                /* No badge when the read failed: "(0)" here is a count of the
                   agency's responses, and we did not get to take it. */
                count={readFailures.closeLoop ? undefined : closeLoopEntries.length}
                bcp47={bcp47}
                onClick={() => setActiveTab("closeloop")}
              />
            ) : null}
            <PortalTabButton
              active={activeTab === "feedback"}
              icon={<MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />}
              label={t("portal.tab.feedback")}
              count={topLevel.length}
              bcp47={bcp47}
              onClick={() => setActiveTab("feedback")}
            />
          </div>

          <div className="mt-5 space-y-5">
            {activeTab === "submit" && acceptingSubmissions ? (
              <>
                <div className="public-fact-grid public-fact-grid--three public-fact-grid--compact">
                  <div className="public-fact">
                    <p className="public-fact-label">{t("portal.about")}</p>
                    <p className="public-fact-detail text-foreground" lang={mode.lang} dir={mode.dir}>
                      {mode.sentence}
                    </p>
                  </div>
                  <div className="public-fact">
                    <p className="public-fact-label">{t("portal.yourInput")}</p>
                    <p className="public-fact-detail text-foreground">{t("portal.onlyRequiredField")}</p>
                  </div>
                  <div className="public-fact">
                    <p className="public-fact-label">{t("portal.whatHappensNext")}</p>
                    <p className="public-fact-detail text-foreground">{t("portal.reviewNotice")}</p>
                  </div>
                </div>

                {/*
                  THE SAME FORM `/engage/<token>` RENDERS. Until 2026-08-14 this
                  was `SubmissionForm`, a second implementation that lived in
                  this file — and being the second implementation is what let it
                  fall behind on an API refusal shown in English to a Spanish
                  reader, an empty comment reaching the server, and a payload
                  that trimmed nothing.

                  `place.source` is "inline" because on THIS route there is no
                  full-screen stage: the map is a field inside the form rather
                  than the page around it. That is the only thing the three
                  doors disagree about, and it is now data rather than a second
                  component.
                */}
                <PortalSubmissionForm
                  shareToken={shareToken}
                  acceptingSubmissions={acceptingSubmissions}
                  categories={categories}
                  demographicsEnabled={demographicsEnabled}
                  translator={translator}
                  place={{ source: "inline", mapFraming: framing, contextLayers }}
                  parentItemId={replyTarget?.id ?? null}
                  replyingToLabel={replyTarget?.label ?? null}
                  onCancelReply={replyTarget ? () => setReplyTarget(null) : undefined}
                  previewMode={previewMode}
                />
              </>
            ) : null}

            {activeTab === "submit" && !acceptingSubmissions ? (
              <div className="public-success-state">
                <MessageSquare className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <h3 className="mt-4 text-lg font-semibold text-foreground">
                  {t("portal.submissionsClosedNotice")}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">{t("page.publishedFeedbackDetail")}</p>
              </div>
            ) : null}

            {activeTab === "survey" && hasSurvey ? (
              acceptingSubmissions ? (
                <PublicSurveyForm
                  shareToken={shareToken}
                  questions={surveyQuestions}
                  messages={messages}
                  previewMode={previewMode}
                />
              ) : (
                <div className="public-success-state">
                  <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
                  <h3 className="mt-4 text-lg font-semibold text-foreground">{t("survey.closed")}</h3>
                </div>
              )
            ) : null}

            {activeTab === "closeloop" && hasCloseLoop ? (
              readFailures.closeLoop && closeLoopEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("portal.partOfPageUnavailable")}</p>
              ) : (
                <PublicCloseLoop entries={closeLoopEntries} translator={translator} />
              )
            ) : null}

            {activeTab === "feedback" ? (
              <>
                <div className="public-map-frame public-map-frame--display">
                  <LocationDisplayMap
                    items={topLevel.map((item) => ({
                      id: item.id,
                      latitude: item.latitude,
                      longitude: item.longitude,
                      title: item.title,
                      body: item.body,
                      geometry: item.geometry,
                      votesCount: displayedVotes(item),
                      color: item.categoryId ? categoryColorMap.get(item.categoryId) ?? null : null,
                    }))}
                    onSupport={supportItem}
                    hasVoted={(itemId) => supportedItemIds.has(itemId)}
                    contextLayers={contextLayers}
                  />
                </div>

                {topLevel.length === 0 ? (
                  <div className="public-success-state text-sm text-muted-foreground">
                    {/*
                      "No published feedback yet" is a statement about this
                      campaign. A failed read cannot make it — and here it would
                      tell residents that nobody in their community took part.
                    */}
                    {readFailures.comments ? t("portal.feedbackUnavailable") : t("portal.noFeedbackYet")}
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">
                        {t("portal.itemCount", { count: formatPortalNumber(topLevel.length, bcp47) })}
                      </p>
                      <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        <span>{t("portal.sortBy")}</span>
                        <select
                          className="h-9 rounded-lg border border-input bg-background px-2.5 text-xs shadow-xs outline-none focus-visible:border-primary/50 focus-visible:ring-3 focus-visible:ring-primary/20"
                          value={sortOrder}
                          onChange={(event) => setSortOrder(event.target.value as "newest" | "most_supported")}
                        >
                          <option value="newest">{t("portal.sortNewest")}</option>
                          <option value="most_supported">{t("portal.sortMostSupported")}</option>
                        </select>
                      </label>
                    </div>

                    <div className="public-ledger">
                      {sortedItems.map((item) => renderComment(item, { isReply: false }))}
                    </div>
                  </>
                )}
              </>
            ) : null}
          </div>
        </div>

        <div className="space-y-5">
          {emailUpdatesAvailable ? (
            <article className="public-surface">
              <PublicSubscribeForm
                shareToken={shareToken}
                translator={translator}
                previewMode={previewMode}
              />
            </article>
          ) : null}
          {categories.length > 0 ? (
            <article className="public-surface">
              <div className="public-section-header">
                <div>
                  <p className="public-section-label">{t("portal.topics")}</p>
                  <h2 className="public-section-title">{t("portal.aboutProcess")}</h2>
                </div>
              </div>
              <div className="public-ledger">
                {categories.map((category) => (
                  <div key={category.id} className="public-ledger-row">
                    <div className="public-ledger-body">
                      <OperatorText
                        as="h3"
                        className="public-ledger-title"
                        value={category.labelText}
                        translator={translator}
                      />
                      {category.descriptionText ? (
                        <OperatorText
                          className="public-ledger-copy"
                          value={category.descriptionText}
                          translator={translator}
                        />
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ) : null}

          {/*
            DELIBERATELY LEANER THAN IT WAS. This rail used to label the linked
            project with `page.supports` and to restate two of the page's posture
            items — all three of which the hero one screen above already says, in
            the same words, so a resident read each of them twice. What
            carries to the embeddable widget, where this rail is the only such
            context, is the campaign's mode and what happens to a submission;
            project framing belongs to the surrounding page.
          */}
          <article className="public-rail">
            <div className="flex items-center gap-3">
              <span className="public-rail-icon">
                <Info className="h-5 w-5 text-sky-200" aria-hidden="true" />
              </span>
              <div>
                <p className="public-rail-kicker">{t("portal.about")}</p>
                <h2 className="public-rail-title" lang={mode.lang} dir={mode.dir}>
                  {mode.sentence}
                </h2>
              </div>
            </div>
            <p className="public-rail-copy">{t("page.submissionStatusDetail")}</p>
            {projectContext ? (
              <div className="public-rail-context">
                {/*
                  The project's own name, as its agency recorded it — a proper
                  noun, so not translated and not translatable. It carries NO
                  label: `page.supports` and `page.linkedProject` both already
                  introduce this same project in the hero one screen above, and a
                  third introduction is copy a resident learns to skip.
                */}
                <p className="text-base font-semibold text-white">{projectContext.name}</p>
                {projectContext.summary ? (
                  <p className="mt-2 text-sm text-slate-300/84">{projectContext.summary}</p>
                ) : null}
              </div>
            ) : null}
          </article>
        </div>
      </div>

    </div>
  );
}

// Re-exported for callers that already import these from the portal. The
// definitions live in @/lib/engagement/approved-item-grouping so a SERVER
// component can call them — see that file for what happens when it cannot.
export { groupApprovedItems };
export type { ApprovedItem, ApprovedItemGrouping };
