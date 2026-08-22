"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Package, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  GuidedFlow,
  GuidedFlowRow,
  useGuidedFlow,
  type GuidedFlowStep,
} from "@/components/ui/guided-flow";
import {
  formatAerialPackageStatusLabel,
  formatAerialVerificationReadinessLabel,
  type AerialPackageStatus,
  type AerialVerificationReadiness,
} from "@/lib/aerial/catalog";

type PackageType = "measurable_output" | "qa_bundle" | "share_package";

const PACKAGE_TYPES: Array<{ value: PackageType; label: string }> = [
  { value: "measurable_output", label: "Measurable output" },
  { value: "qa_bundle", label: "QA bundle" },
  { value: "share_package", label: "Share package" },
];

const PACKAGE_STATUSES: AerialPackageStatus[] = ["processing", "qa_pending", "ready", "shared"];
const VERIFICATION_READINESS_OPTIONS: AerialVerificationReadiness[] = [
  "pending",
  "partial",
  "ready",
  "not_applicable",
];

type PackageValues = {
  missionId: string;
  title: string;
  packageType: PackageType;
  status: AerialPackageStatus;
  verificationReadiness: AerialVerificationReadiness;
  notes: string;
};

const selectClassName = "module-select";

/**
 * Logging what a flight produced, as a flow rather than six fields open on the
 * project page beside the mission form.
 *
 * WHAT DID NOT CHANGE. Same POST to `/api/aerial/evidence-packages`, same keys,
 * same `"" → undefined` on the notes, and it still does NOT navigate: a package
 * belongs to the project being read, so the flow closes and the page refreshes
 * underneath. The confirmation moved onto the panel for the same reason it did
 * on the mission creator — the flow closes on success and would take the
 * message with it.
 */
export function AerialEvidencePackageCreator({
  missionOptions,
  defaultMissionId,
}: {
  missionOptions: Array<{ id: string; title: string }>;
  defaultMissionId?: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  const steps = useMemo<GuidedFlowStep<PackageValues>[]>(
    () => [
      {
        id: "what",
        title: "What did the flight produce?",
        hint: "Which mission it came from, and what to call it.",
        fields: [
          {
            name: "missionId",
            label: "a mission",
            required: true,
            requiredMessage: "Choose the mission this package came from.",
          },
          {
            name: "title",
            label: "a name",
            required: true,
            requiredMessage: "Give the package a name before you log it.",
          },
          { name: "packageType", label: "a package type" },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="missionId" label="Mission">
              <select className={selectClassName} {...flow.text("missionId")}>
                {missionOptions.map((mission) => (
                  <option key={mission.id} value={mission.id}>
                    {mission.title}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="title" label="Package name">
              <Input {...flow.text("title")} placeholder="SR 49 orthomosaic and volumes" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="packageType" label="What kind of package?">
              <select className={selectClassName} {...flow.text("packageType")}>
                {PACKAGE_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>
          </>
        ),
      },
      {
        id: "state",
        title: "Where is it up to?",
        hint: "Both can change as the package moves through QA.",
        fields: [
          { name: "status", label: "a status" },
          { name: "verificationReadiness", label: "a verification readiness" },
          { name: "notes", label: "notes" },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="status" label="Status">
              <select className={selectClassName} {...flow.text("status")}>
                {PACKAGE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {formatAerialPackageStatusLabel(status)}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>

            <GuidedFlowRow
              flow={flow}
              name="verificationReadiness"
              label="How ready is it to be verified?"
            >
              <select className={selectClassName} {...flow.text("verificationReadiness")}>
                {VERIFICATION_READINESS_OPTIONS.map((readiness) => (
                  <option key={readiness} value={readiness}>
                    {formatAerialVerificationReadinessLabel(readiness)}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="notes" label="Anything to note?">
              <Textarea
                {...flow.text("notes")}
                placeholder="What is in the package, what is still missing, or what it should be used for."
              />
            </GuidedFlowRow>
          </>
        ),
      },
    ],
    [missionOptions]
  );

  const flow = useGuidedFlow<PackageValues>({
    id: "log-evidence-package",
    title: "Log evidence package",
    submitLabel: "Log the package",
    initialValues: {
      missionId: defaultMissionId ?? missionOptions[0]?.id ?? "",
      title: "",
      packageType: "measurable_output",
      status: "processing",
      verificationReadiness: "pending",
      notes: "",
    },
    steps,
    onSubmit: async (values) => {
      // Unchanged from the inline form, deliberately: same route, same keys.
      const response = await fetch("/api/aerial/evidence-packages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          missionId: values.missionId,
          title: values.title,
          packageType: values.packageType,
          status: values.status,
          verificationReadiness: values.verificationReadiness,
          notes: values.notes || undefined,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create evidence package");
      }

      setMessage("Evidence package logged.");
      router.refresh();
    },
  });

  return (
    <article className="rounded-[0.5rem] border border-border/70 bg-background/80 p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-[0.5rem] bg-violet-500/12 text-violet-700 dark:text-violet-300">
          <Package className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Evidence package
          </p>
          <h3 className="text-sm font-semibold text-foreground">Log evidence package</h3>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={() => {
            setMessage(null);
            flow.open();
          }}
          data-testid="evidence-package-creator-open"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Log a package
        </Button>
        {message ? (
          <p
            className="text-sm text-emerald-700 dark:text-emerald-300"
            data-testid="evidence-package-logged"
          >
            {message}
          </p>
        ) : null}
      </div>

      <GuidedFlow flow={flow} />
    </article>
  );
}
