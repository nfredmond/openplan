import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  MapPin,
  MessageSquareShare,
  Radar,
  Sparkles,
  Users,
} from "lucide-react";
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
   * The step's own affordance, when it is a link. The AI-key and geography
   * steps deliberately have none: their controls are mounted in `children`, so
   * a link would be a second route to the thing already on screen.
   */
  action?: { href: string; label: string };
  /**
   * Raise this step above the others. Exactly one step should carry it: the
   * first outstanding one.
   */
  emphasis?: boolean;
  /**
   * A stable fragment id on the step itself, so other surfaces (the copilot's
   * no-key notice) can deep-link straight to it.
   */
  anchorId?: string;
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
  anchorId,
  children,
}: FirstRunStepProps) {
  const done = status === "done";

  return (
    <li
      id={anchorId}
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
   * Whether an AI (Anthropic) key resolves for this workspace — a key the
   * workspace stored itself OR the deployment's own environment key, resolved
   * server-side with the same helper every AI route uses
   * (`hasAnthropicAccess` inside `withWorkspaceIntegrationContext`). Only this
   * boolean crosses to the client; the key itself never does.
   */
  aiKeyConfigured: boolean;
  /**
   * Whether the workspace has stated a home geography at all. Read from the
   * row, not from the label: the schema allows a resolved geography whose
   * source recorded no display name, and that is still set.
   */
  homeGeographyIsSet: boolean;
  /** True when the home-place read failed, which must never be restated as unset. */
  homeGeographyUnreadable?: boolean;
  /** The place name the resolver recorded, when it recorded one. Never a fallback. */
  homeGeographyLabel: string | null;
  /** True once this workspace has at least one saved analysis run. */
  hasRuns: boolean;
  /**
   * True when the runs query FAILED, as distinct from a workspace that has no
   * runs. Without it this step said "No analysis runs yet." directly above four
   * tiles reading "Could not load" — one page making two contradictory claims
   * about the same failed read. `hasRuns` is derived from the returned rows,
   * which are an empty array on failure, so it cannot tell the two apart on its
   * own.
   */
  runsUnreadable?: boolean;
  /** Owner/admin — the only roles the geography and invitation APIs accept. */
  canManageWorkspace: boolean;
  /**
   * What the person said they came for, carried from the public landing page
   * through sign-up as a query parameter — never stored. "engagement" adds a
   * public-comment-campaign step right after the geography, because that is
   * the first thing they were promised. "modeling" needs no extra step: the
   * screening step already is that path. Anything else reads as null.
   */
  intent?: "modeling" | "engagement" | null;
  /**
   * How many engagement campaigns this workspace has, when the page's
   * operations summary could measure it — null when it could not. The
   * engagement step only claims to be done on an observed count, never on a
   * failed read (rule 1 above).
   */
  engagementCampaignCount?: number | null;
  /**
   * The Anthropic key-entry control (the integration-keys panel filtered to
   * its Anthropic row), mounted under the AI step while it is outstanding so
   * the control sits under the step that asks for it. Same hoisting rule as
   * `children`: mount each control in exactly one place.
   */
  aiKeyControl?: ReactNode;
  /**
   * The geography setter itself, mounted here while the geography step is
   * outstanding so the control sits under the step that asks for it. Mount it
   * in exactly one place: the panel self-fetches, and two mounts would mean
   * two requests and two answers.
   */
  children?: ReactNode;
};

export function FirstRunChecklist({
  aiKeyConfigured,
  homeGeographyIsSet,
  homeGeographyUnreadable = false,
  homeGeographyLabel,
  hasRuns,
  runsUnreadable = false,
  canManageWorkspace,
  intent = null,
  engagementCampaignCount = null,
  aiKeyControl,
  children,
}: FirstRunChecklistProps) {
  const geographyPickerIsHere = Boolean(children);
  const aiKeyControlIsHere = Boolean(aiKeyControl);
  const showEngagementStep = intent === "engagement";
  // Done only on an observed count. A null count means the read did not land,
  // and a step that cannot be observed carries no completion claim — it renders
  // unmarked, exactly like the team step.
  const engagementStatus: StepStatus =
    engagementCampaignCount !== null && engagementCampaignCount > 0
      ? "done"
      : engagementCampaignCount === 0
        ? "todo"
        : "optional";
  // Exactly one step may carry emphasis: the first incomplete one in display
  // order. The AI key leads (Nathaniel's decision 2026-08-10: key entry at the
  // very beginning), then geography, then the intent-driven engagement step.
  // Emphasis never gates anything — every step stays usable regardless.
  const emphasizeAiKey = !aiKeyConfigured;
  const emphasizeGeography = aiKeyConfigured && !homeGeographyIsSet && !homeGeographyUnreadable;
  const emphasizeEngagement =
    showEngagementStep &&
    aiKeyConfigured &&
    homeGeographyIsSet &&
    engagementStatus !== "done";
  const geographyIndex = 2;
  const screeningIndex = showEngagementStep ? 4 : 3;
  const teamIndex = screeningIndex + 1;

  const aiKeyState = aiKeyConfigured
    ? "On — an AI key is available to this workspace."
    : canManageWorkspace
      ? aiKeyControlIsHere
        ? "Not on yet. Paste your workspace's Anthropic API key below."
        : "Not on yet. Add an Anthropic key in Workspace setup & health."
      : "Not on yet. A workspace owner or admin can add the key.";

  const geographyState = homeGeographyUnreadable
    ? "Could not check where this agency works just now. That failed read is not the same as this setting being empty."
    : homeGeographyIsSet
    ? homeGeographyLabel
      ? `Set to ${homeGeographyLabel}.`
      : "Set. The source recorded no place name for it."
    : canManageWorkspace
      ? geographyPickerIsHere
        ? "Not set. Choose the county, city, CDP, or metro area you plan for, below."
        : "Not set. Choose it in Workspace setup & health."
      : "Not set. A workspace owner or admin can set it.";

  return (
    <ol className="mt-4 space-y-3">
      {/* First on purpose. Without a key nothing blocks — every other step and
          the whole app stay usable — but the AI features are simply off, and
          the honest move is to say that at the very beginning rather than let
          a planner discover it mid-conversation with a silent copilot. */}
      <FirstRunStep
        index={1}
        icon={Sparkles}
        title="Turn on your AI assistant"
        status={aiKeyConfigured ? "done" : "todo"}
        emphasis={emphasizeAiKey}
        anchorId="workspace-ai-key"
        state={aiKeyState}
        unlocks={
          aiKeyConfigured
            ? "The Planner Agent, AI synthesis of public comments, narrative drafting, and comment translation all run on this key. OpenPlan itself is free — the key is your workspace's own account with the AI provider, and usage is billed by that provider, not by OpenPlan."
            : "Without a key, the Planner Agent, AI synthesis of public comments, narrative drafting, and comment translation are unavailable — everything else in OpenPlan still works. OpenPlan itself is free — the key is your workspace's own account with the AI provider, and usage is billed by that provider, not by OpenPlan."
        }
        action={
          !aiKeyConfigured && canManageWorkspace && !aiKeyControlIsHere
            ? { href: "/workspace#workspace-integrations", label: "Open integration setup" }
            : undefined
        }
      >
        {aiKeyConfigured ? null : aiKeyControl}
      </FirstRunStep>

      <FirstRunStep
        index={geographyIndex}
        icon={MapPin}
        title="Tell OpenPlan where you work"
        status={homeGeographyUnreadable ? "optional" : homeGeographyIsSet ? "done" : "todo"}
        emphasis={emphasizeGeography}
        state={geographyState}
        unlocks={
          homeGeographyIsSet
            ? "Maps, jurisdiction rules, equity data, and study-area defaults across OpenPlan all read this one setting."
            : "Maps, jurisdiction rules, equity data, and study-area defaults across OpenPlan all read this one setting. Until it is set, maps open on a neutral continental view, no jurisdiction-specific stage-gate rules are bound, and equity layers stay empty."
        }
        action={
          !homeGeographyIsSet && canManageWorkspace && !geographyPickerIsHere
            ? { href: "/workspace", label: "Open where-you-work setting" }
            : undefined
        }
      >
        {children}
      </FirstRunStep>

      {/* Only for people who arrived saying they came to collect public
          comments — it puts the thing they were promised right after the one
          setting it depends on. */}
      {showEngagementStep ? (
        <FirstRunStep
          index={3}
          icon={MessageSquareShare}
          title="Start a public comment campaign"
          status={engagementStatus}
          emphasis={emphasizeEngagement}
          state={
            engagementStatus === "done"
              ? "This workspace has engagement campaigns."
              : engagementStatus === "todo"
                ? "No campaigns yet."
                : "Campaigns could not be counted just now, so this step makes no claim either way."
          }
          unlocks="Publish a map or survey where residents drop a pin and tell you what they see. Nothing a resident writes appears publicly until you approve it, and what you collect stays attached to the project when you write it up."
          action={
            engagementStatus === "done" ? undefined : { href: "/engagement", label: "Open Engagement" }
          }
        />
      ) : null}

      <FirstRunStep
        index={screeningIndex}
        icon={Radar}
        title="Run your first screening"
        status={runsUnreadable ? "todo" : hasRuns ? "done" : "todo"}
        state={
          runsUnreadable
            ? "Could not check whether this workspace has any runs — that read failed. It is not the same as having none."
            : hasRuns
              ? "This workspace has saved analysis runs."
              : "No analysis runs yet."
        }
        unlocks="Corridor Analysis scores a corridor or study area against the open data available for it and saves the run to this workspace, where reports, comparisons, and grant narratives can draw on it. Results are screening-grade — they support prioritization and narrative, not final engineering."
        action={hasRuns ? undefined : { href: "/explore", label: "Open Corridor Analysis" }}
      />

      {/* Owner/admin only: the invitation API refuses everyone else, so showing
          this to a member would be an instruction they cannot follow. It carries
          NO completion marker on purpose — `workspace_members` RLS lets a caller
          read only their own row, so this page genuinely cannot see whether a
          team exists, and an unchecked box would claim otherwise. */}
      {canManageWorkspace ? (
        <FirstRunStep
          index={teamIndex}
          icon={Users}
          title="Invite your team"
          status="optional"
          state="A workspace works fine alone, and teammates can join at any time."
          unlocks="Everyone you invite works in this same workspace — the same projects, runs, engagement campaigns, and packets — with the role you give them. Invitations are links you send yourself; OpenPlan does not email them."
          action={{ href: "/workspace#workspace-team", label: "Open the team panel" }}
        />
      ) : null}
    </ol>
  );
}
