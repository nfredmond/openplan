import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { DominantAction } from "./_types";

/**
 * One line naming the packet action that covers the most cycles in the
 * current view, linked to those cycles.
 *
 * This replaced a sidebar of ranked "queue lanes", share percentages and
 * trace mixes (October 13, 2026). Every count it showed is already on the
 * registry table's filters, and the bulk actions sit in the command board
 * below, so the sidebar restated the page in builder vocabulary.
 */
export function RtpRegistryNextStep({ action, href }: { action: DominantAction | undefined; href: string | null }) {
  if (!action || action.count === 0 || !href) {
    return null;
  }

  return (
    <p className="text-sm text-muted-foreground" data-testid="rtp-registry-next-step">
      Start with:{" "}
      <Link href={href} className="module-inline-action inline-flex">
        {action.label} ({action.count} {action.count === 1 ? "cycle" : "cycles"})
        <ArrowRight className="h-4 w-4" />
      </Link>
    </p>
  );
}
