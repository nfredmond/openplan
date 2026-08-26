import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { FirstRunChecklist } from "@/components/onboarding/first-run-checklist";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

/**
 * The branches the dashboard page test cannot reach, because the page always
 * supplies the same combination: a geography whose source recorded no display
 * name, an outstanding geography step with the picker mounted elsewhere, and a
 * workspace that already has runs.
 */
describe("FirstRunChecklist", () => {
  it("does not call a failed home-place read an empty setting", () => {
    render(
      <FirstRunChecklist
        aiKeyConfigured
        homeGeographyIsSet={false}
        homeGeographyUnreadable
        homeGeographyLabel={null}
        hasRuns
        canManageWorkspace
      />
    );

    expect(screen.getByText(/Could not check where this agency works/)).toBeInTheDocument();
    expect(screen.queryByText(/Not set\./)).not.toBeInTheDocument();
    expect(screen.getAllByText("Optional").length).toBeGreaterThan(0);
  });

  it("treats a geography with no recorded place name as set, without inventing one", () => {
    render(
      <FirstRunChecklist
        aiKeyConfigured
        homeGeographyIsSet
        homeGeographyLabel={null}
        hasRuns={false}
        canManageWorkspace
      />
    );

    expect(screen.getByText("Set. The source recorded no place name for it.")).toBeInTheDocument();
    // AI key + geography are both done; nothing outstanding carries emphasis.
    expect(screen.getAllByText("Done")).toHaveLength(2);
    expect(screen.queryByText("Start here")).not.toBeInTheDocument();
  });

  it("points at workspace setup when the picker is not mounted here", () => {
    render(
      <FirstRunChecklist
        aiKeyConfigured={false}
        homeGeographyIsSet={false}
        homeGeographyLabel={null}
        hasRuns={false}
        canManageWorkspace
      />
    );

    expect(
      screen.getByText("Not set. Choose it in Workspace setup & health.")
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open where-you-work setting" })).toHaveAttribute(
      "href",
      "/workspace",
    );
  });

  it("mounts the supplied geography setter under the step that asks for it", () => {
    render(
      <FirstRunChecklist
        aiKeyConfigured={false}
        homeGeographyIsSet={false}
        homeGeographyLabel={null}
        hasRuns={false}
        canManageWorkspace
      >
        <div data-testid="geography-setter" />
      </FirstRunChecklist>
    );

    const step = screen.getByText("Tell OpenPlan where you work").closest("li");
    expect(step).not.toBeNull();
    expect(step).toContainElement(screen.getByTestId("geography-setter"));
  });

  it("marks the screening step done and drops its call to action once runs exist", () => {
    render(
      <FirstRunChecklist
        aiKeyConfigured
        homeGeographyIsSet
        homeGeographyLabel="Example County, Example State"
        hasRuns
        canManageWorkspace={false}
      />
    );

    expect(screen.getByText("This workspace has saved analysis runs.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Open Corridor Analysis/ })).not.toBeInTheDocument();
    // Three done steps (AI key, geography, screening), and no invite step for
    // a non-manager.
    expect(screen.getAllByText("Done")).toHaveLength(3);
    expect(screen.queryByText("Invite your team")).not.toBeInTheDocument();
  });

  it("keeps the screening claim screening-grade", () => {
    render(
      <FirstRunChecklist
        aiKeyConfigured={false}
        homeGeographyIsSet={false}
        homeGeographyLabel={null}
        hasRuns={false}
        canManageWorkspace
      />
    );

    expect(
      screen.getByText(/Results are screening-grade — they support prioritization and narrative, not final engineering\./)
    ).toBeInTheDocument();
  });

  describe("AI assistant step", () => {
    it("leads with the AI step, shows it outstanding without a key, and names what stays off", () => {
      render(
        <FirstRunChecklist
          aiKeyConfigured={false}
          homeGeographyIsSet={false}
          homeGeographyLabel={null}
          hasRuns={false}
          canManageWorkspace
        />
      );

      const step = screen.getByText("Turn on your AI assistant").closest("li");
      expect(step).not.toBeNull();
      // First incomplete step in display order carries the one emphasis.
      expect(screen.getAllByText("Start here")).toHaveLength(1);
      expect(step!.textContent).toContain("Start here");
      expect(step!.textContent).not.toContain("Done");
      // What stays off, and who pays whom: the four AI features by name, and
      // the free-product / provider-billing sentence.
      expect(step!.textContent).toMatch(
        /Without a key, the Planner Agent, AI synthesis of public comments, narrative drafting, and comment translation are unavailable/
      );
      expect(step!.textContent).toMatch(
        /OpenPlan itself is free — the key is your workspace's own account with the AI provider, and usage is billed by that provider, not by OpenPlan\./
      );
      // The step is deep-linkable: the copilot's no-key notice points here.
      expect(step!.id).toBe("workspace-ai-key");
    });

    it("marks the step done when a key resolves, without asking for anything", () => {
      render(
        <FirstRunChecklist
          aiKeyConfigured
          homeGeographyIsSet={false}
          homeGeographyLabel={null}
          hasRuns={false}
          canManageWorkspace
        />
      );

      const step = screen.getByText("Turn on your AI assistant").closest("li");
      expect(step!.textContent).toContain("Done");
      expect(
        screen.getByText("On — an AI key is available to this workspace.")
      ).toBeInTheDocument();
      // With the AI key done, the emphasis falls through to the geography.
      const geographyStep = screen.getByText("Tell OpenPlan where you work").closest("li");
      expect(geographyStep!.textContent).toContain("Start here");
    });

    it("mounts the supplied key control under the step while it is outstanding, and drops it once done", () => {
      const { rerender } = render(
        <FirstRunChecklist
          aiKeyConfigured={false}
          homeGeographyIsSet={false}
          homeGeographyLabel={null}
          hasRuns={false}
          canManageWorkspace
          aiKeyControl={<div data-testid="ai-key-control" />}
        />
      );

      const step = screen.getByText("Turn on your AI assistant").closest("li");
      expect(step).toContainElement(screen.getByTestId("ai-key-control"));
      expect(
        screen.getByText("Not on yet. Paste your workspace's Anthropic API key below.")
      ).toBeInTheDocument();

      rerender(
        <FirstRunChecklist
          aiKeyConfigured
          homeGeographyIsSet={false}
          homeGeographyLabel={null}
          hasRuns={false}
          canManageWorkspace
          aiKeyControl={<div data-testid="ai-key-control" />}
        />
      );
      expect(screen.queryByTestId("ai-key-control")).not.toBeInTheDocument();
    });

    it("tells a plain member who can add the key, instead of offering a control they cannot use", () => {
      render(
        <FirstRunChecklist
          aiKeyConfigured={false}
          homeGeographyIsSet={false}
          homeGeographyLabel={null}
          hasRuns={false}
          canManageWorkspace={false}
        />
      );

      expect(
        screen.getByText("Not on yet. A workspace owner or admin can add the key.")
      ).toBeInTheDocument();
    });

    it("never blocks the rest of the checklist while the key is missing", () => {
      render(
        <FirstRunChecklist
          aiKeyConfigured={false}
          homeGeographyIsSet={false}
          homeGeographyLabel={null}
          hasRuns={false}
          canManageWorkspace
        >
          <div data-testid="geography-setter" />
        </FirstRunChecklist>
      );

      // Every other step still renders, with its own working affordance.
      expect(screen.getByText("Tell OpenPlan where you work")).toBeInTheDocument();
      expect(screen.getByTestId("geography-setter")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Open Corridor Analysis/ })).toHaveAttribute(
        "href",
        "/explore"
      );
      expect(screen.getByRole("link", { name: /Open the team panel/ })).toBeInTheDocument();
    });
  });

  describe("engagement intent", () => {
    it("adds the campaign step and emphasizes it once the AI key and geography are set", () => {
      render(
        <FirstRunChecklist
          aiKeyConfigured
          homeGeographyIsSet
          homeGeographyLabel="Example County, Example State"
          hasRuns={false}
          canManageWorkspace
          intent="engagement"
          engagementCampaignCount={0}
        />
      );

      expect(screen.getByText("Start a public comment campaign")).toBeInTheDocument();
      expect(screen.getByText("No campaigns yet.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Open Engagement/ })).toHaveAttribute(
        "href",
        "/engagement"
      );
      // Exactly one step carries emphasis, and with the geography done it is
      // the thing the person said they came for.
      expect(screen.getAllByText("Start here")).toHaveLength(1);
      const step = screen.getByText("Start a public comment campaign").closest("li");
      expect(step).not.toBeNull();
      expect(step!.textContent).toContain("Start here");
    });

    it("never claims the step is done when campaigns could not be counted", () => {
      render(
        <FirstRunChecklist
          aiKeyConfigured
          homeGeographyIsSet
          homeGeographyLabel="Example County, Example State"
          hasRuns={false}
          canManageWorkspace
          intent="engagement"
          engagementCampaignCount={null}
        />
      );

      expect(
        screen.getByText(/Campaigns could not be counted just now, so this step makes no claim either way\./)
      ).toBeInTheDocument();
      const step = screen.getByText("Start a public comment campaign").closest("li");
      expect(step!.textContent).not.toContain("Done");
    });

    it("marks the step done on an observed campaign count", () => {
      render(
        <FirstRunChecklist
          aiKeyConfigured
          homeGeographyIsSet
          homeGeographyLabel="Example County, Example State"
          hasRuns={false}
          canManageWorkspace
          intent="engagement"
          engagementCampaignCount={2}
        />
      );

      expect(screen.getByText("This workspace has engagement campaigns.")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /Open Engagement/ })).not.toBeInTheDocument();
    });

    it("keeps the geography as the emphasized step while it is unset and the AI key is done", () => {
      render(
        <FirstRunChecklist
          aiKeyConfigured
          homeGeographyIsSet={false}
          homeGeographyLabel={null}
          hasRuns={false}
          canManageWorkspace
          intent="engagement"
          engagementCampaignCount={0}
        />
      );

      expect(screen.getAllByText("Start here")).toHaveLength(1);
      const geographyStep = screen.getByText("Tell OpenPlan where you work").closest("li");
      expect(geographyStep!.textContent).toContain("Start here");
    });

    it("shows no campaign step without the intent", () => {
      render(
        <FirstRunChecklist
          aiKeyConfigured={false}
          homeGeographyIsSet={false}
          homeGeographyLabel={null}
          hasRuns={false}
          canManageWorkspace
        />
      );

      expect(screen.queryByText("Start a public comment campaign")).not.toBeInTheDocument();
    });
  });
});
