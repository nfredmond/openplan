"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ErrorState } from "@/components/ui/state-block";

export default function PlansError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[openplan/plans-error]", {
      message: error.message,
      digest: error.digest ?? null,
    });
  }, [error]);

  return (
    <div className="px-6 py-8">
      <ErrorState
        title="Something went wrong in Plans."
        description={
          error.digest
            ? `Reference ${error.digest}. Nothing has been deleted — this screen failed to load. Try again, or go back to Plans.`
            : "Nothing has been deleted — this screen failed to load. Try again, or go back to Plans."
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
              href="/plans"
              className="inline-flex items-center rounded border border-border px-3 py-1.5 font-medium text-foreground hover:bg-muted/40"
            >
              Back to Plans
            </Link>
          </div>
        }
      />
    </div>
  );
}
