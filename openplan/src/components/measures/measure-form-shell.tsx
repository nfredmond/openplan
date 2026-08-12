"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The submit-and-refresh plumbing every form in this lane shares.
 *
 * Extracted before the second copy rather than after. Seven small forms here
 * each need the same four things — a busy flag, an error string, a success
 * string, and a `router.refresh()` once the server row exists — and this repo's
 * named seam defect is a shared capability living inside one of its callers
 * getting reimplemented wrongly by the others. The specific way it would go
 * wrong here is worth naming: a form that forgets `router.refresh()` looks like
 * it saved nothing, so a clerk records the same receipt twice.
 *
 * `details` is surfaced separately from `error` because every route in this
 * lane answers a refusal with both a short reason and a sentence saying what to
 * do about it, and dropping the second is how a 409 becomes a dead end.
 */
export type MeasureSubmitState = {
  busy: boolean;
  error: string | null;
  details: string | null;
  message: string | null;
};

export function useMeasureSubmit() {
  const router = useRouter();
  const [state, setState] = useState<MeasureSubmitState>({
    busy: false,
    error: null,
    details: null,
    message: null,
  });

  async function submit(
    input: { url: string; method: "POST" | "PATCH" | "DELETE"; body?: unknown; successMessage: string },
    onDone?: () => void
  ): Promise<boolean> {
    setState({ busy: true, error: null, details: null, message: null });
    try {
      const response = await fetch(input.url, {
        method: input.method,
        headers: { "content-type": "application/json" },
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; details?: string };

      if (!response.ok) {
        setState({
          busy: false,
          error: payload.error || "The change was not saved.",
          details: payload.details ?? null,
          message: null,
        });
        return false;
      }

      setState({ busy: false, error: null, details: null, message: input.successMessage });
      onDone?.();
      router.refresh();
      return true;
    } catch (error) {
      setState({
        busy: false,
        error: error instanceof Error ? error.message : "The change was not saved.",
        details: null,
        message: null,
      });
      return false;
    }
  }

  return { state, submit };
}

/** The one place a form's outcome is rendered, so no form invents its own. */
export function MeasureSubmitFeedback({ state }: { state: MeasureSubmitState }) {
  if (state.error) {
    return (
      <div className="space-y-1 text-sm">
        <p className="font-medium text-destructive">{state.error}</p>
        {state.details ? <p className="text-muted-foreground">{state.details}</p> : null}
      </div>
    );
  }
  if (state.message) {
    return <p className="text-sm text-emerald-700 dark:text-emerald-300">{state.message}</p>;
  }
  return null;
}

export function MeasureField({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
      >
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
