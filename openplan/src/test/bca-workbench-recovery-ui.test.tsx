import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BcaWorkbench } from "@/components/grants/bca-workbench/workbench";
import { exampleBcaDocument, reviewBcaProjectPlace } from "@/lib/bca/workbench/document";
import { bcaProjectPlace } from "./fixtures/bca/project-place";
import { readBcaDraft } from "@/lib/bca/workbench/draft";
const project = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const user = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const key = `openplan:bca:${user}:${project}`;
const props = {projectId:project,projectName:"Synthetic project",userId:user,canSave:true,models:[],modelReadFailed:false,
  projectPlace: { status: "available" as const, snapshot: bcaProjectPlace() }};
beforeEach(() => sessionStorage.clear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("keeps unfinished edits and all evidence through unmount and reload", async () => {
  const doc = reviewBcaProjectPlace(exampleBcaDocument(project), bcaProjectPlace());
  sessionStorage.setItem(key, JSON.stringify({document:doc,pending:null}));
  const view = render(<BcaWorkbench {...props}/>);
  fireEvent.change(screen.getByLabelText("Analysis title"), {target:{value:""}});
  await waitFor(() => expect(JSON.parse(sessionStorage.getItem(key)!).document.title).toBe(""));
  view.unmount();
  render(<BcaWorkbench {...props}/>);
  expect(screen.getByLabelText("Analysis title")).toHaveValue("");
  const recovered = JSON.parse(sessionStorage.getItem(key)!).document;
  expect(recovered.flows).toEqual(doc.flows);
  expect(recovered.evidence).toEqual(doc.evidence);
  expect(screen.getByRole("button", {name:"Save a version"})).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Analysis title"), {target:{value:"Repaired title"}});
  expect(screen.getByRole("button", {name:"Save a version"})).toBeEnabled();
});
it("retains invalid year edits but rejects malformed nested shapes", () => {
  const doc = exampleBcaDocument(project);
  doc.endYear = 1900;
  expect(readBcaDraft(JSON.stringify({document:doc}),project).document?.flows).toEqual(doc.flows);
  expect(readBcaDraft(JSON.stringify({document:{...doc,flows:[{bad:true}]}}),project).unreadable).toBe(true);
});
it("does not overwrite unreadable storage and independently recovers a valid pending save", async () => {
  const doc = exampleBcaDocument(project);
  const raw = JSON.stringify({document:{bad:true},pending:{id,document:doc}});
  sessionStorage.setItem(key,raw);
  render(<BcaWorkbench {...props}/>);
  expect(screen.getByRole("button", {name:"Retry retained save"})).toBeDisabled();
  expect(screen.getByLabelText("Analysis title")).toHaveValue(doc.title);
  await waitFor(() => expect(screen.getByRole("button", {name:"Download original and resume draft storage"})).toBeEnabled());
  expect(sessionStorage.getItem(key)).toBe(raw);
});
it("restores an exported retained request and retries its original identity and exact document", async () => {
  const doc = exampleBcaDocument(project);
  const request = {id,document:doc};
  const fetcher = vi.fn().mockResolvedValue({ok:true,json:async()=>({version:{id,created_by:user,created_at:"2026-10-06T00:00:00Z",document_json:doc}})});
  vi.stubGlobal("fetch",fetcher);
  render(<BcaWorkbench {...props}/>);
  fireEvent.change(screen.getByLabelText("Import analysis JSON file"), {target:{files:[{size:100,text:async()=>JSON.stringify(request)}]}});
  await waitFor(()=>expect(screen.getByRole("button", {name:"Retry retained save"})).toBeEnabled());
  expect(screen.getByLabelText("Analysis title")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", {name:"Retry retained save"}));
  await waitFor(()=>expect(fetcher).toHaveBeenCalledOnce());
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(request);
  await waitFor(()=>expect(screen.getByRole("button", {name:"Review this place for a new version"})).toBeEnabled());
  expect(screen.getByRole("button", {name:"Save a version"})).toBeDisabled();
});
it("loads legacy history without binding it and requires explicit review for a successor", async () => {
  const legacy = exampleBcaDocument(project), original = JSON.stringify(legacy);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    versions: [{ id, created_by: user, created_at: "2026-10-19T00:00:00Z", document_json: legacy,
      inputHash: "synthetic-hash", projectPlaceReview: { status: "unbound" } }], hasMore: false, projectPlace: props.projectPlace,
  }) }));
  render(<BcaWorkbench {...props}/>);
  fireEvent.click(screen.getByRole("button", { name: "Saved versions" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Load this version" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Load this version" }));
  expect(screen.getByLabelText("Affected area and users (analyst narrative)")).toHaveValue(legacy.geography);
  expect(screen.getByRole("button", { name: "Save a version" })).toBeDisabled();
  expect(screen.getByText(/Unbound legacy analysis/)).toBeVisible();
  await waitFor(() => expect(JSON.parse(sessionStorage.getItem(key)!).document).toEqual(legacy));
  fireEvent.click(screen.getByRole("button", { name: "Review this place for a new version" }));
  await waitFor(() => expect(JSON.parse(sessionStorage.getItem(key)!).document.schemaVersion).toBe(2));
  expect(screen.getByLabelText("Affected area and users (analyst narrative)")).toHaveValue(legacy.geography);
  expect(screen.getByRole("button", { name: "Save a version" })).toBeEnabled();
  expect(JSON.stringify(legacy)).toBe(original);
});
it("shows stale retained place and malformed current place without enabling a new save", () => {
  const retained = reviewBcaProjectPlace(exampleBcaDocument(project), bcaProjectPlace());
  sessionStorage.setItem(key, JSON.stringify({ document: retained, pending: null }));
  const view = render(<BcaWorkbench {...props} projectPlace={{ status: "available", snapshot: {
    ...bcaProjectPlace(), projectUpdatedAt: "2026-10-19T01:02:03.123457+00:00",
  } }}/>);
  expect(screen.getByText("Analysis place status: Project changed since place review.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Save a version" })).toBeDisabled();
  expect(screen.getByLabelText("Affected area and users (analyst narrative)")).toHaveValue(retained.geography);
  view.unmount();
  render(<BcaWorkbench {...props} projectPlace={{ status: "invalid", message: "Malformed project context" }}/>);
  expect(screen.getByText(/Current project place invalid: Malformed project context/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Review this place for a new version" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save a version" })).toBeDisabled();
});
