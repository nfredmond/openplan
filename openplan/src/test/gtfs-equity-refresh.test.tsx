import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { TitleViServiceEquityPanel } from "@/components/data-hub/title-vi-service-equity-panel";
const workspace = "ec000000-0000-4000-8000-000000000001";
const otherWorkspace = "ec000000-0000-4000-8000-000000000002";
function equity(message: string) { return { serviceDay: "monday", availableServiceDays: [], tractServiceComputedAt: null, result: { ok: false, refusal: { code: "unavailable_fixture", message } } }; }
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
let pending: { path: string; resolve: (response: Response) => void; reject: (error: Error) => void }[];
let fetcher: Mock<(path: string, init?: RequestInit) => Promise<Response>>;
beforeEach(() => {
 pending = [];
 fetcher = vi.fn((path: string, _init?: RequestInit) => {
  if (path.includes("/policy?")) return Promise.resolve(response({ policy: null, gaps: [], canEdit: true }));
  return new Promise<Response>((resolve, reject) => pending.push({ path, resolve, reject }));
 });
 vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function resolve(index: number, message: string, status = 200) { await act(async () => { pending[index].resolve(response(status === 200 ? equity(message) : { error: message }, status)); }); }
describe("GTFS dependent equity reads", () => {
 it("rereads a fresh server read with unchanged adopted IDs without erasing a policy edit", async () => {
  const view = render(<TitleViServiceEquityPanel workspaceId={workspace} today="2026-10-10" feedVersionRevision='{"read":"first","versionIds":["unchanged-version"]}' />);
  await waitFor(() => expect(pending).toHaveLength(1)); await resolve(0, "No adopted feed fixture"); await screen.findByText("No adopted feed fixture");
  fireEvent.click(await screen.findByRole("button", { name: "Record your adopted policy" })); fireEvent.change(screen.getByLabelText("Adopted by"), { target: { value: "Unfinished synthetic review" } });
  view.rerender(<TitleViServiceEquityPanel workspaceId={workspace} today="2026-10-10" feedVersionRevision='{"read":"second","versionIds":["unchanged-version"]}' />);
  await waitFor(() => expect(pending).toHaveLength(2)); expect(screen.queryByText("No adopted feed fixture")).toBeNull(); await resolve(1, "Tract evidence fixture unavailable"); await screen.findByText("Tract evidence fixture unavailable");
  expect(fetcher.mock.calls.filter(([path]) => path.includes("/service-equity?")).every(([, init]) => init?.cache === "no-store")).toBe(true);
  expect(screen.getByLabelText("Adopted by")).toHaveValue("Unfinished synthetic review"); expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  view.rerender(<TitleViServiceEquityPanel workspaceId={workspace} today="2026-10-10" feedVersionRevision='{"read":"second","versionIds":["unchanged-version"]}' />);
  await act(async () => { await Promise.resolve(); }); expect(pending).toHaveLength(2);
 });
 it("does not start a deferred equity read after the panel closes", async () => {
  const view = render(<TitleViServiceEquityPanel workspaceId={workspace} today="2026-10-10" feedVersionRevision="initial" />);
  view.unmount(); await act(async () => { await Promise.resolve(); });
  expect(pending).toHaveLength(0); expect(fetcher.mock.calls.every(([path]) => path.includes("/policy?"))).toBe(true);
 });
 it.each(["old-success", "old-http-error", "old-network-error"])("discards %s after a newer workspace read", async variant => {
  const view = render(<TitleViServiceEquityPanel workspaceId={workspace} today="2026-10-10" feedVersionRevision="old" />);
  await waitFor(() => expect(pending).toHaveLength(1));
  view.rerender(<TitleViServiceEquityPanel workspaceId={otherWorkspace} today="2026-10-10" feedVersionRevision="new" />);
  await waitFor(() => expect(pending).toHaveLength(2)); expect(pending[1].path).toContain(`workspaceId=${otherWorkspace}`);
  await resolve(1, "Current workspace evidence fixture"); await screen.findByText("Current workspace evidence fixture");
  if (variant === "old-network-error") await act(async () => { pending[0].reject(new Error("Old transport failed")); });
  else await resolve(0, "Old workspace result", variant === "old-http-error" ? 503 : 200);
  expect(screen.getByText("Current workspace evidence fixture")).toBeInTheDocument(); expect(screen.queryByText("Old workspace result")).toBeNull(); expect(screen.queryByRole("alert")).toBeNull();
 });
});
