import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, CheckCircle2, Circle, MapPin, Radar, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The first-run checklist a brand-new workspace lands on.
 *
 * WHY IT REPLACED A GOAL PICKER
 *   The dashboard used to greet a new agency with four navigation cards that
 *   only called `router.push()`. Nothing on them was stateful, so they could
 *   not tell a workspace that had configured nothing from one that had
 *   configured everything — and none of them mentioned the single setting the
 *   rest of the app reads: the workspace's HOME GEOGRAPHY. A planner could
 *   click all four, land in four modules, and still have a workspace that did
 *   not know where it was.
 *
 * WHAT THIS IS INSTEAD
 *   A checklist of REAL STATE. Every marker here is derived from data the page
 *   read server-side, never from "did you visit this route". Two rules follow
 *   from that and are load-bearing:
 *
 *   1. NEVER ASSERT A STEP IS DONE UNLESS THE DATA SAYS SO. A step this page
 *      cannot observe does not get a checkbox at all — see the team step, whose
 *      completion is genuinely unreadable from here (`workspace_members` RLS
 *      lets a caller read only their OWN row, so a count would always be 1 and
 *      always be a lie). It is presented as an optional action, unmarked.
 *
 *   2. STATE WHAT EACH STEP UNLOCKS, IN CONSEQUENCES. "Set your geography" is
 *      an instruction; "until it is set, maps open on a neutral continental
 *      view and no jurisdiction rules are bound" is a reason. The geography
 *      wording deliberately mirrors `WorkspaceGeographyPanel`, which is the
 *      control this step points at — two different accounts of the same setting
 *      would be two things to keep true.
 *
 * NO PLACE IS NAMED ANYWHERE IN THIS FILE. The only place name that can appear
 * is `homeGeographyLabel`, which the workspace itself recorded through the
 * any-place picker.
 */

type StepStatus = "done" | "todo" | "optional";

type FirstRunStepProps = {
  index: number;
  icon: LucideIcon;
  title: string;
  status: StepStatus;
  /** What is true right now — the observed state, in a sentence. */
  state: string;
  /** What this step turns on, and what stays off until it is done. */
  unlocks: string;
  /**
   * The step's own affordance, when it is a link. Step one deliberately has
   * none: its control (`WorkspaceGeographyPanel`) is mounted in `children`, so
   * a link would be a second route to the thing already on screen.
   */
  action?: { href: string; label: string };
  /**
   * Raise this step above the others. Exactly one step should carry it: the
   * outstanding one that blocks the rest of the workspace.
   */
  emphasis?: boolean;
  children?: ReactNode;
};

function statusLabel(status: StepStatus, emphasis: boolean): string {
  if (status === "done") return "Done";
  if (status === "optional") return "Optional";
  return emphasis ? "Start here" : "Next";
}

function FirstRunStep({
  index,
  icon: Icon,
  title,
  status,
  state,
  unlocks,
  action,
  emphasis = false,
  children,
}: FirstRunStepProps) {
  const done = status === "done";

  return (
    <li
      className={[
        "rounded-lg border p-4",
        emphasis
          ? "border-primary/50 bg-background shadow-sm"
          : "border-border/70 bg-background/60",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <span
          className={[
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[0.75rem] font-bold",
            done
              ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : emphasis
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border text-muted-foreground",
          ].join(" ")}
          aria-hidden="true"
        >
          {done ? <CheckCircle2 className="h-4 w-4" /> : status === "optional" ? <Circle className="h-3.5 w-3.5" /> : index}
        </span>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <h3 className={emphasis ? "text-base font-semibold text-foreground" : "text-sm font-semibold text-foreground"}>
              {title}
            </h3>
            <span
              className={[
                "rounded-full border px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.12em]",
                done
                  ? "border-emerald-600/30 text-emerald-700 dark:text-emerald-300"
                  : emphasis
                    ? "border-primary/40 text-primary"
                    : "border-border text-muted-foreground",
              ].join(" ")}
            >
              {statusLabel(status, emphasis)}
            </span>
          </div>

          <p className={emphasis ? "text-sm font-medium text-foreground" : "text-sm text-foreground/90"}>{state}</p>
          <p className="text-xs leading-5 text-muted-foreground">{unlocks}</p>

          {action ? (
            <Link
              href={action.href}
              className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
            >
              {action.label}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : null}

          {children ? <div className="pt-2">{children}</div> : null}
        </div>
      </div>
    </li>
  );
}

export type FirstRunChecklistProps = {
  /**
   * Whether the workspace has stated a home geography at all. Read from the
   * row, not from the label: the schema allows a resolved geography whose
   * source recorded no display name, and that is still set.
   */
  homeGeographyIsSet: boolean;
  /** The place name the resolver recorded, when it recorded one. Never a fallback. */
  homeGeographyLabel: string | null;
  /** True once this workspace has at least one saved analysis run. */
  hasRuns: boolean;
  /** Owner/admin — the only roles the geography and invitation APIs accept. */
  canManageWorkspace: boolean;
  /**
   * The geography setter itself, mounted here while step one is outstanding so
   * the control sits under the step that asks for it. Mount it in exactly one
   * place: the panel self-fetches, and two mounts would mean two requests and
   * two answers.
   */
  children?: ReactNode;
};

export function FirstRunChecklist({
  homeGeographyIsSet,
  homeGeographyLabel,
  hasRuns,
  canManageWorkspace,
  children,
}: FirstRunChecklistProps) {
  const geographyPickerIsHere = Boolean(children);

  const geographyState = homeGeographyIsSet
    ? homeGeographyLabel
      ? `Set to ${homeGeographyLabel}.`
      : "Set. The source recorded no place name for it."
    : canManageWorkspace
      ? geographyPickerIsHere
        ? "Not set. Choose the county, city, CDP, or metro area you plan for, below."
        : "Not set. Choose it in the workspace geography panel on this page."
      : "Not set. A workspace owner or admin can set it.";

  return (
    <ol className="mt-4 space-y-3">
      <FirstRunStep
        index={1}
        icon={MapPin}
        title="Tell OpenPlan where you work"
        status={homeGeographyIsSet ? "done" : "todo"}
        emphasis={!homeGeographyIsSet}
        state={geographyState}
        unlocks={
          homeGeographyIsSet
            ? "Maps, jurisdiction rules, equity data, and study-area defaults across OpenPlan all read this one setting."
            : "Maps, jurisdiction rules, equity data, and study-area defaults across OpenPlan all read this one setting. Until it is set, maps open on a neutral continental view, no jurisdiction-specific stage-gate rules are bound, and equity layers stay empty."
        }
      >
        {children}
      </FirstRunStep>

      <FirstRunStep
        index={2}
        icon={Radar}
        title="Run your first screening"
        status={hasRuns ? "done" : "todo"}
        state={
          hasRuns
            ? "This workspace has saved analysis runs."
            : "No analysis runs yet."
        }
        unlocks="Analysis Studio scores a corridor or study area against the open data available for it and saves the run to this workspace, where reports, comparisons, and grant narratives can draw on it. Results are screening-grade — they support prioritization and narrative, not final engineering."
        action={hasRuns ? undefined : { href: "/explore", label: "Open Analysis Studio" }}
      />

      {/* Owner/admin only: the invitation API refuses everyone else, so showing
          this to a member would be an instruction they cannot follow. It carries
          NO completion marker on purpose — `workspace_members` RLS lets a caller
          read only their own row, so this page genuinely cannot see whether a
          team exists, and an unchecked box would claim otherwise. */}
      {canManageWorkspace ? (
        <FirstRunStep
          index={3}
          icon={Users}
          title="Invite your team"
          status="optional"
          state="A workspace works fine alone, and teammates can join at any time."
          unlocks="Everyone you invite works in this same workspace — the same projects, runs, engagement campaigns, and packets — with the role you give them. Invitations are links you send yourself; OpenPlan does not email them."
          action={{ href: "#workspace-team", label: "Open the team panel" }}
        />
      ) : null}
    </ol>
  );
}
