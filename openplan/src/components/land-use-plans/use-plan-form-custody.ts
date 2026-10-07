"use client";

import { useLayoutEffect, useRef, useState, type FormEvent } from "react";

export function planFormSnapshot(form: HTMLFormElement | FormData) {
  const data = form instanceof FormData ? form : new FormData(form);
  return JSON.stringify(Array.from(data.entries()).map(([name, value]) => [name,
    typeof value === "string" ? value : { name: value.name, size: value.size, modified: value.lastModified }]));
}

/** A reply acknowledges the submitted form, never text entered while it was saving. */
export function resetUnchangedPlanForm(form: HTMLFormElement, submitted: FormData) {
  if (planFormSnapshot(form) !== planFormSnapshot(submitted)) return false;
  form.reset();
  return true;
}

/** Supplement the controlled content/context drafts with unfinished staff forms. */
export function usePlanFormCustody(scope: string) {
  const root = useRef<HTMLDivElement>(null);
  const forms = useRef(new Map<HTMLFormElement, { baseline: string; dirty: boolean }>());
  const owner = useRef(scope);
  const [hasUnsavedForms, setHasUnsavedForms] = useState(false);
  function publish() { setHasUnsavedForms(Array.from(forms.current.values()).some(value => value.dirty)); }
  useLayoutEffect(() => {
    if (owner.current !== scope) { forms.current.clear(); owner.current = scope; }
    for (const [form] of forms.current) if (!root.current?.contains(form)) forms.current.delete(form);
    for (const form of root.current?.querySelectorAll("form") ?? []) {
      if (form.closest("[data-plan-context-custody]")) continue;
      const current = forms.current.get(form);
      if (!current?.dirty) forms.current.set(form, { baseline: planFormSnapshot(form), dirty: false });
    }
    publish();
  });
  function change(event: FormEvent<HTMLDivElement>) {
    const form = event.target instanceof HTMLElement ? event.target.closest("form") : null;
    if (!form || form.closest("[data-plan-context-custody]")) return;
    const record = forms.current.get(form);
    if (!record) return;
    record.dirty = planFormSnapshot(form) !== record.baseline;
    publish();
  }
  function reset(event: FormEvent<HTMLDivElement>) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !forms.current.has(form)) return;
    const currentOwner = owner.current;
    queueMicrotask(() => {
      if (owner.current !== currentOwner || !root.current?.contains(form)) return;
      forms.current.set(form, { baseline: planFormSnapshot(form), dirty: false }); publish();
    });
  }
  function acknowledge(form: HTMLFormElement, submitted: string) {
    const record = forms.current.get(form);
    if (!record) return;
    const current = planFormSnapshot(form);
    if (record.dirty) forms.current.set(form, { baseline: submitted, dirty: current !== submitted });
    else forms.current.set(form, { baseline: current, dirty: false });
    publish();
  }
  return { root, hasUnsavedForms, change, reset, acknowledge };
}
