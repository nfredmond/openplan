"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ErrorState } from "@/components/ui/state-block";

export default function EngagementError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[openplan/engagement-error]", {
      message: error.message,
      digest: error.digest ?? null,
    });
  }, [error]);

  return (
    <div className="px-6 py-8">
      <ErrorState
        title="Something went wrong in Engagement."
        description={
          error.digest
            ? `Reference ${error.digest}. Nothing has been deleted — this screen failed to load. Try again, or go back to Engagement.`
            : "Nothing has been deleted — this screen failed to load. Try again, or go back to Engagement."
        }
        action={
          <div className="flex flex-wrap gap-3 text-sm">
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center rounded border border-destructive/40 px-3 py-1.5 font-medium text-destructive hover:bg-destructive/10"
            >
              Try again
            </button>
            <Link
              href="/engagement"
              className="inline-flex items-center rounded border border-border px-3 py-1.5 font-medium text-foreground hover:bg-muted/40"
            >
              Back to Engagement
            </Link>
          </div>
        }
      />
    </div>
  );
}
