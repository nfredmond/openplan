import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActionFeedback } from "@/components/ui/action-feedback";
import { MeasureSubmitFeedback } from "@/components/measures/measure-form-shell";
import { ProjectFundingProfileEditor } from "@/components/projects/project-funding-profile-editor";
import { stripSourceComments } from "./helpers/source-text";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

/**
 * ONE way to say a save worked, and it does not disappear.
 *
 * THE DECISION THIS GUARDS. `components/ui/sonner.tsx` shipped with the shadcn
 * scaffold and was never used: no `toast(` call anywhere, no `<Toaster />`
 * mounted in any layout. Two ways forward existed — wire the toast layer, or
 * adopt the inline renderer the measures lane already had at eight call sites.
 * The inline renderer won and the toast layer was deleted, for three reasons:
 *
 *   1. A toast disappears. This product's whole posture is that a planner can
 *      see what changed and where a number came from; a confirmation that
 *      evaporates after four seconds is unreadable to anyone who looked away
 *      and unreachable to anyone who wants to re-read it.
 *   2. A toast lands in a corner, far from the control that caused it, and over
 *      the map surfaces. Inline feedback sits beside the thing that changed.
 *   3. It was already there and already worked. Adding a second mechanism is
 *      exactly the failure the audit that prompted this found nine times over.
 *
 * The failure mode this test exists to prevent is not the toast — it is the
 * THIRD STATE: a product where some saves toast, some render inline, and a
 * planner cannot learn one rule for "did that work?".
 *
 * WHAT IS AND IS NOT TRUE TODAY, stated plainly because an earlier version of
 * this file implied more than it had. Deleting the toast layer did NOT make
 * `ActionFeedback` the product's one save renderer: for a while every file that
 * used it was under `src/components/measures/`, so "one pattern" was a claim
 * about one lane. Five daily surfaces outside that lane have since adopted it
 * (`ADOPTED_OUTSIDE_MEASURES` below, ratcheted so adoption cannot quietly
 * reverse), and each gained `role="status"` / `role="alert"` in the process —
 * none of them announced its outcome to a screen reader before.
 *
 * REMAINING WORK, not a claim of completion: roughly forty client components
 * still render a bespoke `<p>` for their own save outcome — most of
 * `components/rtp/**`, the rest of `components/invoicing/**`, and
 * `project-record-composer.tsx`, whose seven forms say nothing at all on
 * success. Three RTP editors keep their error as `{ scope, message }` and
 * cannot take `ActionFeedbackState` without reshaping; they already carry the
 * right roles. Adopt the rest as those lanes are touched.
 */

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const absolute = join(dir, entry);
    if (statSync(absolute).isDirectory()) {
      found.push(...sourceFiles(absolute));
    } else if (/\.(?:tsx?|jsx?)$/.test(entry)) {
      found.push(absolute);
    }
  }
  return found;
}

describe("the outcome of a save is written in exactly one place", () => {
  it("has no toast layer, and nothing importing one", () => {
    const root = join(process.cwd(), "src");
    const offenders: string[] = [];

    for (const file of sourceFiles(root)) {
      // Comments stripped with the shared stripper: this very file argues about
      // sonner at length, and a guard defeated by its own explanation is this
      // repo's oldest recurring failure.
      const code = stripSourceComments(readFileSync(file, "utf8"));
      if (/from\s+["']sonner["']/.test(code) || /@\/components\/ui\/sonner/.test(code)) {
        offenders.push(file.slice(root.length + 1));
      }
    }

    expect(
      offenders,
      "Report a save with `ActionFeedback` from @/components/ui/action-feedback. A toast disappears, " +
        "lands away from the control that caused it, and would be a second way to say the same thing."
    ).toEqual([]);
    expect(existsSync(join(root, "components/ui/sonner.tsx"))).toBe(false);
  });

  it("keeps the measures lane on the promoted renderer rather than a second copy", () => {
    // Eight call sites still say `MeasureSubmitFeedback`. If that name ever
    // stops BEING the shared component, the two will drift and a planner will
    // meet two different-looking confirmations for the same kind of act.
    expect(MeasureSubmitFeedback).toBe(ActionFeedback);
  });

  it("announces a save to a screen reader, not only to a sighted one", () => {
    render(<ActionFeedback state={{ busy: false, error: null, details: null, message: "Saved." }} />);

    // A confirmation that is only a colour change is invisible to a planner
    // using a screen reader, and this is now the only place it is written.
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
  });

  it("announces a refusal, and keeps the sentence saying what to do about it", () => {
    render(
      <ActionFeedback
        state={{
          busy: false,
          error: "This period still has money assigned to it",
          details: "Move those lines to another period, then delete this period.",
          message: null,
        }}
      />
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("This period still has money assigned to it");
    // Dropping the second sentence is how a 409 becomes a dead end.
    expect(alert).toHaveTextContent("Move those lines to another period");
  });

  it("says nothing at all until there is an outcome", () => {
    const { container } = render(
      <ActionFeedback state={{ busy: true, error: null, details: null, message: null }} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * THE RENDERER LEFT THE LANE IT CAME FROM.
 *
 * A shared component every caller of which lives in one directory is that
 * directory's component. These five are the daily save paths outside it — the
 * two invoice composers, the project funding profile, the spend ledger entry,
 * and the deliverable's budget-and-progress control. The list is a floor, not
 * an inventory: adding a surface is welcome, removing one has to be deliberate.
 */
const ADOPTED_OUTSIDE_MEASURES = [
  "components/invoicing/invoice-record-composer.tsx",
  "components/invoicing/client-invoice-composer.tsx",
  "components/projects/project-funding-profile-editor.tsx",
  "components/projects/project-spend-entry-form.tsx",
  "components/projects/deliverable-update-controls.tsx",
];

describe("the shared renderer is used outside the lane it came from", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(ADOPTED_OUTSIDE_MEASURES)("%s reports its save through ActionFeedback", (relative) => {
    const source = stripSourceComments(readFileSync(join(process.cwd(), "src", relative), "utf8"));
    expect(source).toContain('from "@/components/ui/action-feedback"');
    expect(source).toMatch(/<ActionFeedback\s+state=\{\{/);
    // The bespoke success paragraph each of these used to carry. Leaving it in
    // place beside the shared one would be the third state under another name.
    expect(source).not.toMatch(/text-emerald-\d00[^"]*">\s*\{?\s*message/);
  });

  /**
   * AND IT ACTUALLY RENDERS THERE. Every assertion above reads source, which
   * cannot tell an adopted component from one that imports the renderer and
   * never reaches it — this repo's own recurring defect. So one of the five is
   * driven for real, through its own failing save.
   */
  it("announces a real refusal on a real surface, in the role a screen reader reads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Funding need must be a number." }),
      })
    );

    render(<ProjectFundingProfileEditor projectId="11111111-1111-4111-8111-111111111111" />);
    fireEvent.click(screen.getByRole("button", { name: /Save funding profile/i }));

    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert).toHaveTextContent("Funding need must be a number.");
  });
});
