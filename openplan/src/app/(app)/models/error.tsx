"use client";

import { useEffect } from "react";
import Link from "next/link";
import { StateBlock } from "@/components/ui/state-block";

export default function ModelsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[openplan/models-error]", {
      message: error.message,
      digest: error.digest ?? null,
    });
  }, [error]);

  return (
    <div className="px-6 py-8">
      <StateBlock
        tone="danger"
        title="The models surface hit an error."
        description={
          error.digest
            ? `Reference ${error.digest}. Try again, or return to the models list.`
            : "Try again, or return to the models list."
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
              href="/models"
              className="inline-flex items-center rounded border border-border px-3 py-1.5 font-medium text-foreground hover:bg-muted/40"
            >
              Back to Models
            </Link>
          </div>
        }
      />
    </div>
  );
}
