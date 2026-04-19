"use client";

import { useEffect } from "react";
import Link from "next/link";
import { StateBlock } from "@/components/ui/state-block";

export default function AerialError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[openplan/aerial-error]", {
      message: error.message,
      digest: error.digest ?? null,
    });
  }, [error]);

  return (
    <div className="px-6 py-8">
      <StateBlock
        tone="danger"
        title="The aerial surface hit an error."
        description={
          error.digest
            ? `Reference ${error.digest}. Try again, or return to the aerial missions list.`
            : "Try again, or return to the aerial missions list."
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
              href="/aerial"
              className="inline-flex items-center rounded border border-border px-3 py-1.5 font-medium text-foreground hover:bg-muted/40"
            >
              Back to Aerial
            </Link>
          </div>
        }
      />
    </div>
  );
}
