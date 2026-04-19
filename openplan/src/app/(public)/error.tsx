"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ErrorState } from "@/components/ui/state-block";

export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[openplan/public-error]", {
      message: error.message,
      digest: error.digest ?? null,
    });
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col justify-center px-6 py-16">
      <ErrorState
        title="This public page couldn't load."
        description={
          error.digest
            ? `Reference ${error.digest}. Try again, or head back to the home page.`
            : "Try again, or head back to the home page."
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
              href="/"
              className="inline-flex items-center rounded border border-border px-3 py-1.5 font-medium text-foreground hover:bg-muted/40"
            >
              Home
            </Link>
          </div>
        }
      />
    </main>
  );
}
