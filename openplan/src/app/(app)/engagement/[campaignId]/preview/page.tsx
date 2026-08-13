import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Eye } from "lucide-react";
import { PublicMapShell } from "@/components/engagement/public-map-shell";
import { PortalAccessibilityNotice } from "@/components/engagement/portal-accessibility-notice";
import {
  PortalLanguageNotice,
  PortalLanguagePicker,
} from "@/components/engagement/portal-language-picker";
import { StateBlock } from "@/components/ui/state-block";
import { createClient } from "@/lib/supabase/server";
import { loadPortalPreviewResult } from "@/lib/engagement/public-portal-data";
import { getPublicPortalState } from "@/lib/engagement/public-portal";
import { createPortalTranslator } from "@/lib/engagement/portal-i18n/translator";
import { buildPortalMapShellProps } from "@/lib/engagement/portal-surface-props";
import { PORTAL_LOCALE_QUERY_PARAM } from "@/lib/engagement/portal-i18n/locales";
import {
  portalRequestedLocale,
  portalSearchString,
  type PortalSearchParams,
} from "@/lib/engagement/portal-search-params";

/**
 * OPERATOR PREVIEW of the resident portal — the same surface residents get, for
 * a campaign in ANY state including draft.
 *
 * Until this page existed, the only way to see what residents would get was to
 * make the campaign active and open the public link — which means the first
 * time an operator reads their own consultation as a resident is after
 * residents already can. This page closes that: it is member-gated
 * (`loadPortalPreviewResult` checks workspace membership + `engagement.read`
 * against the service-role read it performs), and `previewMode` disables every
 * submission surface so nothing an operator does here can write to their own
 * public record.
 *
 * ================================ IT RENDERS WHAT RESIDENTS GET, MECHANICALLY
 *
 * This page's own docstring used to say it rendered the real component "rather
 * than a mockup that could drift from it" — and then it drifted anyway: the
 * public route moved to the map-first shell and this one kept rendering the
 * page it replaced, so an operator previewed a surface no resident could reach.
 * A promise in a comment did not survive one redesign.
 *
 * What replaced the promise is a mechanism: BOTH routes build their props with
 * `buildPortalMapShellProps` and render `PublicMapShell`, and
 * `portal-preview-renders-the-resident-surface.test.tsx` derives the component
 * from the PUBLIC route's source and fails if this one names a different thing.
 *
 * THE PUBLIC PATH IS UNTOUCHED: residents still reach a portal only through
 * `share_token` + `status = 'active'`. This page never widens that door — it is
 * a different door with a badge reader on it.
 */
export default async function EngagementPortalPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ campaignId: string }>;
  searchParams?: Promise<PortalSearchParams>;
}) {
  const { campaignId } = await params;
  const resolvedSearch = searchParams ? await searchParams : undefined;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  /*
    THE LANGUAGE THE PREVIEW IS IN comes off the URL exactly as it does on the
    public route. Without it an operator could not check their own Spanish
    portal before publishing it — which is the review this page exists for, and
    the one they cannot do any other way on a draft.
  */
  const result = await loadPortalPreviewResult(
    campaignId,
    user.id,
    { requestedLocale: portalRequestedLocale(resolvedSearch, PORTAL_LOCALE_QUERY_PARAM) }
  );

  // "Not found" and "not your workspace" are one answer on purpose — a 404
  // that varies by membership would confirm which campaign ids exist.
  if (result.status === "denied") {
    notFound();
  }

  // A FAILED READ IS NOT A MISSING CAMPAIGN — same rule the campaign console
  // follows. Saying so here matters because the next move after a false 404 is
  // often re-creating a campaign whose comments are still being collected.
  if (result.status === "unreadable") {
    return (
      <section className="module-page">
        <div className="mx-auto w-full max-w-2xl">
          <StateBlock
            tone="danger"
            title="This preview could not be loaded"
            description={`The database refused a read this preview needs: ${result.error.message}. That is not the same as the campaign not existing — OpenPlan cannot tell you either way right now.`}
          />
          <p className="mt-4 text-sm">
            <Link
              href={`/engagement/${campaignId}`}
              className="underline underline-offset-2 hover:text-foreground"
            >
              Back to the campaign console
            </Link>
          </p>
        </div>
      </section>
    );
  }

  const { campaign, campaignText, locale, messages } = result.bundle;
  const translator = createPortalTranslator(messages);
  const portalState = getPublicPortalState(campaign);
  const shellProps = buildPortalMapShellProps(result.bundle);
  const search = portalSearchString(resolvedSearch);
  const previewAboutHref = search
    ? `/engagement/${campaignId}/preview/about?${search}`
    : `/engagement/${campaignId}/preview/about`;

  return (
    <section className="module-page">
      {/*
        The banner says which of two different facts is true, because they are
        different: a draft or staged campaign is invisible to residents, while
        an active one is already live — and telling an operator "residents
        cannot see this yet" about a live portal would be false on the one
        surface built to show them the truth.
      */}
      <div className="mb-4 rounded-xl border border-amber-300/70 bg-amber-50/80 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/30">
        <p className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
          <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
          {portalState.isPubliclyReachable
            ? "Preview — this campaign is live, so residents can already see this page at its public link. Submissions are turned off in this preview: nothing you do here reaches the public record."
            : "Preview — residents cannot see this yet. This is what they will get when the campaign goes active. Submissions are turned off in this preview."}
        </p>
        <p className="mt-1 text-xs text-amber-800/90 dark:text-amber-300/80">
          Portal status: {portalState.label}. {portalState.detail}
        </p>
      </div>

      <div className="mb-4">
        <Link
          href={`/engagement/${campaignId}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to the campaign console
        </Link>
      </div>

      {/*
        The campaign's own title is NOT repeated here. The resident surface below
        renders it as the page's `h1`, and a second copy above it would be a
        heading an operator sees and a resident never does — which is the one
        thing a preview must not have.

        `dir`/`lang` travel with the surface the same way the public route sets
        them: on the participant surface's own wrapper, never on the app shell,
        which is shared with the untranslated operator console.
      */}
      <div
        dir={locale.direction}
        lang={locale.bcp47}
        className="overflow-hidden rounded-xl border border-border/60"
        data-testid="portal-preview-surface"
      >
        <PublicMapShell
          {...shellProps}
          /*
            THE ONE DOOR LEADS SOMEWHERE AN OPERATOR CAN ACTUALLY GO. It cannot
            point at `/engage/<token>/about`: a draft campaign has no reachable
            public page, so the preview's only way onward would 404 on exactly
            the campaigns this page exists for. It points at the preview's own
            copy of that page, which renders the same component the public one
            does.
          */
          detailsHref={previewAboutHref}
          languageChrome={
            <div className="flex flex-col gap-2">
              <PortalLanguagePicker
                locale={locale}
                messages={messages}
                pathname={`/engagement/${campaignId}/preview`}
                search={search}
              />
              <PortalLanguageNotice locale={locale} messages={messages} />
            </div>
          }
          accessibilityNotice={
            <PortalAccessibilityNotice
              contactLabel={campaignText.accessibilityContactLabel}
              alternateFormats={campaignText.accessibilityAlternateFormats}
              email={campaign.accessibility_contact_email}
              phone={campaign.accessibility_contact_phone}
              translator={translator}
            />
          }

          previewMode
        />
      </div>
    </section>
  );
}
