"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CheckCircle2, ClipboardCheck, ClipboardList, Info, Loader2, MapPinned, MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  readStoredEngagementGeometry,
  type EngagementGeometry,
} from "@/lib/engagement/geometry";
import { ENGAGEMENT_PHOTO_MAX_BYTES } from "@/lib/engagement/photo";
import {
  AGE_BANDS,
  HOUSEHOLD_TENURE,
  LANGUAGES,
  RACE_ETHNICITY,
  demographicLabel,
} from "@/lib/engagement/demographics";
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
import {
  formatPortalDate,
  formatPortalMegabytes,
  formatPortalNumber,
} from "@/lib/engagement/portal-i18n/format";
import {
  portalMessageView,
  portalTextBadge,
  portalTextDisclosureView,
  portalTextLang,
  type PortalDisclosureView,
} from "@/lib/engagement/portal-i18n/provenance";
// Type-only: these modules reach a server-only Supabase client or the whole
// eleven-locale catalog, and an `import type` is erased before the client bundle
// is built. A participant downloads their own language and nothing else.
import type { PortalText } from "@/lib/engagement/portal-i18n/operator-text";
import type { PortalMessageKey } from "@/lib/engagement/portal-i18n/messages";
import type { PortalMapFraming } from "@/lib/engagement/public-portal-data";
import type { ParticipantContextLayerSet } from "@/lib/engagement/context-layers";
import { GeometryPickerMap } from "./geometry-picker-map";
import { LocationDisplayMap } from "./location-display-map";
import { PortalLanguageNotice, PortalLanguagePicker } from "./portal-language-picker";
import { PublicSurveyForm, type PortalSurveyQuestion } from "./public-survey-form";
import { PublicCloseLoop, type PublicCloseLoopEntry } from "./public-close-loop";
import { PublicSubscribeForm } from "./public-subscribe-form";

const PUBLIC_SELECT_CLASS =
  "flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-primary/50 focus-visible:ring-3 focus-visible:ring-primary/20";

/**
 * PARTICIPANT-FACING STRINGS THIS PORTAL STILL SHOWS IN ENGLISH TO EVERY READER,
 * each named for the catalog key it is waiting for.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT A SECOND CATALOG. Every other string on this
 * surface now comes from `messages.ts` through the translator, which is the one
 * place participant copy may live. These are the strings the catalog does not
 * carry yet, and both alternatives were worse: left as bare literals they would
 * be invisible to anyone auditing coverage, and deleted they would take real
 * guidance away from a member of the public to make a coverage number look
 * better.
 *
 * THE CONTRACT EVERY ENTRY CARRIES. The key IS the key being requested — adding
 * it to `EN_PORTAL_MESSAGES` and deleting the line here is the whole migration,
 * with no call-site change beyond `pending(...)` becoming `t(...)`. Until then
 * every call site sets `lang={PORTAL_DEFAULT_LOCALE}` on the element carrying
 * the string, so assistive technology pronounces it as the English it is rather
 * than reading it with the page's phonology.
 *
 * TWO MORE SOURCES OF ENGLISH ARE NOT IN HERE because they are not this file's
 * strings, and both are reported alongside this change rather than papered over:
 *
 *   `demographicLabel` (`src/lib/engagement/demographics.ts`) — the age bands,
 *     languages, tenure and race/ethnicity OPTION text. Shared with the operator
 *     console's aggregate views, so it cannot simply become catalog keys.
 *   `resolvePortalMapFraming` (`src/lib/engagement/public-portal-data.ts`) —
 *     builds its summary and unreadable-note sentences as English prose,
 *     server-side, for every reader.
 *
 * `PortalPendingCopyNotice` sits at the TOP of the portal so a resident is told
 * before they read any of it. It has to be page-level rather than attached to
 * one region, because this English is not in one region: `framing.summary` is on
 * the submit tab that the portal opens on, `portal.sortBy` is on the feedback
 * tab, and the demographics block is opt-in. Unlabelled English inside an
 * otherwise-Spanish page tells a resident the agency wrote it that way, and
 * under Title VI that is a claim about what the agency published.
 */
const PENDING_PORTAL_TEXT = {
  "portal.cancelReply": "Cancel reply",
  "portal.removePhoto": "Remove photo",
  "portal.shareAnother": "Share another response",
  "portal.sortBy": "Sort by",
  "portal.mapZoomHint": "Zoom to your neighbourhood before dropping a pin.",
  "portal.demographicsAge": "Age range",
  "portal.demographicsZip": "ZIP code",
  "portal.demographicsPrimaryLanguage": "Primary language",
  "portal.demographicsTenure": "Do you rent or own your home?",
  "portal.demographicsRace": "Race / ethnicity",
} as const;

type PendingPortalKey = keyof typeof PENDING_PORTAL_TEXT;

/**
 * An English string the catalog cannot answer for yet. Read the block above
 * before adding one: the element rendering it MUST carry
 * `lang={PORTAL_DEFAULT_LOCALE}`.
 */
function pending(key: PendingPortalKey): string {
  return PENDING_PORTAL_TEXT[key];
}

/**
 * AN API'S OWN REFUSAL, MARKED AS THE ENGLISH IT IS.
 *
 * Every route under `/api/engage/` answers with an English literal — "Photo
 * upload not found or expired. Please re-attach the photo.", "Too many recent
 * submissions from this connection." Those sentences are far more useful to a
 * resident than a generic "submission failed", so the portal prefers them; but
 * they land inside a wrapper that declares the participant's language, and a
 * `lang` that lies is not cosmetic. A screen reader told the page is Farsi
 * pronounces English words with Farsi phonology, and an English sentence with no
 * direction of its own inside a `dir="rtl"` page is laid out from the wrong
 * edge. So the message travels with the two attributes its element must carry.
 *
 * The fallback is a `PortalDisclosureView` from `portalMessageView`, which is
 * OpenPlan's own copy and already knows whether THAT key fell back to English.
 * One shape for both, so the render site never has to ask where a sentence came
 * from.
 */
function serverSentence(raw: unknown, fallback: PortalDisclosureView): PortalDisclosureView {
  const sentence = typeof raw === "string" ? raw.trim() : "";
  return sentence
    ? { sentence, lang: PORTAL_DEFAULT_LOCALE, dir: PORTAL_LOCALE_DIRECTION[PORTAL_DEFAULT_LOCALE] }
    : fallback;
}

function isPortalSentence(value: unknown): value is PortalDisclosureView {
  return typeof value === "object" && value !== null && typeof (value as PortalDisclosureView).sentence === "string";
}

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

type ApprovedItem = {
  id: string;
  categoryId: string | null;
  title: string | null;
  body: string;
  submittedBy: string | null;
  latitude: number | null;
  longitude: number | null;
  geometry?: unknown;
  votesCount?: number;
  parentItemId?: string | null;
  photoUrl?: string | null;
  createdAt: string;
};

export type ApprovedItemGrouping = {
  topLevel: ApprovedItem[];
  repliesByParent: Map<string, ApprovedItem[]>;
};

/**
 * E6 — split approved items into top-level comments and the replies nested under
 * them. A reply whose parent is not itself an approved top-level item (e.g. the
 * parent was un-approved after the reply cleared moderation) is dropped from the
 * public view rather than shown stripped of its context. Replies read oldest-
 * first so a thread flows chronologically. Preserves the caller's ordering of
 * top-level items (the loader sorts newest-first).
 */
export function groupApprovedItems(items: ApprovedItem[]): ApprovedItemGrouping {
  const topLevel = items.filter((item) => !item.parentItemId);
  const topLevelIds = new Set(topLevel.map((item) => item.id));
  const repliesByParent = new Map<string, ApprovedItem[]>();
  for (const item of items) {
    const parentId = item.parentItemId;
    if (!parentId || !topLevelIds.has(parentId)) continue; // top-level or orphaned
    const bucket = repliesByParent.get(parentId);
    if (bucket) bucket.push(item);
    else repliesByParent.set(parentId, [item]);
  }
  for (const bucket of repliesByParent.values()) {
    bucket.sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  }
  return { topLevel, repliesByParent };
}

/**
 * The preview of the comment being replied to. A resident's OWN words, so it is
 * neither OpenPlan copy nor operator text and gets no `lang` — nobody recorded
 * what language a comment was written in, and guessing would mispronounce it.
 */
function replyPreviewLabel(item: ApprovedItem): string {
  const source = item.title?.trim() || item.body.trim();
  return source.length > 60 ? `${source.slice(0, 60)}…` : source;
}

const PHOTO_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];

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
    itself came out in. Nine of the eleven locales have no catalog yet, so on
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

/**
 * The distinct provenance sentences for a set of operator strings, deduplicated,
 * each with the language it is written in.
 *
 * A `<select>` cannot carry a badge on each `<option>`, so the caveat for the
 * topic names has to be said once beneath the control. Deduplicated because ten
 * machine-translated categories are one fact about this campaign, not ten — by
 * SENTENCE, since two categories in the same state produce the same sentence in
 * the same language, and two in different states produce different sentences.
 */
function distinctDisclosures(
  values: Array<PortalText | null>,
  translator: PortalTranslator
): PortalDisclosureView[] {
  const seen = new Map<string, PortalDisclosureView>();
  for (const value of values) {
    if (!value) continue;
    const view = portalTextDisclosureView(value, translator);
    if (view && !seen.has(view.sentence)) seen.set(view.sentence, view);
  }
  return [...seen.values()];
}

/**
 * WHAT THIS PORTAL IS NOT SAYING IN THE PARTICIPANT'S LANGUAGE, said above the
 * English rather than after it.
 *
 * IT COVERS THE WHOLE PORTAL, and the earlier version — scoped to the
 * demographics block — is the defect this note exists to stop coming back. The
 * catalog-shaped gap is reported by `translator.hasFallbacks` and disclosed by
 * `PortalLanguageNotice`. This one covers the gap the catalog knows nothing
 * about: participant copy on this surface that has no catalog key yet, which is
 * every `PENDING_PORTAL_TEXT` entry plus the English prose
 * `resolvePortalMapFraming` builds server-side.
 *
 * That English is NOT confined to one region. `framing.summary` sits on the
 * submit tab — the tab a portal opens on — for every reader of every campaign,
 * `portal.sortBy` sits on the feedback tab, and the demographics block is
 * OPT-IN. Attaching the notice to the demographics section therefore left the
 * ordinary Spanish portal (demographics off, which is the default) rendering
 * undisclosed English on first paint with nothing anywhere on the page saying
 * so. Under Title VI that reads as English the agency chose to publish.
 *
 * SO IT STAYS SILENT WHENEVER THE PAGE-WIDE ONE SPEAKS, which is exactly when
 * `translator.hasFallbacks` is true. `PortalLanguageNotice` renders the SAME
 * sentence from the SAME key on that condition, and a Korean portal used to
 * print it twice — once above the campaign title and once inside the portal —
 * which reads as a bug and teaches a resident to skip both. The remaining case
 * is the one this notice was built for: a COMPLETE catalog like Spanish, where
 * nothing is falling back, the page-wide notice is correctly silent, and parts
 * of this surface are English anyway.
 *
 * A consequence worth naming, because it makes the `lang` below correct rather
 * than lucky: the only locales that reach the return statement are ones whose
 * catalog carries this key, so the sentence really is in `translator.locale`.
 *
 * IT MAY SAY SO SLIGHTLY MORE OFTEN THAN IT MUST — a closed Spanish campaign
 * with no published items and no demographics has no English on screen and
 * still gets the sentence. That direction is deliberate: the sentence is true of
 * the surface either way ("anything not yet translated is shown in English"),
 * and the cost of the other direction is a resident told nothing about English
 * they are actually reading.
 *
 * THE INVARIANT THIS DEPENDS ON: every surface rendering the portal shows the
 * page-wide notice when there are fallbacks. The full public page renders it
 * above the campaign title; a surface with no language chrome of its own gets it
 * from this component (see `renderLanguagePicker`). A third surface that renders
 * the portal and neither is a surface where untranslated copy goes undisclosed.
 */
function PortalPendingCopyNotice({ translator }: { translator: PortalTranslator }) {
  // Nothing to disclose on an English portal: this copy is not missing, it is
  // the source.
  if (translator.locale === PORTAL_DEFAULT_LOCALE) return null;
  if (translator.hasFallbacks) return null;

  return (
    <p
      className="rounded-lg border border-amber-300/70 bg-amber-50/70 px-3 py-2 text-xs text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100"
      lang={translator.bcp47}
      dir={translator.direction}
    >
      {translator.t("language.partialNotice", { language: translator.nativeName })}
    </p>
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

function SubmissionForm({
  shareToken,
  categories,
  demographicsEnabled,
  translator,
  parentItemId = null,
  replyingToLabel = null,
  onCancelReply,
  framing,
  contextLayers = null,
}: {
  shareToken: string;
  categories: CategoryOption[];
  demographicsEnabled: boolean;
  /** The participant's language. Every string below comes through it. */
  translator: PortalTranslator;
  parentItemId?: string | null;
  replyingToLabel?: string | null;
  onCancelReply?: () => void;
  /**
   * Where the map opens AND why — see `resolvePortalMapFraming`. The reason
   * travels with the camera because the form has to say something different
   * when nothing framed the map: a continent shown without comment reads as a
   * study area.
   */
  framing: PortalMapFraming;
  /** The campaign's published GIS context, drawn under the resident's sketch. */
  contextLayers?: ParticipantContextLayerSet | null;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submittedBy, setSubmittedBy] = useState("");
  const [geometry, setGeometry] = useState<EngagementGeometry | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<PortalDisclosureView | null>(null);
  const [website, setWebsite] = useState("");
  // E5a — optional self-reported demographics (only when the campaign opts in).
  const [ageBand, setAgeBand] = useState("");
  const [zip5, setZip5] = useState("");
  const [primaryLanguage, setPrimaryLanguage] = useState("");
  const [raceEthnicity, setRaceEthnicity] = useState<string[]>([]);
  const [householdTenure, setHouseholdTenure] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<PortalDisclosureView | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const { t, bcp47 } = translator;
  // Stated as a size in the participant's locale, and read from the same
  // constant the server enforces — a "5 MB" written into a sentence is both an
  // untranslated unit and a number that silently disagrees the day the limit
  // changes.
  const photoLimit = formatPortalMegabytes(ENGAGEMENT_PHOTO_MAX_BYTES, bcp47);
  const optionalHint = t("survey.optional");
  const topicDisclosures = useMemo(
    () => distinctDisclosures(categories.map((category) => category.labelText), translator),
    [categories, translator]
  );

  useEffect(() => {
    return () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    };
  }, [photoPreviewUrl]);

  function clearPhoto() {
    setPhotoFile(null);
    setPhotoError(null);
    setPhotoPreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return null;
    });
    if (photoInputRef.current) photoInputRef.current.value = "";
  }

  function handlePhotoChange(file: File | null) {
    setPhotoError(null);

    if (!file) {
      clearPhoto();
      return;
    }

    if (!PHOTO_CONTENT_TYPES.includes(file.type)) {
      clearPhoto();
      setPhotoError(portalMessageView(translator, "portal.photoWrongType"));
      return;
    }

    if (file.size > ENGAGEMENT_PHOTO_MAX_BYTES) {
      clearPhoto();
      setPhotoError(
        portalMessageView(translator, "portal.photoTooLarge", { limit: photoLimit })
      );
      return;
    }

    setPhotoFile(file);
    setPhotoPreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return URL.createObjectURL(file);
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      // Two-step photo flow: upload the raw image first, then reference the
      // returned storage path in the submission payload.
      let photoPath: string | undefined;
      if (photoFile) {
        const uploadResponse = await fetch(`/api/engage/${shareToken}/photo-upload`, {
          method: "POST",
          headers: { "content-type": photoFile.type },
          body: photoFile,
        });
        const uploadPayload = (await uploadResponse.json()) as { error?: string; photoPath?: string };
        if (!uploadResponse.ok || !uploadPayload.photoPath) {
          // The API's own message is preferred when it has one: it is specific.
          // It is also English, so it is thrown as a view that says
          // so rather than as a bare string the render site would have to guess
          // about.
          throw serverSentence(uploadPayload.error, portalMessageView(translator, "portal.photoFailed"));
        }
        photoPath = uploadPayload.photoPath;
      }

      const response = await fetch(`/api/engage/${shareToken}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          categoryId: categoryId || undefined,
          parentItemId: parentItemId || undefined,
          title: title || undefined,
          body,
          submittedBy: submittedBy || undefined,
          geometry: geometry ?? undefined,
          photoPath,
          website,
          demographics: demographicsEnabled
            ? {
                ageBand: ageBand || undefined,
                zip5: /^\d{5}$/.test(zip5) ? zip5 : undefined,
                primaryLanguage: primaryLanguage || undefined,
                raceEthnicity: raceEthnicity.length ? raceEthnicity : undefined,
                householdTenure: householdTenure || undefined,
                consented: true,
              }
            : undefined,
        }),
      });

      const payload = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw serverSentence(payload.error, portalMessageView(translator, "portal.submitFailed"));
      }

      setSubmitted(true);
    } catch (failure) {
      // A thrown view already knows its language. Anything else here
      // is a network or parsing fault with no participant-facing wording of its
      // own, so it becomes the translated generic rather than a stack message.
      setError(
        isPortalSentence(failure)
          ? failure
          : portalMessageView(translator, "portal.submitFailed")
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="public-success-state">
        <CheckCircle2 className="mx-auto h-9 w-9 text-[color:var(--pine)]" />
        <h3 className="mt-4 text-xl font-semibold text-foreground">{t("portal.received")}</h3>
        <div className="mt-3 space-y-2 text-sm text-muted-foreground">
          <p>{t("portal.receivedDetail")}</p>
          <p>{t("portal.reviewNotice")}</p>
          <p>{t("portal.followUpHint")}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="mt-5"
          // English until `portal.shareAnother` exists; see PENDING_PORTAL_TEXT.
          lang={PORTAL_DEFAULT_LOCALE}
          onClick={() => {
            setSubmitted(false);
            setCategoryId("");
            setTitle("");
            setBody("");
            setSubmittedBy("");
            setGeometry(null);
            clearPhoto();
            setWebsite("");
            setAgeBand("");
            setZip5("");
            setPrimaryLanguage("");
            setRaceEthnicity([]);
            setHouseholdTenure("");
            setError(null);
            onCancelReply?.();
          }}
        >
          {pending("portal.shareAnother")}
        </Button>
      </div>
    );
  }

  return (
    <form className="public-form-shell" onSubmit={handleSubmit}>
      {replyingToLabel ? (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-[color:var(--pine)]/40 bg-[color:var(--pine)]/5 px-3.5 py-2.5">
          <p className="text-sm text-foreground">
            <span className="font-semibold">{t("portal.replyingTo")}</span>{" "}
            <span className="text-muted-foreground">{replyingToLabel}</span>
          </p>
          {onCancelReply ? (
            <button
              type="button"
              onClick={onCancelReply}
              lang={PORTAL_DEFAULT_LOCALE}
              className="shrink-0 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {pending("portal.cancelReply")}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="public-form-grid">
        <div className="divide-y divide-border/60">
          <section className="public-form-section">
            <div className="public-form-heading">
              <h3 className="public-section-label">{t("portal.yourInput")}</h3>
              <p className="text-sm text-muted-foreground">{t("portal.onlyRequiredField")}</p>
            </div>

            <div className="mt-4 space-y-1.5">
              {/*
                The visible heading above already names this field, so the
                <label> repeats it for assistive technology instead of adding a
                second visible sentence. A textarea with no programmatic label is
                unusable with a screen reader, and this is the one required field
                on the page.
              */}
              <label htmlFor="public-body" className="sr-only">
                {t("portal.yourInput")}
              </label>
              <Textarea
                id="public-body"
                rows={6}
                placeholder={t("portal.yourInputHint")}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                required
                maxLength={4000}
              />
              <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
                {/*
                  Numerals only. A counter needs no word to be understood, and
                  the digits themselves are grouped the way the participant's
                  language groups them.
                */}
                <span>
                  {formatPortalNumber(body.length, bcp47)}/{formatPortalNumber(4000, bcp47)}
                </span>
              </div>
            </div>
          </section>

          <section className="public-form-section">
            <div className="public-form-heading">
              <h3 className="public-section-label">{t("portal.optionalFields")}</h3>
            </div>

            <div className="mt-4 grid gap-4">
              {categories.length > 0 ? (
                <div className="space-y-1.5">
                  <label htmlFor="public-category" className="text-sm font-medium">
                    {t("portal.topics")} <span className="text-xs text-muted-foreground">({optionalHint})</span>
                  </label>
                  <select
                    id="public-category"
                    className={PUBLIC_SELECT_CLASS}
                    value={categoryId}
                    onChange={(event) => setCategoryId(event.target.value)}
                  >
                    <option value="">{t("portal.selectTopic")}</option>
                    {categories.map((category) => (
                      // An <option> cannot carry a badge, so each one carries
                      // the language it is actually in — and its direction,
                      // because an Arabic topic name in a list of English ones
                      // renders its punctuation on the wrong side without it.
                      // The caveat is said once below the control.
                      <option
                        key={category.id}
                        value={category.id}
                        lang={portalTextLang(category.labelText)}
                        dir={PORTAL_LOCALE_DIRECTION[category.labelText.textLocale]}
                      >
                        {category.labelText.text}
                      </option>
                    ))}
                  </select>
                  {topicDisclosures.map((disclosure) => (
                    <p
                      key={disclosure.sentence}
                      className="text-xs leading-snug text-muted-foreground"
                      lang={disclosure.lang}
                      dir={disclosure.dir}
                    >
                      {disclosure.sentence}
                    </p>
                  ))}
                </div>
              ) : null}

              <div className="space-y-1.5">
                <label htmlFor="public-title" className="text-sm font-medium">
                  {t("portal.titleLabel")} <span className="text-xs text-muted-foreground">({optionalHint})</span>
                </label>
                <Input
                  id="public-title"
                  placeholder={t("portal.titleLabel")}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={160}
                />
              </div>

              <div className="space-y-2 pt-1">
                <label className="text-sm font-medium">
                  {t("survey.mapHint")} <span className="text-xs text-muted-foreground">({optionalHint})</span>
                </label>
                {/*
                  Say where the map is, always. When something framed it this
                  names the area so a resident can tell at a glance whether they
                  are looking at their own neighbourhood; when nothing did, the
                  continent is stated as a continent instead of being allowed to
                  pass for the study area.

                  `lang` is English because these sentences are built as English
                  prose by `resolvePortalMapFraming` — a real gap, marked rather
                  than hidden, and disclosed by the notice above the portal.
                */}
                <p className="text-xs text-muted-foreground" lang={PORTAL_DEFAULT_LOCALE}>
                  {framing.summary}
                  {framing.origin === "none" ? ` ${pending("portal.mapZoomHint")}` : null}
                </p>
                {framing.unreadableNote ? (
                  <p className="text-xs text-muted-foreground" lang={PORTAL_DEFAULT_LOCALE}>
                    {framing.unreadableNote}
                  </p>
                ) : null}
                {/*
                  The submission rule, when this campaign has one
                  (20260730000002). Rendered HERE and nowhere else, because this
                  is the one map whose submissions the rule actually governs — a
                  survey `map_point` question is written by a different route
                  that does not check it, and announcing the rule there would
                  claim something nobody enforces. English for the same reason as
                  the two sentences above, and disclosed by the same notice.
                */}
                {framing.submissionRule ? (
                  <p className="text-xs text-muted-foreground" lang={PORTAL_DEFAULT_LOCALE}>
                    {framing.submissionRule}
                  </p>
                ) : null}
                <div className="public-map-frame public-map-frame--editor">
                  <GeometryPickerMap
                    onGeometryChange={setGeometry}
                    contextLayers={contextLayers}
                    {...(framing.view
                      ? { initialCenter: framing.view.center, initialZoom: framing.view.zoom }
                      : {})}
                  />
                </div>
                {geometry ? (
                  <p className="text-xs text-muted-foreground">
                    <MapPinned className="me-1 inline h-3 w-3" aria-hidden="true" />
                    {t("portal.located")}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5 pt-1">
                <label htmlFor="public-photo" className="text-sm font-medium">
                  {t("portal.photoHint", { limit: photoLimit })}{" "}
                  <span className="text-xs text-muted-foreground">({optionalHint})</span>
                </label>
                <input
                  id="public-photo"
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="block w-full text-sm text-muted-foreground file:me-3 file:rounded-lg file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-foreground hover:file:border-primary/50"
                  onChange={(event) => handlePhotoChange(event.target.files?.[0] ?? null)}
                />
                {photoError ? (
                  <p className="text-xs text-destructive" lang={photoError.lang} dir={photoError.dir}>
                    {photoError.sentence}
                  </p>
                ) : null}
                {photoPreviewUrl ? (
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                    <img
                      src={photoPreviewUrl}
                      alt={t("portal.photoPreviewAlt")}
                      className="h-24 w-24 rounded-lg border border-border object-cover"
                    />
                    <button
                      type="button"
                      lang={PORTAL_DEFAULT_LOCALE}
                      className="text-xs font-medium text-destructive hover:underline"
                      onClick={clearPhoto}
                    >
                      {pending("portal.removePhoto")}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <section className="public-form-section">
            <div className="public-form-heading">
              <h3 className="public-section-label">{t("portal.followUp")}</h3>
              <p className="text-sm text-muted-foreground">{t("portal.nameHint")}</p>
            </div>

            <div className="mt-4 space-y-1.5">
              <label htmlFor="public-name" className="text-sm font-medium">
                {t("portal.nameLabel")} <span className="text-xs text-muted-foreground">({optionalHint})</span>
              </label>
              <Input
                id="public-name"
                placeholder={t("portal.nameLabel")}
                value={submittedBy}
                onChange={(event) => setSubmittedBy(event.target.value)}
                maxLength={200}
              />
            </div>
          </section>

          {demographicsEnabled ? (
            /*
              THE ONE BLOCK THAT IS STILL LARGELY ENGLISH, and it is not hidden
              for non-English readers under any circumstances: this is how a
              resident tells the agency they exist, and denying it to the people
              least likely to be counted would invert the entire point of
              collecting it. So it renders, marked `lang="en"` throughout, with
              the coverage notice above the portal saying so.

              `demographicLabel` is shared with the operator console's aggregate
              views, so its option text cannot simply become catalog keys — the
              fix is reported alongside this change.
            */
            <section className="public-form-section">
              <div className="public-form-heading">
                <h3 className="public-section-label">{t("portal.demographics")}</h3>
                <p className="text-sm text-muted-foreground">{t("portal.demographicsHint")}</p>
              </div>

              <div className="mt-4 grid gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="demo-age" className="text-sm font-medium" lang={PORTAL_DEFAULT_LOCALE}>
                    {pending("portal.demographicsAge")}{" "}
                    <span className="text-xs text-muted-foreground" lang={bcp47}>
                      ({optionalHint})
                    </span>
                  </label>
                  <select id="demo-age" className={PUBLIC_SELECT_CLASS} value={ageBand} onChange={(event) => setAgeBand(event.target.value)}>
                    <option value="" lang={bcp47}>
                      {t("portal.preferNotToSay")}
                    </option>
                    {AGE_BANDS.filter((band) => band !== "prefer_not_to_say").map((band) => (
                      <option key={band} value={band} lang={PORTAL_DEFAULT_LOCALE}>
                        {demographicLabel(band)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="demo-zip" className="text-sm font-medium" lang={PORTAL_DEFAULT_LOCALE}>
                    {pending("portal.demographicsZip")}{" "}
                    <span className="text-xs text-muted-foreground" lang={bcp47}>
                      ({optionalHint})
                    </span>
                  </label>
                  <Input
                    id="demo-zip"
                    inputMode="numeric"
                    value={zip5}
                    onChange={(event) => setZip5(event.target.value.replace(/\D/g, "").slice(0, 5))}
                    maxLength={5}
                  />
                  <p className="text-xs text-muted-foreground">{t("portal.zipHint")}</p>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="demo-language" className="text-sm font-medium" lang={PORTAL_DEFAULT_LOCALE}>
                    {pending("portal.demographicsPrimaryLanguage")}{" "}
                    <span className="text-xs text-muted-foreground" lang={bcp47}>
                      ({optionalHint})
                    </span>
                  </label>
                  <select id="demo-language" className={PUBLIC_SELECT_CLASS} value={primaryLanguage} onChange={(event) => setPrimaryLanguage(event.target.value)}>
                    <option value="" lang={bcp47}>
                      {t("portal.preferNotToSay")}
                    </option>
                    {LANGUAGES.filter((language) => language !== "prefer_not_to_say").map((language) => (
                      <option key={language} value={language} lang={PORTAL_DEFAULT_LOCALE}>
                        {demographicLabel(language)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="demo-tenure" className="text-sm font-medium" lang={PORTAL_DEFAULT_LOCALE}>
                    {pending("portal.demographicsTenure")}{" "}
                    <span className="text-xs text-muted-foreground" lang={bcp47}>
                      ({optionalHint})
                    </span>
                  </label>
                  <select id="demo-tenure" className={PUBLIC_SELECT_CLASS} value={householdTenure} onChange={(event) => setHouseholdTenure(event.target.value)}>
                    <option value="" lang={bcp47}>
                      {t("portal.preferNotToSay")}
                    </option>
                    {HOUSEHOLD_TENURE.filter((tenure) => tenure !== "prefer_not_to_say").map((tenure) => (
                      <option key={tenure} value={tenure} lang={PORTAL_DEFAULT_LOCALE}>
                        {demographicLabel(tenure)}
                      </option>
                    ))}
                  </select>
                </div>

                <fieldset className="space-y-1.5">
                  <legend className="text-sm font-medium" lang={PORTAL_DEFAULT_LOCALE}>
                    {pending("portal.demographicsRace")}{" "}
                    <span className="text-xs text-muted-foreground" lang={bcp47}>
                      ({optionalHint})
                    </span>
                  </legend>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {RACE_ETHNICITY.filter((race) => race !== "prefer_not_to_say").map((race) => (
                      <label key={race} className="flex items-center gap-2 text-sm text-muted-foreground">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-input"
                          checked={raceEthnicity.includes(race)}
                          onChange={(event) =>
                            setRaceEthnicity((previous) =>
                              event.target.checked ? [...previous, race] : previous.filter((value) => value !== race)
                            )
                          }
                        />
                        <span lang={PORTAL_DEFAULT_LOCALE}>{demographicLabel(race)}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            </section>
          ) : null}
        </div>

        <aside className="public-form-rail">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Info className="h-4 w-4 text-[color:var(--accent)]" aria-hidden="true" />
              {t("portal.whatHappensNext")}
            </h3>
            <ul className="public-bullet-list public-bullet-list--compact mt-3 text-sm text-muted-foreground">
              <li>{t("portal.onlyRequiredField")}</li>
              <li>{t("portal.reviewNotice")}</li>
              <li>{t("portal.followUpHint")}</li>
            </ul>
          </div>
        </aside>
      </div>

      <div className="public-form-footer">
        {error ? (
          /*
            THE MOMENT A RESIDENT IS MOST LIKELY TO GIVE UP, so the sentence they
            meet is marked with the language it is in. An API refusal is English
            on every route under `/api/engage/`; declaring it as the page's
            language would have a screen reader read it with the wrong phonology
            and, on an Arabic or Farsi portal, lay it out from the wrong edge.
          */
          <p
            className="mb-4 rounded-xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
            lang={error.lang}
            dir={error.dir}
          >
            {error.sentence}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{t("page.submissionStatusDetail")}</p>
          <Button type="submit" disabled={isSubmitting} className="min-w-[13rem] justify-center">
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {isSubmitting ? t("portal.submitting") : t("portal.submit")}
          </Button>
        </div>
      </div>

      {/*
        Honeypot. Deliberately NOT translated and deliberately not in the
        catalog: it is aria-hidden and off-screen, no participant or screen
        reader ever meets it, and a bot is the only reader. `-start-` rather than
        `-left-` so it hides off the correct edge in a right-to-left page — with
        `-left-` on an RTL portal it lands in the middle of the layout.
      */}
      <div className="absolute -start-[9999px] opacity-0" aria-hidden="true">
        <label htmlFor="public-website">Website</label>
        <input
          id="public-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>
    </form>
  );
}

export function PublicEngagementPortal({
  shareToken,
  acceptingSubmissions,
  categories,
  approvedItems,
  readFailures = { comments: false, categories: false },
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
  readFailures?: { comments: boolean; categories: boolean };
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
   * language and not the other ten.
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
}) {
  const hasSurvey = surveyQuestions.length > 0;
  const hasCloseLoop = closeLoopEntries.length > 0;
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
              {/* The participant's locale, not the server's: most of the eleven
                  languages read 3/7/2026 as a different day than en-US does. */}
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
            disabled={supported}
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
      {readFailures.comments || readFailures.categories ? (
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
                count={closeLoopEntries.length}
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

                <SubmissionForm
                  framing={framing}
                  contextLayers={contextLayers}
                  shareToken={shareToken}
                  categories={categories}
                  translator={translator}
                  demographicsEnabled={demographicsEnabled}
                  parentItemId={replyTarget?.id ?? null}
                  replyingToLabel={replyTarget?.label ?? null}
                  onCancelReply={replyTarget ? () => setReplyTarget(null) : undefined}
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
                <PublicSurveyForm shareToken={shareToken} questions={surveyQuestions} messages={messages} />
              ) : (
                <div className="public-success-state">
                  <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
                  <h3 className="mt-4 text-lg font-semibold text-foreground">{t("survey.closed")}</h3>
                </div>
              )
            ) : null}

            {activeTab === "closeloop" && hasCloseLoop ? (
              <PublicCloseLoop entries={closeLoopEntries} translator={translator} />
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
                        <span lang={PORTAL_DEFAULT_LOCALE}>{pending("portal.sortBy")}</span>
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
              <PublicSubscribeForm shareToken={shareToken} />
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
