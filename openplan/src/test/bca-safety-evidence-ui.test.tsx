import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BcaWorkbench } from "@/components/grants/bca-workbench/workbench";
import type { BcaSafetyEvidenceRead } from "@/lib/safety/bca-evidence";
import { bcaProjectPlace } from "./fixtures/bca/project-place";

const project = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const user = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const key = `openplan:bca:${user}:${project}`;
const safety: BcaSafetyEvidenceRead = { status: "read", plans: [{
  status: "ready", reportId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", reportTitle: "Local Road Safety Plan",
  ingestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", sourceId: "fars", sourceLabel: "FARS test extract",
  coverage: "Fatal crashes only.", years: [2021, 2022], seriousInjuryInSource: false, caveats: [],
  segments: [{ segmentId: "road:abcdef12:0", segmentLabel: "Main Street", countermeasures: [],
    years: [{ year: 2021, fatalCrashes: 1, seriousInjuryCrashes: null }, { year: 2022, fatalCrashes: 2, seriousInjuryCrashes: null }],
    fatalCrashes: 3, seriousInjuryCrashes: null, fatalities: 4, fatalCrashesWithoutPersonCount: 0 }],
}] };
const props = { projectId: project, projectName: "Synthetic project", userId: user, canSave: true, models: [],
  modelReadFailed: false, projectPlace: { status: "available" as const, snapshot: bcaProjectPlace() }, safety };
const stored = () => JSON.parse(sessionStorage.getItem(key)!).document;

beforeEach(() => sessionStorage.clear());
afterEach(cleanup);

it("offers stored crashes on the Evidence tab and adds nothing until the planner adds a stream", async () => {
  render(<BcaWorkbench {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Evidence" }));
  const panel = screen.getByRole("region", { name: "Crashes on treated segments" });
  expect(within(panel).getByText(/Injury crashes are not in it/)).toBeVisible();
  expect(within(panel).getAllByText("Not in source").length).toBe(3);
  expect(within(panel).getByRole("option", { name: "Serious injuries, persons" })).toBeDisabled();
  await waitFor(() => expect(sessionStorage.getItem(key)).not.toBeNull());
  expect(stored().flows).toHaveLength(0);
  expect(stored().evidence).toHaveLength(0);

  fireEvent.click(within(panel).getByRole("button", { name: "Add safety stream for this segment" }));
  expect(screen.getByText("Enter the crash modification factor; blank is not zero.")).toBeVisible();
  expect(stored().flows).toHaveLength(0);

  fireEvent.change(within(panel).getByLabelText("Crash modification factor (not percent)"), { target: { value: "0.5" } });
  fireEvent.change(within(panel).getByLabelText("CMF Clearinghouse ID"), { target: { value: "4321" } });
  fireEvent.click(within(panel).getByRole("button", { name: "Add safety stream for this segment" }));
  await waitFor(() => expect(stored().flows).toHaveLength(1));
  expect(stored().flows[0]).toMatchObject({ unit: "fatality", noBuild: 2, build: 1, unitValue: null });
});

it("prints the project place as plain dates and planner words", () => {
  render(<BcaWorkbench {...props} />);
  const panel = screen.getByRole("complementary", { name: "Project place and retained analysis place" });
  expect(panel.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  expect(panel.textContent).not.toMatch(/insert transaction/);
  expect(within(panel).getByText(/^On the project now:/)).toBeVisible();
});
