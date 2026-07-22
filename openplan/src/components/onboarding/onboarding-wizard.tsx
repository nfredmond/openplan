"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ClipboardList, FileText, Loader2, MapPin, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Goal = {
  key: string;
  title: string;
  description: string;
  href: string;
  icon: typeof MapPin;
};

// The four first-run goals map onto the platform's core lanes. "Model any place"
// leads straight into the any-place study-area flow.
const GOALS: Goal[] = [
  {
    key: "model",
    title: "Model any place",
    description: "Run a travel-demand model for any US city, county, CDP, or metro area.",
    href: "/models",
    icon: MapPin,
  },
  {
    key: "engage",
    title: "Collect community input",
    description: "Launch a public, map-based engagement campaign and moderate what comes in.",
    href: "/engagement",
    icon: Users,
  },
  {
    key: "grants",
    title: "Find & write grants",
    description: "Track funding opportunities and draft AI narratives grounded in your data.",
    href: "/grants",
    icon: FileText,
  },
  {
    key: "rtp",
    title: "Build an RTP",
    description: "Start a Regional Transportation Plan cycle with a linked project portfolio.",
    href: "/rtp",
    icon: ClipboardList,
  },
];

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

  // The workspace already exists server-side; navigating re-renders the shell
  // with the new membership (leaving the not-provisioned state), then refresh
  // ensures fresh data on the destination.
  function goToGoal(href: string) {
    router.push(href);
    router.refresh();
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

            <div className="grid gap-3 sm:grid-cols-2">
              {GOALS.map((goal) => {
                const Icon = goal.icon;
                return (
                  <button
                    key={goal.key}
                    type="button"
                    onClick={() => goToGoal(goal.href)}
                    className="group flex flex-col gap-2 rounded-lg border border-border bg-background/60 p-4 text-left transition hover:border-primary/60 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex items-center justify-between">
                      <Icon className="h-5 w-5 text-primary" />
                      <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                    </span>
                    <span className="font-semibold text-foreground">{goal.title}</span>
                    <span className="text-xs text-muted-foreground">{goal.description}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => goToGoal("/dashboard")}
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
