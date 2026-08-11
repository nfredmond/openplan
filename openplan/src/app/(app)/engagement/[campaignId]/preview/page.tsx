import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Eye } from "lucide-react";
import { PublicEngagementPortal } from "@/components/engagement/public-engagement-portal";
import { PortalOperatorText } from "@/components/engagement/portal-operator-text";
import { StateBlock } from "@/components/ui/state-block";
import { createClient } from "@/lib/supabase/server";
import { loadPortalPreviewResult } from "@/lib/engagement/public-portal-data";
import { getPublicPortalState } from "@/lib/engagement/public-portal";
import { createPortalTranslator } from "@/lib/engagement/portal-i18n/translator";

/**
 * OPERATOR PREVIEW of the resident portal — the same component, the same
 * server-resolved bundle, for a campaign in ANY state including draft.
 *
 * Until this page existed, the only way to see what residents would get was to
 * make the campaign active and open the public link — which means the first
 * time an operator reads their own consultation as a resident is after
 * residents already can. This page closes that: it is member-gated
 * (`loadPortalPreviewResult` checks workspace membership + `engagement.read`
 * against the service-role read it performs), it renders the REAL
 * `PublicEngagementPortal` rather than a mockup that could drift from it, and
 * `previewMode` disables every submission surface so nothing an operator does
 * here can write to their own public record.
 *
 * THE PUBLIC PATH IS UNTOUCHED: residents still reach a portal only through
 * `share_token` + `status = 'active'`. This page never widens that door — it is
 * a different door with a badge reader on it.
 */
export default async function EngagementPortalPreviewPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const result = await loadPortalPreviewResult(campaignId, user.id);

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

  const { campaign, campaignText, locale, messages, portalProps } = result.bundle;
  const translator = createPortalTranslator(messages);
  const portalState = getPublicPortalState(campaign);

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

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PortalOperatorText
          as="h1"
          className="text-xl font-semibold text-foreground"
          value={campaignText.title}
          translator={translator}
        />
        <Link
          href={`/engagement/${campaignId}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to the campaign console
        </Link>
      </div>

      {/*
        The REAL portal component with the REAL server-resolved bundle — the
        whole point of this page is that nothing here is a mockup that can
        drift from what residents get. `dir`/`lang` travel with the surface the
        same way the public page sets them.
      */}
      <div dir={locale.direction} lang={locale.bcp47}>
        <PublicEngagementPortal {...portalProps} previewMode />
      </div>
    </section>
  );
}
