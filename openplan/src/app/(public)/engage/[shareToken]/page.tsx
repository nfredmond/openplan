import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Clock3, MessageSquareText, ShieldCheck } from "lucide-react";
import { PublicEngagementPortal } from "@/components/engagement/public-engagement-portal";
import {
  PortalLanguageNotice,
  PortalLanguagePicker,
} from "@/components/engagement/portal-language-picker";
import { PortalOperatorText } from "@/components/engagement/portal-operator-text";
import { loadPublicPortalBundle } from "@/lib/engagement/public-portal-data";
import { PORTAL_LOCALE_QUERY_PARAM } from "@/lib/engagement/portal-i18n/locales";
import { createPortalTranslator } from "@/lib/engagement/portal-i18n/translator";
import { formatPortalDateTime, formatPortalNumber } from "@/lib/engagement/portal-i18n/format";
import type { PortalMessageKey } from "@/lib/engagement/portal-i18n/messages";
import type { EngagementType } from "@/lib/engagement/catalog";

type PageSearchParams = Record<string, string | string[] | undefined>;

/**
 * The explicit language choice, out of the URL.
 *
 * A repeated `?lang=` (which a hand-edited or double-appended URL produces)
 * yields an array; the first entry wins rather than the request being refused.
 * A public link that somebody mangled must still open the consultation.
 */
function requestedLocaleFrom(searchParams: PageSearchParams | undefined): string | null {
  const raw = searchParams?.[PORTAL_LOCALE_QUERY_PARAM];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return typeof raw === "string" ? raw : null;
}

/**
 * The query string as the participant sees it, so the language picker's links
 * preserve everything else that was on the URL.
 */
function searchStringFrom(searchParams: PageSearchParams | undefined): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, entry);
    } else if (typeof value === "string") {
      params.set(key, value);
    }
  }
  return params.toString();
}

/**
 * A campaign's engagement mode in the participant's language.
 *
 * The stored value is an internal enum, and the old `replaceAll("_", " ")`
 * rendered it as English words to every reader in every language. Keys exist
 * for the three modes `ENGAGEMENT_TYPES` declares; a value outside that set
 * (which only a hand-written database row can produce) falls back to the
 * de-underscored form rather than to a blank.
 */
type EngagementModeKey = Extract<PortalMessageKey, `engagementType.${string}`>;

/**
 * SPELLED OUT rather than built with a template literal and a cast, because the
 * cast was load-bearing and could not see a gap. `engagementType.${value} as
 * EngagementModeKey` compiles for any member of `ENGAGEMENT_TYPES`, including a
 * fourth one added later whose catalog key nobody wrote — and `t()` on a key the
 * bundle does not carry returns undefined, which arrives on a public page as the
 * literal word "undefined" inside "Mode: …". A `Record` over `EngagementType`
 * makes both halves of that a build error instead: a new mode with no key, and a
 * key that no longer exists.
 */
const ENGAGEMENT_MODE_KEYS: Record<EngagementType, EngagementModeKey> = {
  map_feedback: "engagementType.map_feedback",
  comment_collection: "engagementType.comment_collection",
  meeting_intake: "engagementType.meeting_intake",
};

function engagementModeKey(value: string): EngagementModeKey | null {
  return (ENGAGEMENT_MODE_KEYS as Record<string, EngagementModeKey | undefined>)[value] ?? null;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ shareToken: string }>;
  searchParams?: Promise<PageSearchParams>;
}): Promise<Metadata> {
  const { shareToken } = await params;
  const resolvedSearch = searchParams ? await searchParams : undefined;
  const bundle = await loadPublicPortalBundle(shareToken, {
    requestedLocale: requestedLocaleFrom(resolvedSearch),
  });

  if (!bundle) {
    return { title: "Engagement portal", robots: { index: false, follow: false } };
  }

  const translator = createPortalTranslator(bundle.messages);

  // The title and description a link preview shows are participant-facing text
  // like any other. They come from the resolved campaign text rather than the
  // raw row, so a Spanish link posted to a community group previews in Spanish
  // when the agency has published a Spanish title.
  const title = bundle.campaignText.title.text || "Community engagement";
  const description =
    bundle.campaignText.summary?.text.trim() || translator.t("page.defaultDescription");

  // The canonical URL KEEPS the language. Dropping it would tell a crawler —
  // and any tool that follows canonicals — that the Spanish portal and the
  // English one are the same page, which is exactly the claim this feature
  // exists to stop making.
  const canonical =
    bundle.locale.source === "url"
      ? `/engage/${shareToken}?${PORTAL_LOCALE_QUERY_PARAM}=${bundle.locale.locale}`
      : `/engage/${shareToken}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "website",
      locale: bundle.locale.bcp47,
    },
    robots: { index: false, follow: false },
  };
}

export default async function PublicEngagementPage({
  params,
  searchParams,
}: {
  params: Promise<{ shareToken: string }>;
  searchParams?: Promise<PageSearchParams>;
}) {
  const { shareToken } = await params;
  const resolvedSearch = searchParams ? await searchParams : undefined;

  const bundle = await loadPublicPortalBundle(shareToken, {
    requestedLocale: requestedLocaleFrom(resolvedSearch),
  });
  if (!bundle) {
    notFound();
  }

  const { campaign, project, acceptingSubmissions, campaignText, locale, messages, portalProps } = bundle;
  const translator = createPortalTranslator(messages);
  const modeKey = engagementModeKey(campaign.engagement_type);
  const modeLabel = modeKey ? translator.t(modeKey) : campaign.engagement_type.replaceAll("_", " ");

  return (
    // `dir` is the whole reason Arabic and Farsi are usable here rather than
    // merely present in a list. It sits on the participant surface's own
    // wrapper, not on the app shell: this is a public route and the shell is
    // shared with the operator console, which is not translated and must not
    // flip. `lang` travels with it so assistive technology reads the page as
    // what it is.
    <section className="public-page" dir={locale.direction} lang={locale.bcp47}>
      <div className="public-page-backdrop" />

      <div className="flex flex-col gap-2">
        <PortalLanguagePicker
          locale={locale}
          messages={messages}
          pathname={`/engage/${shareToken}`}
          search={searchStringFrom(resolvedSearch)}
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
              {/* Formatted, not concatenated: the languages in this list do not
                  agree on thousands separators, and a count is a number a
                  resident reads. */}
              <p className="public-fact-value">
                {formatPortalNumber(portalProps.approvedItems.length, locale.bcp47)}
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
                // `Intl` in the participant's locale, not the server's. The old
                // bare `toLocaleString()` rendered every date in en-US for
                // every reader, which for most of this language list names a
                // different day than the one intended.
                timestamp: formatPortalDateTime(campaign.updated_at, locale.bcp47),
              })}
            </span>
          </div>
        </article>
      </div>

      <PublicEngagementPortal {...portalProps} />
    </section>
  );
}
