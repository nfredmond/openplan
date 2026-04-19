"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ErrorState } from "@/components/ui/state-block";

export default function ReportsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[openplan/reports-error]", {
      message: error.message,
      digest: error.digest ?? null,
    });
  }, [error]);

  return (
    <div className="px-6 py-8">
      <ErrorState
        title="The reports surface hit an error."
        description={
          error.digest
            ? `Reference ${error.digest}. Try again, or return to the reports list.`
            : "Try again, or return to the reports list."
        }
        action={
          <div className="flex flex-wrap gap-3 text-sm">
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center rounded border border-destructive/40 px-3 py-1.5 font-medium text-destructive hover:bg-destructive/10"
            >
              Retry
            </button>
            <Link
              href="/reports"
              className="inline-flex items-center rounded border border-border px-3 py-1.5 font-medium text-foreground hover:bg-muted/40"
            >
              Back to Reports
            </Link>
          </div>
        }
      />
    </div>
  );
}
