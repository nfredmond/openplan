"use client";

import { useEffect } from "react";
import Link from "next/link";
import { StateBlock } from "@/components/ui/state-block";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[openplan/root-error]", {
      message: error.message,
      digest: error.digest ?? null,
    });
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
      <StateBlock
        tone="danger"
        title="Something went wrong while loading this page."
        description={
          error.digest
            ? `Reference ${error.digest}. Try again or head back to the dashboard.`
            : "Try again or head back to the dashboard."
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
              href="/dashboard"
              className="inline-flex items-center rounded border border-border px-3 py-1.5 font-medium text-foreground hover:bg-muted/40"
            >
              Back to Dashboard
            </Link>
          </div>
        }
      />
    </main>
  );
}
