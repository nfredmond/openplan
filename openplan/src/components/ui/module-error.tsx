"use client";

import { useCallback, useEffect, useRef, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { OperatorDetail } from "@/components/ui/read-failure-notice";
import { reportClientError } from "@/lib/observability/report-client-error";

/**
 * Retry a failed route segment so the retry can actually succeed.
 *
 * `reset()` alone re-renders the boundary's children from what the client
 * already holds. When a server component failed, that is the failed response,
 * so "Try again" showed the same error. `router.refresh()` asks the server for
 * the segment again; running both in one transition re-renders the boundary
 * once the fresh response arrives. (The portal's error page records the same
 * finding and reloads the window instead, because a resident's page has no
 * app shell to keep.)
 */
export function useRefreshThenReset(reset: () => void) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const retry = useCallback(() => {
    startTransition(() => {
      router.refresh();
      reset();
    });
  }, [reset, router]);
  return { retry, isPending };
}

/**
 * What a planner sees when one module's page fails to load.
 *
 * It says the page did not load and offers two things to do. It does not say
 * why, and it does not say nothing was lost: an error page cannot know either.
 * The digest is for whoever runs the deployment, so it sits in the same
 * disclosure every read-failure notice uses.
 */
export function ModuleError({
  error,
  reset,
  moduleName,
  backHref,
  backLabel,
  logTag,
  as: Container = "div",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  /** The module's name as the rail shows it. Omit on a page outside any one module. */
  moduleName?: string;
  backHref: string;
  backLabel: string;
  /** Console tag, for example "grants-error". */
  logTag: string;
  /** `main` for boundaries outside the app shell, which supplies its own. */
  as?: "div" | "main";
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { retry, isPending } = useRefreshThenReset(reset);

  useEffect(() => {
    console.error(`[openplan/${logTag}]`, {
      message: error.message,
      digest: error.digest ?? null,
    });
    reportClientError(logTag, error);
  }, [error, logTag]);

  // Move focus to the heading, so a keyboard or screen reader user starts at
  // the sentence that replaced the page rather than wherever focus was.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <Container className={Container === "main" ? "mx-auto max-w-2xl px-6 py-16" : "px-6 py-8"}>
      <div role="alert" className="max-w-2xl space-y-3" data-testid="page-load-error">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-2xl font-semibold tracking-tight text-foreground outline-none sm:text-[1.75rem]"
        >
          {moduleName ? `${moduleName} did not load.` : "This page did not load."}
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">Try again, or go back and open the page from there.</p>
        {error.digest ? (
          <OperatorDetail>
            <p>Reference {error.digest}</p>
          </OperatorDetail>
        ) : null}
      </div>
      <div className="mt-5 flex flex-wrap gap-3 text-sm">
        <button
          type="button"
          onClick={retry}
          disabled={isPending}
          className="inline-flex min-h-10 items-center rounded border border-destructive/40 px-3 py-1.5 font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
        >
          {isPending ? "Trying again" : "Try again"}
        </button>
        <Link
          href={backHref}
          className="inline-flex min-h-10 items-center rounded border border-border px-3 py-1.5 font-medium text-foreground hover:bg-muted/40"
        >
          {backLabel}
        </Link>
      </div>
    </Container>
  );
}
