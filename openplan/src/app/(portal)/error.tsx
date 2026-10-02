"use client";

import { useEffect } from "react";

/**
 * What a resident sees when a public engagement page fails to load.
 *
 * Without this, the failure fell through to the app's root error page, which
 * tells the reader to "go back to Overview" and links to a staff dashboard. A
 * resident has no Overview. This says what happened and what to do in plain
 * words, and offers the one action that can help.
 */
export default function PortalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[openplan/portal-error]", { message: error.message, digest: error.digest ?? null });
  }, [error]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-16">
      <div role="alert" className="space-y-3">
        <h1 className="text-xl font-semibold text-foreground">This page did not load.</h1>
        <p className="text-base leading-7 text-muted-foreground">
          Please try loading this page again in a moment.
        </p>
        <p className="text-base leading-7 text-muted-foreground">
          If it keeps happening, contact the city, county or agency that sent you this link and tell them the page would
          not open.
        </p>
        {error.digest ? <p className="text-sm text-muted-foreground">Reference: {error.digest}</p> : null}
      </div>
      <button
        type="button"
        // Resetting the boundary alone can retain a failed Server Component response.
        onClick={() => window.location.reload()}
        className="mt-6 inline-flex min-h-11 w-fit items-center rounded-md border border-border px-5 text-base font-semibold text-foreground hover:bg-secondary"
      >
        Try again
      </button>
    </div>
  );
}
