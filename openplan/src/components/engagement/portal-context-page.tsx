import { ArrowLeft, Clock3, MessageSquareText, ShieldCheck } from "lucide-react";
import { PublicEngagementPortal } from "@/components/engagement/public-engagement-portal";
import {
  PortalLanguageNotice,
  PortalLanguagePicker,
} from "@/components/engagement/portal-language-picker";
import { PortalOperatorText } from "@/components/engagement/portal-operator-text";
import { PortalAccessibilityNotice } from "@/components/engagement/portal-accessibility-notice";
import type { PublicPortalBundle } from "@/lib/engagement/public-portal-data";
import { createPortalTranslator } from "@/lib/engagement/portal-i18n/translator";
import { formatPortalDateTime, formatPortalNumber } from "@/lib/engagement/portal-i18n/format";
import type { PortalMessageKey } from "@/lib/engagement/portal-i18n/messages";
import type { EngagementType } from "@/lib/engagement/catalog";

type EngagementModeKey = Extract<PortalMessageKey, `engagementType.${string}`>;

/**
 * SPELLED OUT rather than built with a template literal and a cast, because the
 * cast was load-bearing and could not see a gap. `engagementType.${value} as
 * EngagementModeKey` compiles for any member of `ENGAGEMENT_TYPES`, including a
 * fourth one added later whose catalog key nobody wrote — and `t()` on a key the
 * bundle does not carry returns undefined, which arrives on a public page as the
 * literal word "undefined" inside "Mode: …". A `Record` over `EngagementType`
 * makes both halves of that a build error instead.
 */
const ENGAGEMENT_MODE_KEYS: Record<EngagementType, EngagementModeKey> = {
  map_feedback: "engagementType.map_feedback",
  comment_collection: "engagementType.comment_collection",
  meeting_intake: "engagementType.meeting_intake",
};

function engagementModeKey(value: string): EngagementModeKey | null {
  return (ENGAGEMENT_MODE_KEYS as Record<string, EngagementModeKey | undefined>)[value] ?? null;
}

/**
 * EVERYTHING THE MAP IS NOT — one real link away from it.
 *
 * The hero, the three facts, the moderation posture, the four tabs (the classic
 * submission form, the survey, the community feed with its per-comment
 * translation and support votes, the close-the-loop record), the topic
 * descriptions, the email subscription and the accessibility contact. This is
 * the page that used to live at `/engage/<token>`, unchanged apart from the way
 * back to the map at the top.
 *
 * IT IS ALSO THE NO-JAVASCRIPT FALLBACK. The map needs JavaScript; the `<form>`
 * inside `PublicEngagementPortal` does not, and the link that reaches it is a
 * plain anchor. A resident whose phone never runs the bundle still meets a
 * complete way to take part.
 *
 * ================ WHY IT IS A COMPONENT AND NOT THE BODY OF THE ROUTE
 *
 * Two doors lead here: the public `/engage/<token>/about` and the operator
 * preview's own context page. The whole value of a preview is that it is the
 * same page; a second copy of this markup would be a second page that drifts,
 * which is exactly what happened to the map surface before
 * `buildPortalMapShellProps` existed. The two routes differ only in where the
 * "back" link and the language links point, so those are props.
 */
export function PortalContextPage({
  bundle,
  backHref,
  languagePickerPathname,
  languagePickerSearch,
  previewMode = false,
}: {
  bundle: PublicPortalBundle;
  /** Back to the map — the public route, or the preview's own map surface. */
  backHref: string;
  /** Where the `?lang=` links point. Route-relative, so it cannot be derived here. */
  languagePickerPathname: string;
  languagePickerSearch: string;
  /** Preview only: every submission control is inert and writes nothing. */
  previewMode?: boolean;
}) {
  const { campaign, project, acceptingSubmissions, campaignText, locale, messages, portalProps } =
    bundle;
  const translator = createPortalTranslator(messages);
  const modeKey = engagementModeKey(campaign.engagement_type);
  const modeLabel = modeKey ? translator.t(modeKey) : campaign.engagement_type.replaceAll("_", " ");

  return (
    // `dir` is the whole reason the right-to-left languages are usable here
    // rather than merely present in a list. It sits on the participant
    // surface's own wrapper, not on the app shell.
    <section
      className="public-page mx-auto w-full max-w-[72rem] px-4 py-8 sm:px-6"
      dir={locale.direction}
      lang={locale.bcp47}
      data-testid="portal-context-page"
    >
      <div className="public-page-backdrop" />

      {/* A real anchor, first in the document: the way back must work before
          hydration and must be the first thing a screen reader reaches. */}
      <a
        href={backHref}
        data-testid="portal-back-to-map"
        className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {translator.t("portal.backToMap")}
      </a>

      <div className="mt-4 flex flex-col gap-2">
        <PortalLanguagePicker
          locale={locale}
          messages={messages}
          pathname={languagePickerPathname}
          search={languagePickerSearch}
        />
        <PortalLanguageNotice locale={locale} messages={messages} />
      </div>

      <div className="public-hero-grid">
        <article className="public-hero">
          <p className="public-kicker">
            <MessageSquareText className="h-3.5 w-3.5" />
            {translator.t("page.kicker")}
          </p>

          <div className="public-meta-strip">
            {project ? (
              <span>{translator.t("page.linkedProject", { project: project.name })}</span>
            ) : (
              <span>{translator.t("page.standalone")}</span>
            )}
            <span>{translator.t("page.shareLane")}</span>
            <span>{translator.t("page.mode", { mode: modeLabel })}</span>
          </div>

          <div className="public-headline-block">
            <PortalOperatorText as="h1" className="public-title" value={campaignText.title} translator={translator} />
            {campaignText.publicDescription ? (
              <PortalOperatorText
                className="public-lead max-w-4xl"
                value={campaignText.publicDescription}
                translator={translator}
              />
            ) : campaignText.summary ? (
              <PortalOperatorText
                className="public-lead max-w-4xl"
                value={campaignText.summary}
                translator={translator}
              />
            ) : null}
          </div>

          {project ? (
            <div className="public-context-strip">
              <p className="public-section-label">{translator.t("page.supports")}</p>
              <p className="public-context-title">{project.name}</p>
              {project.summary ? <p className="public-context-copy">{project.summary}</p> : null}
            </div>
          ) : null}

          <div className="public-fact-grid public-fact-grid--three">
            <div className="public-fact">
              <p className="public-fact-label">{translator.t("page.submissionStatus")}</p>
              <p className="public-fact-value">
                {acceptingSubmissions
                  ? translator.t("page.submissionsOpen")
                  : translator.t("page.submissionsClosed")}
              </p>
              <p className="public-fact-detail">{translator.t("page.submissionStatusDetail")}</p>
            </div>
            <div className="public-fact">
              <p className="public-fact-label">{translator.t("page.publishedFeedback")}</p>
              {/*
                A COUNT IS A CLAIM, and this is the one this portal can least
                afford to get wrong: "0 published feedback" tells a resident
                nobody spoke. When the comment read failed, `approvedItems` is
                empty for a reason that has nothing to do with what residents
                submitted, so no number is printed at all. An em dash rather than
                a translated phrase: it reads as "not available" in every locale
                this portal serves, and a new English-only key would flip the
                bundle's fallback flag and put a "not fully translated" notice on
                every non-English portal.
              */}
              <p className="public-fact-value">
                {portalProps.readFailures?.comments
                  ? "—"
                  : formatPortalNumber(portalProps.approvedItems.length, locale.bcp47)}
              </p>
              <p className="public-fact-detail">{translator.t("page.publishedFeedbackDetail")}</p>
            </div>
            <div className="public-fact">
              <p className="public-fact-label">{translator.t("page.engagementMode")}</p>
              <p className="public-fact-value">{modeLabel}</p>
              <p className="public-fact-detail">{translator.t("page.engagementModeDetail")}</p>
            </div>
          </div>
        </article>

        <article className="public-rail">
          <div className="flex items-center gap-3">
            <span className="public-rail-icon">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="public-rail-kicker">{translator.t("page.posture")}</p>
              <h2 className="public-rail-title">{translator.t("page.postureTitle")}</h2>
            </div>
          </div>
          <p className="public-rail-copy">{translator.t("page.postureCopy")}</p>
          <div className="public-rail-list">
            <div className="public-rail-item">{translator.t("page.postureItemReview")}</div>
            <div className="public-rail-item">{translator.t("page.postureItemApproved")}</div>
            <div className="public-rail-item">{translator.t("page.postureItemLocation")}</div>
          </div>
          <div className="public-rail-meta">
            <Clock3 className="h-4 w-4" />
            <span>
              {translator.t("page.lastUpdated", {
                timestamp: formatPortalDateTime(campaign.updated_at, locale.bcp47),
              })}
            </span>
          </div>
        </article>
      </div>

      <PublicEngagementPortal {...portalProps} previewMode={previewMode} />

      {/*
        AFTER the portal, not before it: a resident who can use the page should
        meet the consultation first. A resident who cannot has a screen reader
        or a keyboard, and reaches a landmark at the end of the document far more
        reliably than they scroll past an offer they did not need.
      */}
      <PortalAccessibilityNotice
        contactLabel={campaignText.accessibilityContactLabel}
        alternateFormats={campaignText.accessibilityAlternateFormats}
        email={campaign.accessibility_contact_email}
        phone={campaign.accessibility_contact_phone}
        translator={translator}
      />
    </section>
  );
}
