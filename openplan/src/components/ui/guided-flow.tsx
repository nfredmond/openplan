"use client";

import * as React from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";

/**
 * THE one way OpenPlan asks a planner a few questions and then does something.
 *
 * WHY THIS EXISTS. Sixteen module pages open with a fully expanded form sitting
 * above the list the planner actually came to read — `model-creator` paints ten
 * fields above the model list, `project-record-composer` paints seven whole
 * forms behind tabs on the project page. The form is on screen whether or not
 * anybody is filling one in. A guided flow moves that work behind a button and
 * asks for it a few questions at a time.
 *
 * THE ELEMENT IS NATIVE `<dialog>` + `showModal()`. Measured in real Chrome,
 * not asserted: the focus trap, background inertness (calling `.focus()` on an
 * input behind an open modal does NOT move `document.activeElement`), Escape,
 * top-layer stacking above every z-index, and `::backdrop` — for zero
 * dependencies. `confirm-dialog.tsx` used to hand-roll a focus trap in forty
 * lines; a second hand-rolled copy here is exactly the "shared capability
 * reimplemented wrongly by the second caller" failure this repo keeps hitting,
 * so that file is now a native dialog too and this one adds nothing of its own.
 *
 * ---------------------------------------------------------------------------
 * THE FIVE WAYS THIS PATTERN FAILS, AND WHERE EACH IS PREVENTED
 * ---------------------------------------------------------------------------
 *
 * 1. IT SILENTLY EATS TYPED WORK. Escape, the close button and the backdrop all
 *    dismiss. `requestClose()` compares the current values against the ones the
 *    flow opened with and, when they differ, routes the dismissal through the
 *    confirm dialog. Backdrop clicks never close a dirty flow at all. This is a
 *    property of the primitive, not of each conversion — put it in the
 *    conversions and seven of eight will forget it.
 *
 * 2. A REQUIRED FIELD IS UNREACHABLE FROM THE STEP CARRYING THE SUBMIT. This
 *    shipped on the public portal: `required` on a textarea only fires while the
 *    textarea is ON SCREEN, and on the send step it was not, so a resident could
 *    walk to the end and post an empty comment. THE BROWSER'S `required`
 *    ATTRIBUTE IS NOT VALIDATION IN A STEPPED FORM. Here it is structurally
 *    impossible instead of merely discouraged:
 *      - a flow declares its fields as DATA, per step, including which are
 *        required, so validation does not depend on what is mounted;
 *      - `submit()` validates EVERY step's declared fields, always;
 *      - a failing submit navigates to the step that owns the first problem and
 *        focuses the offending control;
 *      - and `<GuidedFlow>` throws, outside production, if a step declares a
 *        field whose control that step does not actually render — so a field
 *        that is validated but has nowhere to be typed cannot survive one render.
 *    The flow renders no `<form>` and its buttons are `type="button"`, so the
 *    browser's own validation is never the thing standing between a planner and
 *    a bad write.
 *
 * 3. AN ERROR HIDES ON A STEP NOBODY IS LOOKING AT. A red sentence on step 2
 *    while the planner is reading step 4 is the same as no error at all.
 *    Problems are rendered on the step that owns them and the flow moves the
 *    planner there; the footer additionally counts anything outstanding.
 *
 * 4. A PHONE USER IS TRAPPED IN A BOX. At 390x844 this is a full-height sheet,
 *    not a centred card: the BODY scrolls, the footer never does, and the
 *    primary button is reachable without scrolling past anything. `100dvh`,
 *    never `100vh` — `vh` on a phone is the LARGEST viewport, which puts the
 *    footer under the URL bar. `env(safe-area-inset-bottom)` keeps it off the
 *    home indicator.
 *
 * 5. IT SUBMITS TWICE, OR LOSES ITSELF TO A `router.refresh()`. One in-flight
 *    guard lives here; a double-tapped Next-then-Save on a slow phone is how
 *    duplicate records get made. The flow closes BEFORE the caller refreshes,
 *    and focus returns to the control that opened it.
 *
 * ---------------------------------------------------------------------------
 * IF A FLOW CARRIES AN ASSISTANT ACTION
 * ---------------------------------------------------------------------------
 * The approval hash covers the EXECUTED payload. Build it in one dedicated
 * function that returns ONLY the action's declared keys, and never spread flow
 * values into it: an extra key, a trimmed string, a `""` where the offer had
 * nothing, or a reordered array all hash differently, and every approved action
 * then 403s at execution AFTER the planner approved it.
 *
 * ---------------------------------------------------------------------------
 * SHAPE
 * ---------------------------------------------------------------------------
 *
 *   const flow = useGuidedFlow({
 *     id: "create-model",
 *     title: "Create a model",
 *     submitLabel: "Create the model",
 *     initialValues: { title: "", summary: "" },
 *     steps: [ … ],
 *     onSubmit: async (values) => { await fetch(…); },
 *   });
 *   …
 *   <Button onClick={flow.open}>New model</Button>
 *   <GuidedFlow flow={flow} />
 *
 * `mode: "sequence"` (default) is a linear create: Back / Next, and the submit
 * lives only on the last step. `mode: "sections"` shows every step at once in a
 * rail with the submit always live — use it for editing a record that already
 * exists, where "step 3 of 7" is a lie.
 */

export type GuidedFlowValues = Record<string, unknown>;

/**
 * One answer the flow collects. Declared as data so a flow can be read at a
 * glance, so validation does not depend on what is mounted, and so a guard can
 * check it mechanically.
 */
export type GuidedFlowField = {
  /** Unique within the flow. Must be a key of `initialValues`. */
  name: string;
  /** The planner's word for it. Used in the sentence when it is missing. */
  label: string;
  /** Empty blocks the submit — checked in JS, on every step, always. */
  required?: boolean;
  /** Overrides the default "Add …" sentence. Say what to do, not what is wrong. */
  requiredMessage?: string;
};

export type GuidedFlowProblem = {
  /** Names a declared field so the flow can focus the control. */
  field?: string;
  message: string;
};

export type GuidedFlowStep<V extends GuidedFlowValues> = {
  id: string;
  /** A question, in the planner's words: "What are you testing?" */
  title: string;
  /** One plain sentence under it. Optional, and usually worth writing. */
  hint?: string;
  /** Every answer this step collects. The step must render a control for each. */
  fields: readonly GuidedFlowField[];
  render: (flow: GuidedFlowController<V>) => React.ReactNode;
  /** Checks beyond "not empty" — a date order, a number range, a pair of fields. */
  check?: (values: V) => GuidedFlowProblem | null;
  /** A step that does not apply to the answers so far. Skipped and not counted. */
  when?: (values: V) => boolean;
};

export type GuidedFlowController<V extends GuidedFlowValues> = {
  id: string;
  title: string;
  description?: string;
  mode: "sequence" | "sections";
  submitLabel: string;
  isOpen: boolean;
  isSubmitting: boolean;
  isDirty: boolean;
  submitError: string | null;
  /** Steps whose `when` passes, in order. */
  steps: GuidedFlowStep<V>[];
  step: GuidedFlowStep<V> | null;
  stepIndex: number;
  values: V;
  /** Problems the planner has been shown. Empty until they press Next or Save. */
  problems: GuidedFlowProblem[];
  open: () => void;
  /** Open with some answers filled in — a row's current values, say. */
  openWith: (seed: Partial<V>) => void;
  /** The dismissal path. Asks first when there is typed work. */
  requestClose: () => void;
  back: () => void;
  next: () => void;
  goTo: (idOrIndex: string | number) => void;
  submit: () => void;
  setValue: <K extends keyof V>(name: K, value: V[K]) => void;
  setValues: (patch: Partial<V>) => void;
  /** `id` + validity wiring for any control. Spread it onto the element. */
  fieldProps: (name: keyof V & string) => {
    id: string;
    "aria-invalid": boolean | undefined;
    "aria-describedby": string | undefined;
  };
  /** `fieldProps` plus value/onChange, for a plain input, textarea or select. */
  text: (name: keyof V & string) => {
    id: string;
    value: string;
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
    "aria-invalid": boolean | undefined;
    "aria-describedby": string | undefined;
  };
  /** The sentence to show under a control, or null. */
  problemFor: (name: keyof V & string) => string | null;
  /** Rendered by `<GuidedFlow>`; callers never place it themselves. */
  confirmDialog: React.ReactNode;
};

export type UseGuidedFlowOptions<V extends GuidedFlowValues> = {
  /** Stable, unique on the page — it namespaces every control's DOM id. */
  id: string;
  title: string;
  description?: string;
  mode?: "sequence" | "sections";
  submitLabel: string;
  initialValues: V;
  steps: readonly GuidedFlowStep<V>[];
  /**
   * Does the thing. Throw, or return a string, to keep the flow open and show
   * the message. Returning normally closes the flow — so navigate or refresh
   * AFTER awaiting, never inside.
   */
  onSubmit: (values: V) => Promise<string | void> | string | void;
  /** Ask before discarding even when nothing was typed. Rarely wanted. */
  alwaysConfirmClose?: boolean;
};

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function fieldDomId(flowId: string, name: string): string {
  return `${flowId}-${name}`;
}

/** Every problem in the flow, in step order, whatever is mounted. */
function collectProblems<V extends GuidedFlowValues>(
  steps: GuidedFlowStep<V>[],
  values: V
): Array<GuidedFlowProblem & { stepIndex: number }> {
  const found: Array<GuidedFlowProblem & { stepIndex: number }> = [];
  steps.forEach((step, stepIndex) => {
    for (const field of step.fields) {
      if (!field.required) continue;
      if (!isBlank(values[field.name])) continue;
      found.push({
        stepIndex,
        field: field.name,
        message: field.requiredMessage ?? `Add ${field.label.toLowerCase()} before you finish.`,
      });
    }
    const extra = step.check?.(values);
    if (extra) found.push({ ...extra, stepIndex });
  });
  return found;
}

export function useGuidedFlow<V extends GuidedFlowValues>(
  options: UseGuidedFlowOptions<V>
): GuidedFlowController<V> {
  const {
    id,
    title,
    description,
    mode = "sequence",
    submitLabel,
    initialValues,
    steps: declaredSteps,
    onSubmit,
    alwaysConfirmClose = false,
  } = options;

  const [isOpen, setIsOpen] = React.useState(false);
  const [values, setValuesState] = React.useState<V>(initialValues);
  const [baseline, setBaseline] = React.useState<V>(initialValues);
  const [stepIndex, setStepIndex] = React.useState(0);
  const [shown, setShown] = React.useState<GuidedFlowProblem[]>([]);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirmDialog();

  // The submit handler changes identity on every render of the caller (it
  // closes over the caller's state). Read it through a ref so `submit` does not
  // have to be rebuilt — an in-flight guard on a callback that is replaced
  // mid-flight is not a guard.
  const submitRef = React.useRef(onSubmit);
  React.useEffect(() => {
    submitRef.current = onSubmit;
  }, [onSubmit]);

  const steps = React.useMemo(
    () => declaredSteps.filter((step) => (step.when ? step.when(values) : true)),
    [declaredSteps, values]
  );

  // Two mistakes that would make the required-field guarantee a lie, caught the
  // first time the flow is built rather than the first time a planner loses
  // work: a field validated under a name nothing stores, and two fields sharing
  // a name so one overwrites the other's DOM id.
  if (process.env.NODE_ENV !== "production") {
    const seen = new Set<string>();
    for (const step of declaredSteps) {
      for (const field of step.fields) {
        if (seen.has(field.name)) {
          throw new Error(
            `Guided flow "${id}" declares the field "${field.name}" twice. Field names are DOM ids and validation keys; two fields sharing one name silently validate the same answer.`
          );
        }
        seen.add(field.name);
        if (!(field.name in initialValues)) {
          throw new Error(
            `Guided flow "${id}" declares the field "${field.name}", which is not a key of initialValues. It would validate an answer the flow can never hold.`
          );
        }
      }
    }
  }

  const setValues = React.useCallback((patch: Partial<V>) => {
    setValuesState((current) => ({ ...current, ...patch }));
  }, []);

  const setValue = React.useCallback(<K extends keyof V>(name: K, value: V[K]) => {
    setValuesState((current) => ({ ...current, [name]: value }));
  }, []);

  const isDirty = React.useMemo(
    () => JSON.stringify(values) !== JSON.stringify(baseline),
    [values, baseline]
  );

  const start = React.useCallback(
    (seed?: Partial<V>) => {
      const next = seed ? { ...initialValues, ...seed } : initialValues;
      setValuesState(next);
      setBaseline(next);
      setStepIndex(0);
      setShown([]);
      setSubmitError(null);
      setIsOpen(true);
    },
    [initialValues]
  );

  const open = React.useCallback(() => start(), [start]);
  const openWith = React.useCallback((seed: Partial<V>) => start(seed), [start]);

  const close = React.useCallback(() => {
    setIsOpen(false);
    setShown([]);
    setSubmitError(null);
  }, []);

  const requestClose = React.useCallback(() => {
    // An in-flight write is not a moment to disappear: the planner would not
    // know whether the record was made.
    if (isSubmitting) return;
    if (!isDirty && !alwaysConfirmClose) {
      close();
      return;
    }
    void confirm({
      headline: "Close without saving?",
      consequence:
        "What you have typed here is not saved anywhere yet. Closing throws it away.",
      confirmLabel: "Throw it away",
      cancelLabel: "Keep filling it in",
      tone: "destructive",
    }).then((discard) => {
      if (discard) close();
    });
  }, [alwaysConfirmClose, close, confirm, isDirty, isSubmitting]);

  const focusField = React.useCallback(
    (name: string | undefined) => {
      if (!name) return;
      // After the step has painted, not before it.
      window.requestAnimationFrame(() => {
        const element = document.getElementById(fieldDomId(id, name));
        if (element instanceof HTMLElement) element.focus();
      });
    },
    [id]
  );

  const goTo = React.useCallback(
    (idOrIndex: string | number) => {
      const index =
        typeof idOrIndex === "number"
          ? idOrIndex
          : steps.findIndex((step) => step.id === idOrIndex);
      if (index < 0 || index >= steps.length) return;
      setStepIndex(index);
    },
    [steps]
  );

  const next = React.useCallback(() => {
    const step = steps[stepIndex];
    if (!step) return;
    const here = collectProblems([step], values);
    if (here.length > 0) {
      setShown(here.map(({ field, message }) => ({ field, message })));
      focusField(here[0].field);
      return;
    }
    setShown([]);
    setStepIndex((current) => Math.min(current + 1, steps.length - 1));
  }, [focusField, stepIndex, steps, values]);

  const back = React.useCallback(() => {
    // Never blocked by validation. A planner must always be able to go back and
    // look at what they answered, half-finished or not.
    setShown([]);
    setStepIndex((current) => Math.max(current - 1, 0));
  }, []);

  const submit = React.useCallback(() => {
    if (isSubmitting) return;
    const all = collectProblems(steps, values);
    if (all.length > 0) {
      // The step that OWNS the first problem, not the one being looked at.
      setShown(all.map(({ field, message }) => ({ field, message })));
      setStepIndex(all[0].stepIndex);
      focusField(all[0].field);
      return;
    }
    setShown([]);
    setSubmitError(null);
    setIsSubmitting(true);
    void (async () => {
      try {
        const outcome = await submitRef.current(values);
        if (typeof outcome === "string" && outcome.trim()) {
          setSubmitError(outcome);
          return;
        }
        setBaseline(values);
        setIsOpen(false);
        setShown([]);
      } catch (error) {
        setSubmitError(
          error instanceof Error && error.message ? error.message : "That did not save. Try again."
        );
      } finally {
        setIsSubmitting(false);
      }
    })();
  }, [focusField, isSubmitting, steps, values]);

  const problemFor = React.useCallback(
    (name: keyof V & string) => shown.find((problem) => problem.field === name)?.message ?? null,
    [shown]
  );

  const fieldProps = React.useCallback(
    (name: keyof V & string) => {
      const problem = shown.find((entry) => entry.field === name);
      return {
        id: fieldDomId(id, name),
        "aria-invalid": problem ? true : undefined,
        "aria-describedby": problem ? `${fieldDomId(id, name)}-problem` : undefined,
      };
    },
    [id, shown]
  );

  const text = React.useCallback(
    (name: keyof V & string) => ({
      ...fieldProps(name),
      value: String(values[name] ?? ""),
      onChange: (
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
      ) => setValue(name, event.target.value as V[typeof name]),
    }),
    [fieldProps, setValue, values]
  );

  const controller: GuidedFlowController<V> = {
    id,
    title,
    description,
    mode,
    submitLabel,
    isOpen,
    isSubmitting,
    isDirty,
    submitError,
    steps,
    step: steps[Math.min(stepIndex, Math.max(steps.length - 1, 0))] ?? null,
    stepIndex: Math.min(stepIndex, Math.max(steps.length - 1, 0)),
    values,
    problems: shown,
    open,
    openWith,
    requestClose,
    back,
    next,
    goTo,
    submit,
    setValue,
    setValues,
    fieldProps,
    text,
    problemFor,
    confirmDialog,
  };

  return controller;
}

/**
 * The sheet. One `<dialog>`, one scrolling body, one footer that never scrolls.
 *
 * Everything about modality — focus containment, the inert page behind, Escape,
 * stacking above the whole document — is the element's, and is measured in a
 * real browser. jsdom applies no stylesheet and has no box model, so no unit
 * test may claim any of it.
 */
export function GuidedFlow<V extends GuidedFlowValues>({
  flow,
  className,
}: {
  flow: GuidedFlowController<V>;
  className?: string;
}) {
  const dialogRef = React.useRef<HTMLDialogElement | null>(null);
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);
  const returnFocusRef = React.useRef<HTMLElement | null>(null);
  const titleId = React.useId();

  const { isOpen, step, stepIndex, steps, mode } = flow;
  const isLast = stepIndex >= steps.length - 1;
  const canSubmitHere = mode === "sections" || isLast;

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen) {
      if (!dialog.open) {
        returnFocusRef.current = document.activeElement as HTMLElement | null;
        // `showModal()`, NEVER `<dialog open>`. The attribute renders a
        // non-modal dialog: outside the top layer, background not inert, no
        // focus containment and no Escape. It looks identical until someone
        // tabs or opens a second one.
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
      const returnTo = returnFocusRef.current;
      if (returnTo && document.contains(returnTo)) returnTo.focus();
    }
  }, [isOpen]);

  // Each new step starts at the top with the question in the reading position,
  // and puts the keyboard on the heading rather than into the first input —
  // autofocusing a text input inside a sheet makes iOS zoom the page.
  React.useEffect(() => {
    if (!isOpen) return;
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    headingRef.current?.focus();
  }, [isOpen, stepIndex]);

  // A field that is validated but has nowhere to be typed is the defect this
  // primitive exists to make impossible, so it may not survive one render.
  // Outside production this throws; the alternative is a planner who cannot
  // submit and cannot see why.
  React.useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (!isOpen || !step) return;
    const missing = step.fields
      .map((field) => field.name)
      .filter((name) => !document.getElementById(`${flow.id}-${name}`));
    if (missing.length > 0) {
      throw new Error(
        `Guided flow "${flow.id}" step "${step.id}" declares ${missing
          .map((name) => `"${name}"`)
          .join(", ")} but renders no control with that id. Spread flow.text(name) or flow.fieldProps(name) onto the control, or drop the field from the step.`
      );
    }
  }, [flow.id, isOpen, step, stepIndex]);

  const stepProblems = flow.problems;

  return (
    <>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        data-testid={`guided-flow-${flow.id}`}
        onCancel={(event) => {
          // Escape reaches here BEFORE the dialog closes. Cancelling the event
          // is what lets the flow ask about unsaved work instead of eating it.
          event.preventDefault();
          flow.requestClose();
        }}
        onMouseDown={(event) => {
          if (event.target !== event.currentTarget) return;
          // The backdrop. It may close an untouched flow; it may never close
          // one with typed work in it, and `requestClose` is what knows the
          // difference.
          flow.requestClose();
        }}
        className={cn(
          // Phone: a full-height sheet pinned to the viewport, not a card
          // floating in the middle of it. `100dvh` because `100vh` on a phone
          // is the LARGEST viewport and hides the footer under the URL bar.
          "fixed inset-0 m-0 h-[100dvh] max-h-none w-screen max-w-none",
          // Desktop: the same markup, centred, sized to the reading width.
          "sm:m-auto sm:h-auto sm:max-h-[min(44rem,calc(100dvh-4rem))] sm:w-[min(40rem,calc(100vw-2rem))] sm:rounded-[0.6rem]",
          "flex-col overflow-hidden border-0 bg-background p-0 text-foreground shadow-2xl sm:border sm:border-border",
          "backdrop:bg-black/50",
          // A closed dialog must not lay out. `open:flex` is the only reason
          // the flex column below works at all.
          "hidden open:flex",
          className
        )}
      >
        {/* A CLOSED flow renders nothing inside itself. Eight sheets on one
            page would otherwise each paint their first step into the document
            permanently — invisible, but present: eight "Name" fields for a
            screen reader to find, eight roster requests fired by assignee
            pickers nobody opened, and eight copies of work no planner asked
            for. */}
        {isOpen ? (
          <>
          <header className="flex shrink-0 items-start gap-3 border-b border-border bg-background px-4 py-3.5 sm:px-5">
            <div className="min-w-0 flex-1">
              {mode === "sequence" && steps.length > 1 ? (
                <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Step {stepIndex + 1} of {steps.length} · {flow.title}
                </p>
              ) : (
                <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {flow.title}
                </p>
              )}
              <h2
                id={titleId}
                ref={headingRef}
                tabIndex={-1}
                className="mt-1 text-base font-semibold tracking-tight outline-none"
              >
                {step?.title ?? flow.title}
              </h2>
              {step?.hint ? (
                <p className="mt-1 text-sm text-muted-foreground">{step.hint}</p>
              ) : null}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={flow.requestClose}
              aria-label="Close without saving"
              className="shrink-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </header>

          {mode === "sections" && steps.length > 1 ? (
            <nav
              aria-label={`${flow.title} sections`}
              className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-muted/25 px-3 py-2"
            >
              {steps.map((entry, index) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => flow.goTo(index)}
                  aria-current={index === stepIndex ? "step" : undefined}
                  className={cn(
                    "shrink-0 rounded-[0.4rem] px-2.5 py-1.5 text-[0.8rem] font-medium",
                    index === stepIndex
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {entry.title}
                </button>
              ))}
            </nav>
          ) : null}

          {/* The scroll lives HERE, on the body — never on the dialog, or the
              footer scrolls away with the questions. `overscroll-contain` stops a
              flick at the end from dragging the page behind it. */}
          <div
            ref={bodyRef}
            className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5"
          >
            {step ? step.render(flow) : null}

            {stepProblems.length > 0 ? (
              <p
                role="alert"
                data-testid={`guided-flow-${flow.id}-problems`}
                className="rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
              >
                {stepProblems.length === 1
                  ? stepProblems[0].message
                  : `${stepProblems.length} things still need an answer. ${stepProblems[0].message}`}
              </p>
            ) : null}

            {flow.submitError ? (
              <p
                role="alert"
                data-testid={`guided-flow-${flow.id}-error`}
                className="rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
              >
                {flow.submitError}
              </p>
            ) : null}
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-muted/20 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-5">
            <div className="flex items-center gap-2">
              {mode === "sequence" && stepIndex > 0 ? (
                <Button type="button" variant="outline" onClick={flow.back} disabled={flow.isSubmitting}>
                  <ArrowLeft className="mr-1.5 h-4 w-4" />
                  Back
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={flow.requestClose}
                  disabled={flow.isSubmitting}
                >
                  Cancel
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {mode === "sequence" && !isLast ? (
                <Button type="button" onClick={flow.next}>
                  Next
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
              ) : null}
              {canSubmitHere ? (
                <Button type="button" onClick={flow.submit} disabled={flow.isSubmitting}>
                  {flow.isSubmitting ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="mr-1.5 h-4 w-4" />
                  )}
                  {flow.submitLabel}
                </Button>
              ) : null}
            </div>
          </footer>
          </>
        ) : null}
      </dialog>
      {flow.confirmDialog}
    </>
  );
}

/**
 * The sentence under a control that failed. Rendered by the step, beside the
 * field it is about — an error the planner cannot see from the control it
 * concerns is the same as no error.
 */
export function GuidedFlowFieldProblem<V extends GuidedFlowValues>({
  flow,
  name,
}: {
  flow: GuidedFlowController<V>;
  name: keyof V & string;
}) {
  const problem = flow.problemFor(name);
  if (!problem) return null;
  return (
    <p
      id={`${flow.id}-${name}-problem`}
      className="text-[0.78rem] font-medium text-red-700 dark:text-red-300"
    >
      {problem}
    </p>
  );
}

/** A labelled row inside a step. Keeps every flow's fields looking the same. */
export function GuidedFlowRow<V extends GuidedFlowValues>({
  flow,
  name,
  label,
  hint,
  children,
}: {
  flow: GuidedFlowController<V>;
  name: keyof V & string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={`${flow.id}-${name}`} className="text-[0.82rem] font-semibold">
        {label}
      </label>
      {hint ? <p className="text-[0.78rem] text-muted-foreground">{hint}</p> : null}
      {children}
      <GuidedFlowFieldProblem flow={flow} name={name} />
    </div>
  );
}
