import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Eye } from "lucide-react";
import { PortalContextPage } from "@/components/engagement/portal-context-page";
import { StateBlock } from "@/components/ui/state-block";
import { createClient } from "@/lib/supabase/server";
import { loadPortalPreviewResult } from "@/lib/engagement/public-portal-data";
import { PORTAL_LOCALE_QUERY_PARAM } from "@/lib/engagement/portal-i18n/locales";
import {
  portalRequestedLocale,
  portalSearchString,
  type PortalSearchParams,
} from "@/lib/engagement/portal-search-params";

/**
 * THE OTHER HALF OF THE OPERATOR PREVIEW — what is behind the resident
 * surface's one door.
 *
 * WHY IT EXISTS AT ALL. The map-first surface offers residents exactly one way
 * onward, and on the public side it goes to `/engage/<token>/about`. A preview
 * cannot send an operator there: a DRAFT campaign has no reachable public page,
 * so the only link on the preview would 404 on precisely the campaigns the
 * preview was built for. This route is that door's other side, behind the same
 * membership gate, rendering the same `PortalContextPage` the public route
 * renders — not a second copy of it.
 *
 * Every submission control is inert (`previewMode`): the survey, the comment
 * form, the vote buttons and the email subscription all write nothing, so an
 * operator reading their own consultation cannot put a row in their own public
 * record.
 */
export default async function EngagementPortalPreviewAboutPage({
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

  const result = await loadPortalPreviewResult(campaignId, user.id, {
    requestedLocale: portalRequestedLocale(resolvedSearch, PORTAL_LOCALE_QUERY_PARAM),
  });

  // Same answer for "no such campaign" and "not your workspace", for the same
  // reason the map preview gives it: a 404 that varies by membership confirms
  // which campaign ids exist.
  if (result.status === "denied") {
    notFound();
  }

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

  const search = portalSearchString(resolvedSearch);
  const mapHref = search
    ? `/engagement/${campaignId}/preview?${search}`
    : `/engagement/${campaignId}/preview`;

  return (
    <section className="module-page">
      <div className="mb-4 rounded-xl border border-amber-300/70 bg-amber-50/80 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/30">
        <p className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
          <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
          Preview — this is the page behind the one link on the resident&apos;s map. Submissions,
          votes and sign-ups are turned off here: nothing you do reaches the public record.
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

      <PortalContextPage
        bundle={result.bundle}
        backHref={mapHref}
        languagePickerPathname={`/engagement/${campaignId}/preview/about`}
        languagePickerSearch={search}
        previewMode
      />
    </section>
  );
}
