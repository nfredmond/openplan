"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OnboardingGoals } from "@/components/onboarding/onboarding-goals";

/**
 * No-workspace fallback: normally the handle_new_user DB trigger auto-provisions
 * a workspace on sign-up, so a new user lands on the dashboard already provisioned
 * (see the dashboard first-run hero). This wizard only appears in the rare
 * not-provisioned case (e.g. a revoked membership), and lets the user self-create.
 */
export function OnboardingWizard({ defaultWorkspaceName = "" }: { defaultWorkspaceName?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"name" | "goal">("name");
  const [workspaceName, setWorkspaceName] = useState(defaultWorkspaceName);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdName, setCreatedName] = useState<string | null>(null);

  async function createWorkspace() {
    const name = workspaceName.trim();
    if (!name) {
      setError("Enter a name for your workspace or agency.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/workspaces/bootstrap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceName: name }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data?.error || "Failed to create your workspace");
      setCreatedName(name);
      setStep("goal");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create your workspace");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="rounded-xl border border-border bg-background/85 p-6 shadow-sm backdrop-blur-sm sm:p-8">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          Welcome to OpenPlan
        </div>

        {step === "name" ? (
          <div className="mt-3 space-y-5">
            <div>
              <h1 className="text-xl font-semibold text-foreground">Set up your workspace</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                A workspace is your agency&apos;s home for projects, models, engagement, grants, and reports. Name it to
                get started — you can invite teammates later.
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="onboarding-workspace-name" className="text-[0.82rem] font-semibold">
                Workspace or agency name
              </label>
              <Input
                id="onboarding-workspace-name"
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !creating) void createWorkspace();
                }}
                placeholder="e.g. City of Davis Public Works, or Yolo County TC"
                autoFocus
                maxLength={120}
              />
            </div>

            {error ? <p className="text-sm text-red-600 dark:text-red-300">{error}</p> : null}

            <Button type="button" onClick={() => void createWorkspace()} disabled={creating || !workspaceName.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Create workspace
            </Button>
          </div>
        ) : (
          <div className="mt-3 space-y-5">
            <div>
              <h1 className="text-xl font-semibold text-foreground">
                {createdName ? `“${createdName}” is ready.` : "Your workspace is ready."}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">What do you want to do first? You can do all of it later.</p>
            </div>

            <OnboardingGoals />

            <button
              type="button"
              onClick={() => {
                router.push("/dashboard");
                router.refresh();
              }}
              className="text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Or just explore the dashboard →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
