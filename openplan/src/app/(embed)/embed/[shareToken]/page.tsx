import { notFound } from "next/navigation";
import { PublicEngagementPortal } from "@/components/engagement/public-engagement-portal";
import { loadPublicPortalBundle } from "@/lib/engagement/public-portal-data";

// Embeddable engagement widget — same service-role + share_token + active gate
// and the same rate-limited/honeypotted/moderated write paths as the full public
// portal, in a stripped layout suitable for an <iframe> on an agency's site.
export default async function EmbedEngagementPage({
  params,
}: {
  params: Promise<{ shareToken: string }>;
}) {
  const { shareToken } = await params;

  const bundle = await loadPublicPortalBundle(shareToken);
  if (!bundle) {
    notFound();
  }

  const { campaign, portalProps } = bundle;

  return (
    <main className="mx-auto w-full max-w-[72rem] px-3 py-4 sm:px-4">
      <header className="mb-4 border-b border-border/60 pb-3">
        <h1 className="text-lg font-semibold text-foreground">{campaign.title}</h1>
        {campaign.public_description ? (
          <p className="mt-1 text-sm text-muted-foreground">{campaign.public_description}</p>
        ) : campaign.summary ? (
          <p className="mt-1 text-sm text-muted-foreground">{campaign.summary}</p>
        ) : null}
      </header>

      <PublicEngagementPortal {...portalProps} />

      <footer className="mt-6 border-t border-border/60 pt-3 text-center text-xs text-muted-foreground">
        <a href={`/engage/${shareToken}`} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
          Open the full engagement page
        </a>
        <span className="mx-2">·</span>
        Powered by OpenPlan
      </footer>
    </main>
  );
}
