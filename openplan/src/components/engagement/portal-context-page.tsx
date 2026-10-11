import { ArrowLeft } from "lucide-react";
import { PublicEngagementPortal } from "@/components/engagement/public-engagement-portal";
import {
  PortalLanguageNotice,
  PortalLanguagePicker,
} from "@/components/engagement/portal-language-picker";
import { PortalOperatorText } from "@/components/engagement/portal-operator-text";
import { PortalAccessibilityNotice } from "@/components/engagement/portal-accessibility-notice";
import type { PublicPortalBundle } from "@/lib/engagement/public-portal-data";
import { createPortalTranslator } from "@/lib/engagement/portal-i18n/translator";

/**
 * EVERYTHING THE MAP IS NOT — one real link away from it.
 *
 * The title block, the four tabs (the classic
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

      {/*
        A TITLE BLOCK, NOT A DASHBOARD. This used to be a hero with a kicker, a
        meta strip, a project summary, three fact tiles and a posture card with
        three bullets, all before the first comment. A resident needs the
        project's name, what it is about, whether it is open, and the promise
        that the team reads comments before they appear.
      */}
      <header className="mt-6 max-w-3xl space-y-2" data-testid="portal-context-header">
        {project ? <p className="text-sm font-medium text-muted-foreground">{project.name}</p> : null}
        <PortalOperatorText
          as="h1"
          className="text-2xl font-semibold leading-tight text-foreground sm:text-3xl"
          value={campaignText.title}
          translator={translator}
        />
        {campaignText.publicDescription ?? campaignText.summary ? (
          <PortalOperatorText
            className="text-base leading-relaxed text-muted-foreground"
            value={(campaignText.publicDescription ?? campaignText.summary)!}
            translator={translator}
          />
        ) : null}
        {/* The door to this page says "About this project", so the project is described here. */}
        {project?.summary ? <p className="text-sm leading-relaxed text-muted-foreground">{project.summary}</p> : null}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-sm text-muted-foreground">
          <span
            className={
              acceptingSubmissions
                ? "rounded-full bg-[color:var(--pine)]/15 px-2.5 py-0.5 text-xs font-semibold text-foreground"
                : "rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground"
            }
          >
            {acceptingSubmissions ? translator.t("page.submissionsOpen") : translator.t("page.submissionsClosed")}
          </span>
          <span>{translator.t("page.submissionStatusDetail")}</span>
        </p>
      </header>

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
