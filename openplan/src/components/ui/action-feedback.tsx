import * as React from "react";

/**
 * The one way OpenPlan tells a planner that something saved, or did not.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT A TOAST. `components/ui/sonner.tsx` shipped
 * with the shadcn scaffold and was never called once — no `toast(` anywhere, no
 * `<Toaster />` mounted in any layout. Wiring it now would have added a second
 * mechanism on top of the inline one the product already uses, and a toast is
 * the wrong instrument here specifically: it disappears. This is a system whose
 * posture is that a planner can always see what changed and where a number came
 * from, and a confirmation that evaporates after four seconds is unreadable to
 * anyone who looked away, unreachable to anyone who wants to re-read it, and it
 * floats over the map surfaces rather than sitting beside the control that
 * caused it. So: the toast layer was deleted, and the inline renderer the
 * measures lane already had — eight call sites, theme tokens, error and success
 * in one place — was promoted here for everything else to share.
 *
 * `no-toast-layer-guard.test.ts` keeps the third state from coming back.
 *
 * `details` is separate from `error` because routes in this repo answer a
 * refusal with both a short reason and a sentence saying what to do about it,
 * and dropping the second is how a 409 becomes a dead end.
 */
export type ActionFeedbackState = {
  busy: boolean;
  error: string | null;
  details: string | null;
  message: string | null;
};

/**
 * Renders nothing until there is an outcome.
 *
 * The roles are load-bearing, not decoration: a save confirmation that is only
 * a colour change is invisible to a planner using a screen reader, and this
 * component is now the only place that outcome is written.
 */
export function ActionFeedback({ state }: { state: ActionFeedbackState }) {
  if (state.error) {
    return (
      <div className="space-y-1 text-sm" role="alert">
        <p className="font-medium text-destructive">{state.error}</p>
        {state.details ? <p className="text-muted-foreground">{state.details}</p> : null}
      </div>
    );
  }
  if (state.message) {
    return (
      <p className="text-sm text-emerald-700 dark:text-emerald-300" role="status">
        {state.message}
      </p>
    );
  }
  return null;
}
