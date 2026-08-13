"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The one way OpenPlan asks a planner to confirm something it cannot undo.
 *
 * WHY THIS EXISTS. Fifteen surfaces each called `window.confirm()`. A native
 * dialog is the wrong instrument for this product three times over: it renders
 * in the browser's chrome, so it ignores the theme entirely; it can only carry
 * one unstyled string, so it can never NAME the campaigns and reports that
 * refer to the record a planner is about to delete; and Chrome lets a user tick
 * "prevent this page from creating more dialogs", after which every subsequent
 * confirm silently returns false and the delete button simply stops working
 * with no explanation.
 *
 * THE SHAPE IS COPIED FROM `workspace-gis-manager.tsx`, which had already got
 * this right and which nothing else found: a headline that asks the question, a
 * sentence saying exactly what is lost, the named — and where possible linked —
 * records that would be affected, and a non-destructive way out when the
 * product actually has one. "This item is in use" tells a planner nothing they
 * can act on. A list of what uses it tells them what to go and change.
 *
 * HOW TO USE IT. `useConfirmDialog` keeps the call site the same single line of
 * control flow that `window.confirm` was, so converting a caller cannot change
 * what the caller does:
 *
 *   const { confirm, confirmDialog } = useConfirmDialog();
 *   …
 *   if (!(await confirm({ headline: "…", consequence: "…", confirmLabel: "…" }))) return;
 *   …
 *   return (<div>…{confirmDialog}</div>);
 *
 * The promise resolves `true` only when the planner presses the destructive
 * button. Escape, the cancel button, the backdrop, and unmounting all resolve
 * `false`, because the safe answer is the one every ambiguous exit must give.
 */

export type ConfirmReference = {
  /** Stable key. Usually the referring record's id. */
  id: string;
  /** What the record is, in the planner's words — "Draft 2050 RTP", not a row id. */
  label: string;
  /** Where to go and change it, when there is somewhere to go. */
  href?: string | null;
  /** One clause on why this reference matters. */
  detail?: string | null;
};

export type ConfirmAlternative = {
  label: string;
  description?: string;
  /** Run instead of the destructive action. The dialog closes and `confirm` resolves false. */
  onSelect: () => void | Promise<void>;
};

export type ConfirmRequest = {
  /** The question itself. A planner should be able to answer from this line alone. */
  headline: string;
  /** What is lost, and what recomputes without it. Plain sentences, no hedging. */
  consequence: string;
  /** Named records that refer to this one, when the caller can supply them. */
  references?: ConfirmReference[];
  /** Heading above the reference list. */
  referencesLabel?: string;
  /** The destructive button's words. Name the act — "Remove this line", not "OK". */
  confirmLabel: string;
  /** Defaults to "Keep it". */
  cancelLabel?: string;
  /** A non-destructive way out, when the product has one. */
  alternative?: ConfirmAlternative;
  /**
   * `destructive` deletes a record. `caution` is for a step that is irreversible
   * but destroys nothing — publishing a machine translation, minting a
   * replacement public link. The distinction is not decoration: a planner should
   * not learn to click through red.
   */
  tone?: "destructive" | "caution";
};

type PendingConfirm = {
  request: ConfirmRequest;
  resolve: (answer: boolean) => void;
};

export function useConfirmDialog(): {
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  confirmDialog: React.ReactNode;
} {
  const [pending, setPending] = React.useState<PendingConfirm | null>(null);
  const pendingRef = React.useRef<PendingConfirm | null>(null);

  // Mirrored in an effect rather than during render: a ref written while
  // rendering is a lint error here, and React may render without committing.
  React.useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  // An unmount while the question is on screen is not a yes. Every caller
  // awaits this promise before doing the irreversible thing, so a promise left
  // unsettled would hang that await forever.
  React.useEffect(
    () => () => {
      pendingRef.current?.resolve(false);
    },
    []
  );

  const confirm = React.useCallback(
    (request: ConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        setPending({ request, resolve });
      }),
    []
  );

  const settle = React.useCallback((answer: boolean) => {
    setPending((current) => {
      current?.resolve(answer);
      return null;
    });
  }, []);

  const confirmDialog = pending ? (
    <ConfirmDialog request={pending.request} onSettle={settle} />
  ) : null;

  return { confirm, confirmDialog };
}

export function ConfirmDialog({
  request,
  onSettle,
}: {
  request: ConfirmRequest;
  onSettle: (answer: boolean) => void;
}) {
  const dialogRef = React.useRef<HTMLDialogElement | null>(null);
  const cancelRef = React.useRef<HTMLButtonElement | null>(null);
  const headlineId = React.useId();
  const consequenceId = React.useId();
  const tone = request.tone ?? "destructive";

  // Whatever the planner pressed to get here is where the keyboard goes back to.
  // Captured on mount rather than on every render: by the time the dialog
  // closes, `document.activeElement` is a button inside the dialog.
  const returnFocusRef = React.useRef<HTMLElement | null>(
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)
  );

  React.useEffect(() => {
    // `showModal()`, never the `open` ATTRIBUTE. The attribute gives a
    // non-modal dialog: no top layer, no inert background, no focus
    // containment, no Escape. It is the single most common way this element is
    // used wrong, and it looks identical on screen until someone tabs.
    dialogRef.current?.showModal();
    // The safe button takes focus, never the destructive one. A planner who
    // opens this and hits Enter out of habit must not delete anything.
    cancelRef.current?.focus();
    const returnTo = returnFocusRef.current;
    return () => {
      if (returnTo && document.contains(returnTo)) returnTo.focus();
    };
  }, []);

  const body = (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      // Redundant beside `showModal()`, which makes the dialog modal in the
      // accessibility tree by itself — kept because it is the only observable
      // trace of modality in a test environment that has no top layer.
      aria-modal="true"
      aria-labelledby={headlineId}
      aria-describedby={consequenceId}
      // The focus trap, the inert background, the Escape key, and stacking
      // above everything on the page are the element's own behaviour now — not
      // forty lines of hand-rolled Tab wrapping that the next modal would have
      // copied slightly wrong. Top-layer stacking is the load-bearing part: a
      // `z-50` portal opened from inside a guided flow would be DRAWN BEHIND
      // the flow and invisible, and this question is asked from inside one.
      onCancel={(event) => {
        event.preventDefault();
        onSettle(false);
      }}
      onMouseDown={(event) => {
        // Clicks on the backdrop report the dialog itself as the target; the
        // panel below stops them. Declining is the safe answer, so the
        // backdrop may close THIS — it may never close a form with typed work.
        if (event.target === event.currentTarget) onSettle(false);
      }}
      data-testid="confirm-dialog-backdrop"
      className="m-auto w-full max-w-lg overflow-hidden rounded-[0.5rem] border border-border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50"
    >
      <div
        className="w-full"
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <span
            className={cn(
              "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.4rem] border",
              tone === "destructive"
                ? "border-destructive/35 bg-destructive/10 text-destructive"
                : "border-amber-400/40 bg-amber-400/10 text-amber-700 dark:text-amber-200"
            )}
          >
            <AlertTriangle className="h-4 w-4" />
          </span>
          <h2 id={headlineId} className="text-base font-semibold tracking-tight">
            {request.headline}
          </h2>
        </div>

        <div className="space-y-3 px-5 py-4">
          <p id={consequenceId} className="text-sm text-muted-foreground">
            {request.consequence}
          </p>

          {request.references && request.references.length > 0 ? (
            <div className="space-y-2 rounded-[0.4rem] border border-border bg-muted/30 px-3 py-2.5">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {request.referencesLabel ?? "What refers to it"}
              </p>
              <ul role="list" className="space-y-1.5">
                {request.references.map((reference) => (
                  <li key={reference.id} className="text-sm">
                    {reference.href ? (
                      <a href={reference.href} className="font-medium underline underline-offset-2">
                        {reference.label}
                      </a>
                    ) : (
                      <span className="font-medium">{reference.label}</span>
                    )}
                    {reference.detail ? (
                      <span className="text-muted-foreground"> — {reference.detail}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {request.alternative?.description ? (
            <p className="text-sm text-muted-foreground">{request.alternative.description}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/20 px-5 py-3">
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            onClick={() => onSettle(false)}
          >
            {request.cancelLabel ?? "Keep it"}
          </Button>
          {request.alternative ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                const chosen = request.alternative;
                onSettle(false);
                void chosen?.onSelect();
              }}
            >
              {request.alternative.label}
            </Button>
          ) : null}
          <Button
            type="button"
            // The tone reaches the button, not just the icon. If everything
            // irreversible were red, red would stop meaning anything.
            variant={tone === "destructive" ? "destructive" : "default"}
            onClick={() => onSettle(true)}
          >
            {request.confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );

  if (typeof document === "undefined") return null;
  return createPortal(body, document.body);
}
