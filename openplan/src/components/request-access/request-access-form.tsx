"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { ArrowRight, Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type RequestAccessFormState = {
  agencyName: string;
  contactName: string;
  contactEmail: string;
  roleTitle: string;
  region: string;
  useCase: string;
  expectedWorkspaceName: string;
  website: string;
};

const initialState: RequestAccessFormState = {
  agencyName: "",
  contactName: "",
  contactEmail: "",
  roleTitle: "",
  region: "",
  useCase: "",
  expectedWorkspaceName: "",
  website: "",
};

type RequestAccessResponse = {
  success?: boolean;
  message?: string;
  error?: string;
};

function updateField(
  state: RequestAccessFormState,
  key: keyof RequestAccessFormState,
  value: string,
): RequestAccessFormState {
  return {
    ...state,
    [key]: value,
  };
}

export function RequestAccessForm() {
  const [form, setForm] = useState<RequestAccessFormState>(initialState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch("/api/request-access", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...form,
          sourcePath: "/request-access",
        }),
      });

      const payload = await response.json().catch(() => ({} as RequestAccessResponse));

      if (!response.ok || !payload.success) {
        setError(payload.error ?? "The request could not be submitted. Please try again.");
        return;
      }

      setForm(initialState);
      setSuccessMessage(payload.message ?? "Request received. The OpenPlan team will review it before any workspace is provisioned.");
    } catch {
      setError("The request could not be submitted. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="public-form-shell" onSubmit={handleSubmit}>
      <div className="public-form-grid">
        <div className="divide-y divide-border/60">
          <section className="public-form-section">
            <div className="public-form-heading">
              <h3 className="public-section-label">Agency context</h3>
              <p className="text-sm text-muted-foreground">
                Tell us who the workspace would support and where the first planning workflow should start.
              </p>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="request-agency" className="text-sm font-medium">
                  Agency or organization <span className="text-xs text-muted-foreground">(required)</span>
                </label>
                <Input
                  id="request-agency"
                  autoComplete="organization"
                  value={form.agencyName}
                  onChange={(event) => setForm((current) => updateField(current, "agencyName", event.target.value))}
                  maxLength={140}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="request-region" className="text-sm font-medium">
                  Region <span className="text-xs text-muted-foreground">(optional)</span>
                </label>
                <Input
                  id="request-region"
                  autoComplete="address-level2"
                  placeholder="County, MPO, district, or service area"
                  value={form.region}
                  onChange={(event) => setForm((current) => updateField(current, "region", event.target.value))}
                  maxLength={180}
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <label htmlFor="request-workspace" className="text-sm font-medium">
                  Expected workspace name <span className="text-xs text-muted-foreground">(optional)</span>
                </label>
                <Input
                  id="request-workspace"
                  placeholder="Example: Nevada County Transportation Commission"
                  value={form.expectedWorkspaceName}
                  onChange={(event) => setForm((current) => updateField(current, "expectedWorkspaceName", event.target.value))}
                  maxLength={140}
                />
              </div>
            </div>
          </section>

          <section className="public-form-section">
            <div className="public-form-heading">
              <h3 className="public-section-label">Operator contact</h3>
              <p className="text-sm text-muted-foreground">
                Use the person who can confirm workspace scope, first data needs, and onboarding timing.
              </p>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="request-contact-name" className="text-sm font-medium">
                  Contact name <span className="text-xs text-muted-foreground">(required)</span>
                </label>
                <Input
                  id="request-contact-name"
                  autoComplete="name"
                  value={form.contactName}
                  onChange={(event) => setForm((current) => updateField(current, "contactName", event.target.value))}
                  maxLength={140}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="request-contact-email" className="text-sm font-medium">
                  Work email <span className="text-xs text-muted-foreground">(required)</span>
                </label>
                <Input
                  id="request-contact-email"
                  type="email"
                  autoComplete="email"
                  value={form.contactEmail}
                  onChange={(event) => setForm((current) => updateField(current, "contactEmail", event.target.value))}
                  maxLength={220}
                  required
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <label htmlFor="request-role" className="text-sm font-medium">
                  Role or title <span className="text-xs text-muted-foreground">(optional)</span>
                </label>
                <Input
                  id="request-role"
                  autoComplete="organization-title"
                  placeholder="Planning manager, consultant lead, analyst, executive sponsor"
                  value={form.roleTitle}
                  onChange={(event) => setForm((current) => updateField(current, "roleTitle", event.target.value))}
                  maxLength={140}
                />
              </div>
            </div>
          </section>

          <section className="public-form-section">
            <div className="public-form-heading">
              <h3 className="public-section-label">First workflow</h3>
              <p className="text-sm text-muted-foreground">
                A focused first use case makes it easier to provision the right workspace and avoid speculative setup.
              </p>
            </div>

            <div className="mt-4 space-y-1.5">
              <label htmlFor="request-use-case" className="text-sm font-medium">
                What should OpenPlan help with first? <span className="text-xs text-muted-foreground">(required)</span>
              </label>
              <Textarea
                id="request-use-case"
                rows={7}
                placeholder="Example: screen rural transit corridors, prepare ATP support material, organize RTP project evidence, or collect engagement input tied to a live plan."
                value={form.useCase}
                onChange={(event) => setForm((current) => updateField(current, "useCase", event.target.value))}
                maxLength={2400}
                required
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>Include the planning lane, decision timeline, and any known data constraints.</span>
                <span>{form.useCase.length}/2400 characters</span>
              </div>
            </div>
          </section>
        </div>

        <aside className="public-form-rail">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ArrowRight className="h-4 w-4 text-[color:var(--accent)]" />
              Review lane
            </h3>
            <ul className="public-bullet-list public-bullet-list--compact mt-3 text-sm text-muted-foreground">
              <li>Requests are reviewed before a workspace is provisioned.</li>
              <li>No outbound message is sent automatically from this form.</li>
              <li>Plan selection and paid activation remain separate supervised steps.</li>
            </ul>
          </div>

          <div className="public-note-block">
            <p className="public-section-label">Helpful detail</p>
            <p className="mt-2 text-sm text-muted-foreground">
              The most useful requests name one immediate workflow, one responsible contact, and the public agency or
              client context behind the work.
            </p>
          </div>
        </aside>
      </div>

      <div className="public-form-footer">
        {error ? (
          <p className="mb-4 border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </p>
        ) : null}

        {successMessage ? (
          <p className="mb-4 border border-emerald-300/80 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
            {successMessage}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Submitting creates an internal intake record only; it does not create an account, workspace, or subscription.
          </p>
          <Button type="submit" disabled={isSubmitting} className="min-w-[13rem] justify-center">
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Request access
          </Button>
        </div>
      </div>

      <div className="absolute -left-[9999px] opacity-0" aria-hidden="true">
        <label htmlFor="request-website">Website</label>
        <input
          id="request-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={form.website}
          onChange={(event) => setForm((current) => updateField(current, "website", event.target.value))}
        />
      </div>
    </form>
  );
}
