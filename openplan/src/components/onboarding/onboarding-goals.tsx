"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, ClipboardList, FileText, MapPin, Users } from "lucide-react";

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
    description: "Create a travel-demand model, then run it for any US city, town, CDP, county, or metro area.",
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

/**
 * The shared first-run goal cards. Used by both the onboarding wizard (rare
 * no-workspace fallback) and the dashboard first-run hero (the common path, where
 * a new user lands on an auto-provisioned but empty workspace).
 */
export function OnboardingGoals() {
  const router = useRouter();

  // The workspace already exists; navigating re-renders with fresh data.
  function goToGoal(href: string) {
    router.push(href);
    router.refresh();
  }

  return (
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
  );
}
