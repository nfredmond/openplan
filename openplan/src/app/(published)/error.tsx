"use client";

import { useEffect } from "react";

/**
 * What a member of the public sees when an agency's published page fails to
 * load. It says what happened and what to do, and it does not point the reader
 * at OpenPlan's home page: they came for the agency's document.
 */
export default function PublishedError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[openplan/published-error]", { message: error.message, digest: error.digest ?? null });
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col justify-center px-6 py-16">
      <div role="alert" className="space-y-3">
        <h1 className="text-xl font-semibold text-foreground">This page did not load.</h1>
        <p className="text-base leading-7 text-muted-foreground">
          The problem is on our side, not with your phone or computer. This does not mean the agency withdrew the
          document. Please try again in a moment.
        </p>
        <p className="text-base leading-7 text-muted-foreground">
          If it keeps happening, contact the agency that sent you this link and tell them the page would not open.
        </p>
        {error.digest ? <p className="text-sm text-muted-foreground">Reference: {error.digest}</p> : null}
      </div>
      <button
        type="button"
        onClick={reset}
        className="mt-6 inline-flex min-h-11 w-fit items-center rounded-md border border-border px-5 text-base font-semibold text-foreground hover:bg-secondary"
      >
        Try again
      </button>
    </main>
  );
}
