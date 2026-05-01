"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { ArrowRight, Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ACCESS_REQUEST_DATA_SENSITIVITY_LABELS,
  ACCESS_REQUEST_DATA_SENSITIVITY_VALUES,
  ACCESS_REQUEST_DEPLOYMENT_POSTURE_LABELS,
  ACCESS_REQUEST_DEPLOYMENT_POSTURE_VALUES,
  ACCESS_REQUEST_FIRST_WORKFLOW_LABELS,
  ACCESS_REQUEST_FIRST_WORKFLOW_VALUES,
  ACCESS_REQUEST_ORGANIZATION_TYPE_LABELS,
  ACCESS_REQUEST_ORGANIZATION_TYPE_VALUES,
  ACCESS_REQUEST_SERVICE_LANE_LABELS,
  ACCESS_REQUEST_SERVICE_LANE_VALUES,
} from "@/lib/access-request-intake";
import type { PublicIntakeSourceContext } from "@/lib/access-request-query";

type RequestAccessFormState = {
  agencyName: string;
  contactName: string;
  contactEmail: string;
  roleTitle: string;
  region: string;
  organizationType: string;
  serviceLane: string;
  deploymentPosture: string;
  dataSensitivity: string;
  desiredFirstWorkflow: string;
  onboardingNeeds: string;
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
  organizationType: "",
  serviceLane: "",
  deploymentPosture: "",
  dataSensitivity: "",
  desiredFirstWorkflow: "",
  onboardingNeeds: "",
  useCase: "",
  expectedWorkspaceName: "",
  website: "",
};

type RequestAccessFormProps = {
  initialValues?: Partial<Omit<RequestAccessFormState, "website">>;
  sourcePath?: string;
  sourceContext?: PublicIntakeSourceContext;
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

function buildInitialState(initialValues: RequestAccessFormProps["initialValues"]): RequestAccessFormState {
  return {
    ...initialState,
    ...initialValues,
    website: "",
  };
}

export function RequestAccessForm({
  initialValues,
  sourcePath = "/request-access",
  sourceContext,
}: RequestAccessFormProps = {}) {
  const [form, setForm] = useState<RequestAccessFormState>(() => buildInitialState(initialValues));
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
          sourcePath,
          sourceContext,
        }),
      });

      const payload = await response.json().catch(() => ({} as RequestAccessResponse));

      if (!response.ok || !payload.success) {
        setError(payload.error ?? "The request could not be submitted. Please try again.");
        return;
      }

      setForm(buildInitialState(initialValues));
      setSuccessMessage(payload.message ?? "Request received. The OpenPlan team will review it before any hosted workspace, support commitment, or implementation scope is created.");
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
                Tell us who OpenPlan would support, whether you expect self-hosting or managed hosting, and where the first planning workflow should start.
              </p>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="request-agency" className="text-sm font-medium">
                  Agency or organization <span aria-hidden="true" className="text-[color:var(--accent)]">*</span>
                  <span className="sr-only"> required</span>
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
                <label htmlFor="request-organization-type" className="text-sm font-medium">
                  Organization type <span className="text-xs text-muted-foreground">(optional)</span>
                </label>
                <select
                  id="request-organization-type"
                  className="module-select"
                  value={form.organizationType}
                  onChange={(event) => setForm((current) => updateField(current, "organizationType", event.target.value))}
                >
                  <option value="">Select if known</option>
                  {ACCESS_REQUEST_ORGANIZATION_TYPE_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {ACCESS_REQUEST_ORGANIZATION_TYPE_LABELS[value]}
                    </option>
                  ))}
                </select>
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

              <div className="space-y-1.5">
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
                  Contact name <span aria-hidden="true" className="text-[color:var(--accent)]">*</span>
                  <span className="sr-only"> required</span>
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
                  Work email <span aria-hidden="true" className="text-[color:var(--accent)]">*</span>
                  <span className="sr-only"> required</span>
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
              <h3 className="public-section-label">Service lane</h3>
              <p className="text-sm text-muted-foreground">
                Route the request to the right Nat Ford delivery lane before anyone creates a workspace.
              </p>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="request-service-lane" className="text-sm font-medium">
                  Which service lane do you need? <span aria-hidden="true" className="text-[color:var(--accent)]">*</span>
                  <span className="sr-only"> required</span>
                </label>
                <select
                  id="request-service-lane"
                  className="module-select"
                  value={form.serviceLane}
                  onChange={(event) => setForm((current) => updateField(current, "serviceLane", event.target.value))}
                  required
                >
                  <option value="">Select a service lane</option>
                  {ACCESS_REQUEST_SERVICE_LANE_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {ACCESS_REQUEST_SERVICE_LANE_LABELS[value]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="request-first-workflow" className="text-sm font-medium">
                  First workflow to stand up <span aria-hidden="true" className="text-[color:var(--accent)]">*</span>
                  <span className="sr-only"> required</span>
                </label>
                <select
                  id="request-first-workflow"
                  className="module-select"
                  value={form.desiredFirstWorkflow}
                  onChange={(event) => setForm((current) => updateField(current, "desiredFirstWorkflow", event.target.value))}
                  required
                >
                  <option value="">Select first workflow</option>
                  {ACCESS_REQUEST_FIRST_WORKFLOW_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {ACCESS_REQUEST_FIRST_WORKFLOW_LABELS[value]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="request-deployment-posture" className="text-sm font-medium">
                  Deployment posture <span className="text-xs text-muted-foreground">(optional)</span>
                </label>
                <select
                  id="request-deployment-posture"
                  className="module-select"
                  value={form.deploymentPosture}
                  onChange={(event) => setForm((current) => updateField(current, "deploymentPosture", event.target.value))}
                >
                  <option value="">Select if known</option>
                  {ACCESS_REQUEST_DEPLOYMENT_POSTURE_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {ACCESS_REQUEST_DEPLOYMENT_POSTURE_LABELS[value]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="request-data-sensitivity" className="text-sm font-medium">
                  Data sensitivity <span className="text-xs text-muted-foreground">(optional)</span>
                </label>
                <select
                  id="request-data-sensitivity"
                  className="module-select"
                  value={form.dataSensitivity}
                  onChange={(event) => setForm((current) => updateField(current, "dataSensitivity", event.target.value))}
                >
                  <option value="">Select if known</option>
                  {ACCESS_REQUEST_DATA_SENSITIVITY_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {ACCESS_REQUEST_DATA_SENSITIVITY_LABELS[value]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <label htmlFor="request-onboarding-needs" className="text-sm font-medium">
                  Onboarding needs <span className="text-xs text-muted-foreground">(optional)</span>
                </label>
                <Textarea
                  id="request-onboarding-needs"
                  rows={3}
                  placeholder="Example: import existing RTP tables, brief staff leads, configure public map comments, or review self-hosting constraints."
                  value={form.onboardingNeeds}
                  onChange={(event) => setForm((current) => updateField(current, "onboardingNeeds", event.target.value))}
                  maxLength={1200}
                />
                <div className="text-right text-xs text-muted-foreground">{form.onboardingNeeds.length}/1200 characters</div>
              </div>
            </div>
          </section>

          <section className="public-form-section">
            <div className="public-form-heading">
              <h3 className="public-section-label">Use case detail</h3>
              <p className="text-sm text-muted-foreground">
                A focused first use case makes it easier to decide whether the right path is self-hosted software, managed hosting, implementation help, or no-fit for now.
              </p>
            </div>

            <div className="mt-4 space-y-1.5">
              <label htmlFor="request-use-case" className="text-sm font-medium">
                What should OpenPlan help with first? <span aria-hidden="true" className="text-[color:var(--accent)]">*</span>
                <span className="sr-only"> required</span>
              </label>
              <Textarea
                id="request-use-case"
                rows={7}
                placeholder="Example: self-host OpenPlan for RTP project evidence, ask Nat Ford to host a grant-support workspace, configure engagement intake for an ATP update, or scope a custom reporting extension."
                value={form.useCase}
                onChange={(event) => setForm((current) => updateField(current, "useCase", event.target.value))}
                maxLength={2400}
                required
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>Include the planning lane, hosting preference, decision timeline, and any known data constraints.</span>
                <span>{form.useCase.length}/2400 characters</span>
              </div>
            </div>
          </section>
        </div>

        <aside className="public-form-rail">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ArrowRight className="h-4 w-4 text-[color:var(--accent)]" />
              Service lane review
            </h3>
            <ul className="public-bullet-list public-bullet-list--compact mt-3 text-sm text-muted-foreground">
              <li>Requests are triaged by service lane before a hosted workspace, implementation scope, or support commitment is created.</li>
              <li>No outbound message is sent automatically from this form.</li>
              <li>Self-hosting, managed-hosting billing, onboarding, and paid implementation remain separate supervised steps.</li>
            </ul>
          </div>

          <div className="public-note-block">
            <p className="public-section-label">Helpful detail</p>
            <p className="mt-2 text-sm text-muted-foreground">
              The most useful requests name one immediate workflow, data sensitivity, deployment posture, and the staff path
              needed to get from evaluation to production use.
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
            Submitting creates an internal intake record only; it does not create an account, hosted workspace, subscription, or services contract.
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
