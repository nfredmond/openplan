import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BcaWorkbench } from "@/components/grants/bca-workbench/workbench";
import { exampleBcaDocument, reviewBcaProjectPlace } from "@/lib/bca/workbench/document";
import { bcaProjectPlace } from "./fixtures/bca/project-place";

// KI-2026-11-14-112: a new browser session opened a blank analysis, and saving
// it made the blank the version the report and the SS4A appendix print.
const project = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const user = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const versionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const key = `openplan:bca:${user}:${project}`;
// Midday UTC reads as Nov 13 in every US time zone.
const savedAt = "2026-11-13T12:00:00.000Z";
const saved = { ...reviewBcaProjectPlace(exampleBcaDocument(project), bcaProjectPlace()), title: "Saved Hwy 89 analysis" };
const found = { status: "found" as const, id: versionId, createdAt: savedAt, document: saved };
const props = { projectId: project, projectName: "Synthetic project", userId: user, canSave: true, models: [],
  modelReadFailed: false, projectPlace: { status: "available" as const, snapshot: bcaProjectPlace() } };
const title = () => screen.getByLabelText("Analysis title");
const saveButton = () => screen.getByRole("button", { name: "Save a version" });
const confirmWith = (label: string) => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: label }));

beforeEach(() => sessionStorage.clear());
afterEach(cleanup);

it("opens the latest saved version when this tab holds no draft, and names it by date", async () => {
  render(<BcaWorkbench {...props} latestSaved={found} />);
  expect(title()).toHaveValue("Saved Hwy 89 analysis");
  expect(await screen.findByText(/^Open: the version saved Nov 13, 2026/)).toBeVisible();
  expect(saveButton()).toBeEnabled();
  await waitFor(() => expect(JSON.parse(sessionStorage.getItem(key)!).basis).toEqual({ kind: "saved", id: versionId, savedAt }));
});

it("keeps this tab's draft open over the saved version and says so", async () => {
  sessionStorage.setItem(key, JSON.stringify({ document: { ...saved, title: "Unsaved draft title" }, pending: null }));
  render(<BcaWorkbench {...props} latestSaved={found} />);
  expect(await screen.findByText(/^Open: this tab's draft\. Latest saved: Nov 13, 2026/)).toBeVisible();
  expect(title()).toHaveValue("Unsaved draft title");
  fireEvent.click(screen.getByRole("button", { name: "Open latest saved version" }));
  confirmWith("Open saved version");
  await waitFor(() => expect(title()).toHaveValue("Saved Hwy 89 analysis"));
  expect(screen.getByText(/^Open: the version saved Nov 13, 2026/)).toBeVisible();
});

// Found by the agent-run browser check of November 14: after an edit and a
// reload, a draft started from the latest version offered no way back to it.
it("offers the saved version again from a draft that was started from it", async () => {
  sessionStorage.setItem(key, JSON.stringify({ document: { ...saved, title: "Edited after opening" }, pending: null,
    basis: { kind: "saved", id: versionId, savedAt } }));
  render(<BcaWorkbench {...props} latestSaved={found} />);
  expect(await screen.findByText(/^Open: this tab's draft, started from the version saved Nov 13, 2026/)).toBeVisible();
  // No newer version exists, so the line does not announce one.
  expect(screen.queryByText(/Latest saved:/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open latest saved version" }));
  confirmWith("Open saved version");
  await waitFor(() => expect(title()).toHaveValue("Saved Hwy 89 analysis"));
});

it("will not save a blank analysis over saved work until the planner chooses it", async () => {
  render(<BcaWorkbench {...props} latestSaved={{ status: "failed" }} />);
  const alert = await screen.findByText("Saved versions could not be read. That does not mean none exist.");
  expect(alert).toBeVisible();
  expect(title()).toHaveValue("Benefit-cost analysis");
  expect(saveButton()).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Start a blank analysis" }));
  expect(screen.getByText(/reports print it instead of the saved analysis/)).toBeVisible();
  confirmWith("Start blank");
  await waitFor(() => expect(saveButton()).toBeEnabled());
  expect(screen.getByText("Open: a blank analysis.")).toBeVisible();
});

it("keeps the choice through a reload and needs none when nothing was ever saved", async () => {
  const blank = { ...saved, title: "Benefit-cost analysis", flows: [], evidence: [] };
  sessionStorage.setItem(key, JSON.stringify({ document: blank, pending: null, basis: { kind: "blank" } }));
  const view = render(<BcaWorkbench {...props} latestSaved={found} />);
  expect(await screen.findByText(/^This project has a version saved Nov 13, 2026/)).toBeVisible();
  expect(saveButton()).toBeDisabled();
  view.unmount();
  sessionStorage.clear();
  render(<BcaWorkbench {...props} latestSaved={{ status: "none" }} />);
  expect(await screen.findByText("Open: a blank analysis.")).toBeVisible();
  expect(saveButton()).toBeEnabled();
});
