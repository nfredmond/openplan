"use client";

import { useEffect } from "react";
import Link from "next/link";
import { StateBlock } from "@/components/ui/state-block";

export default function ProgramsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[openplan/programs-error]", {
      message: error.message,
      digest: error.digest ?? null,
    });
  }, [error]);

  return (
    <div className="px-6 py-8">
      <StateBlock
        tone="danger"
        title="The programs surface hit an error."
        description={
          error.digest
            ? `Reference ${error.digest}. Try again, or return to the programs list.`
            : "Try again, or return to the programs list."
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
              href="/programs"
              className="inline-flex items-center rounded border border-border px-3 py-1.5 font-medium text-foreground hover:bg-muted/40"
            >
              Back to Programs
            </Link>
          </div>
        }
      />
    </div>
  );
}
