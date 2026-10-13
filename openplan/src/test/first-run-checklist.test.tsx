import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { FirstRunChecklist } from "@/components/onboarding/first-run-checklist";
import { AI_KEY_FEATURES } from "@/lib/help/ai-key-features";

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
        projectCount={1}
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
        projectCount={1}
        aiKeyConfigured
        homeGeographyIsSet
        homeGeographyLabel={null}
        hasRuns={false}
        canManageWorkspace
      />
    );

    expect(screen.getByText("Set. The source recorded no place name for it.")).toBeInTheDocument();
    // Project, geography and AI key are done; nothing outstanding carries emphasis.
    expect(screen.getAllByText("Done")).toHaveLength(3);
    expect(screen.queryByText("Start here")).not.toBeInTheDocument();
  });

  it("points at workspace setup when the picker is not mounted here", () => {
    render(
      <FirstRunChecklist
        projectCount={1}
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
        projectCount={1}
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
        projectCount={1}
        aiKeyConfigured
        homeGeographyIsSet
        homeGeographyLabel="Example County, Example State"
        hasRuns
        canManageWorkspace={false}
      />
    );

    expect(screen.getByText("This workspace has saved analysis runs.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Open Corridor Analysis/ })).not.toBeInTheDocument();
    // Four done steps (project, geography, screening, AI key), and no invite
    // step for a non-manager.
    expect(screen.getAllByText("Done")).toHaveLength(4);
    expect(screen.queryByText("Invite your team")).not.toBeInTheDocument();
  });

  it("keeps the screening claim screening-grade", () => {
    render(
      <FirstRunChecklist
        projectCount={1}
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
    it("marks the AI step optional, never emphasized, and names what stays off", () => {
      render(
        <FirstRunChecklist
          projectCount={0}
          aiKeyConfigured={false}
          homeGeographyIsSet={false}
          homeGeographyLabel={null}
          hasRuns={false}
          canManageWorkspace
        />
      );

      const step = screen.getByText("Turn on your AI assistant").closest("li");
      expect(step).not.toBeNull();
      expect(step!.textContent).toContain("Optional");
      expect(step!.textContent).not.toContain("Start here");
      expect(step!.textContent).not.toContain("Done");
      // The one emphasis sits on the first required step, the project. An
      // optional step's label never says "Start here", so emphasis is checked
      // on the step itself.
      expect(screen.getAllByText("Start here")).toHaveLength(1);
      const emphasized = document.querySelectorAll('li[data-emphasis="true"]');
      expect(emphasized).toHaveLength(1);
      expect(emphasized[0].textContent).toContain("Create your first project");
      expect(step!.getAttribute("data-emphasis")).toBeNull();
      // What stays off, from the same list Help uses, and that the rest works.
      for (const feature of AI_KEY_FEATURES) {
        expect(step!.textContent).toContain(feature.short);
      }
      expect(step!.textContent).toMatch(/Everything else works\./);
      expect(step!.textContent).toMatch(/OpenPlan is free\./);
      // The step is deep-linkable: the copilot's no-key notice points here.
      expect(step!.id).toBe("workspace-ai-key");
    });

    it("comes after every required step", () => {
      render(
        <FirstRunChecklist
          projectCount={0}
          aiKeyConfigured={false}
          homeGeographyIsSet={false}
          homeGeographyLabel={null}
          hasRuns={false}
          canManageWorkspace
        />
      );

      const titles = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
      expect(titles.slice(0, 3)).toEqual([
        "Create your first project",
        "Tell OpenPlan where you work",
        "Run your first screening",
      ]);
      expect(titles.indexOf("Turn on your AI assistant")).toBeGreaterThan(titles.indexOf("Run your first screening"));
    });

    it("marks the step done when a key resolves, without asking for anything", () => {
      render(
        <FirstRunChecklist
          projectCount={1}
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
        screen.getByText("On. An AI key is available to this workspace.")
      ).toBeInTheDocument();
      // With the project done, the emphasis falls through to the geography.
      const geographyStep = screen.getByText("Tell OpenPlan where you work").closest("li");
      expect(geographyStep!.textContent).toContain("Start here");
    });

    it("mounts the supplied key control under the step while it is outstanding, and drops it once done", () => {
      const { rerender } = render(
        <FirstRunChecklist
          projectCount={1}
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
          projectCount={1}
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
          projectCount={1}
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
          projectCount={1}
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
    it("adds the campaign step and emphasizes it once a project and the geography are set", () => {
      render(
        <FirstRunChecklist
          projectCount={1}
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
          projectCount={1}
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
          projectCount={1}
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

    it("keeps the geography as the emphasized step while it is unset and a project exists", () => {
      render(
        <FirstRunChecklist
          projectCount={1}
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
          projectCount={1}
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

  describe("project step", () => {
    it("leads with creating a project, and links to the create button", () => {
      render(
        <FirstRunChecklist
          projectCount={0}
          aiKeyConfigured
          homeGeographyIsSet
          homeGeographyLabel="Example County, Example State"
          hasRuns
          canManageWorkspace
        />
      );

      const steps = screen.getAllByRole("listitem");
      expect(steps[0].textContent).toContain("Create your first project");
      expect(steps[0].textContent).toContain("Start here");
      expect(screen.getByText("No projects yet.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Create a project/ })).toHaveAttribute("href", "/projects#create-project");
    });

    it("marks the step done on an observed project count and moves the emphasis on", () => {
      render(
        <FirstRunChecklist
          projectCount={3}
          aiKeyConfigured={false}
          homeGeographyIsSet={false}
          homeGeographyLabel={null}
          hasRuns={false}
          canManageWorkspace
        />
      );

      const step = screen.getByText("Create your first project").closest("li");
      expect(step!.textContent).toContain("Done");
      expect(screen.queryByRole("link", { name: /Create a project/ })).not.toBeInTheDocument();
      // A missing AI key does not take the emphasis: it is optional.
      const geographyStep = screen.getByText("Tell OpenPlan where you work").closest("li");
      expect(geographyStep!.textContent).toContain("Start here");
    });

    it("makes no claim either way when projects could not be counted", () => {
      render(
        <FirstRunChecklist
          projectCount={null}
          aiKeyConfigured
          homeGeographyIsSet
          homeGeographyLabel="Example County, Example State"
          hasRuns
          canManageWorkspace
        />
      );

      const step = screen.getByText("Create your first project").closest("li");
      expect(step!.textContent).not.toContain("Done");
      expect(step!.textContent).not.toContain("Start here");
      expect(screen.queryByText("No projects yet.")).not.toBeInTheDocument();
      expect(screen.getByText(/Could not check whether this workspace has projects/)).toBeInTheDocument();
    });
  });
});
