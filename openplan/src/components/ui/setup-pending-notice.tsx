import * as React from "react";

import { OperatorDetail } from "@/components/ui/read-failure-notice";
import { setupPendingSentence } from "@/lib/ui/setup-pending";
import { cn } from "@/lib/utils";

/**
 * A FEATURE THIS INSTALLATION HAS NOT SET UP, SAID ONCE.
 *
 * About twenty places told a planner to "apply the latest migrations" or named
 * a migration number in the sentence they were reading (two-month review,
 * October 12, 2026, finding 2). A planner cannot apply a migration. What they
 * need is: this part is not on yet, what that means for the numbers on this
 * page, and who can turn it on. The migration, table or variable name is still
 * on the page, folded into `OperatorDetail` for whoever runs the installation.
 * The sentence itself lives in `src/lib/ui/setup-pending.ts`, shared with routes.
 */

/**
 * `consequence` is the planner half that cannot be shared: what is missing
 * from this page because of it, and, where a count or list would otherwise
 * look empty, that empty here means unknown rather than none. `children` is
 * the operator half: the migration, table or variable. Written as children so
 * `planner-pages-carry-no-build-notes` can tell the two halves apart in source.
 */
export function SetupPendingNotice({
  consequence,
  className,
  testId,
  children,
}: {
  consequence?: string;
  className?: string;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("module-alert text-sm", className)} role="status" data-testid={testId}>
      <p>{setupPendingSentence(consequence)}</p>
      <OperatorDetail>{typeof children === "string" ? <p>{children}</p> : children}</OperatorDetail>
    </div>
  );
}
