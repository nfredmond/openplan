import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GtfsIngestPanel } from "@/components/data-hub/gtfs-ingest-panel";
import { readGtfsClientRequests, retainGtfsClientRequest } from "@/lib/gtfs/managed-client";
import { readGtfsClientDecisions } from "@/lib/gtfs/managed-client-decision";
const { routerRefresh, router } = vi.hoisted(() => { const routerRefresh = vi.fn(); return { routerRefresh, router: { refresh: routerRefresh } }; });
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const id = (n: number) => `e8000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { installationId: id(1), workspaceId: id(2), actorId: id(3) };
const basis = { feedId: id(5), versionId: id(6), routeCount: 14, stopCount: 287, previousVersionId: null as string | null, previousRouteCount: null as number | null, previousStopCount: null as number | null };
const polygon = JSON.stringify({ type: "Polygon", coordinates: [[[-122, 37], [-121.9, 37], [-121.9, 37.1], [-122, 37.1], [-122, 37]]] });
vi.mock("@/components/models/study-area-picker", () => ({ StudyAreaPicker: ({ onCorridorChange }: { onCorridorChange: (text: string) => void }) => <button onClick={() => onCorridorChange(polygon)}>Use fixture study area</button> }));
let failureCode: string | null, failureDetail: string | null;
let state: "queued" | "ready" | "failed", current: boolean, material: boolean, unknown: boolean, cancelReceipt: unknown, decisionUnavailable: boolean;
let posts: { path: string; init: RequestInit }[];
let countMode: "normal" | "missing" | "zero";
const feed = { id: id(5), workspace_id: id(2), agency_name: "Fixture transit", source_kind: "url", feed_url: "https://example.org/feed.zip", status: "loaded", current_version_id: null };
const version = { id: id(6), feed_id: id(5), workspace_id: id(2), status: "ready", route_count: 95, stop_count: 717, route_service_level_rows: 95, stop_service_level_rows: 717, created_at: "2026-10-10T12:00:00Z" };
function status(requestId: string) {
 return { managed: true, requestId, cancellation: cancelReceipt, status: unknown || cancelReceipt ? null : { schemaVersion: 1, workspaceId: scope.workspaceId, requestId, versionId: id(6), feedId: id(5), state,
  stage: state === "ready" ? "ready" : state === "failed" ? "failed" : "pending", attempts: 0, leaseUntil: null, archiveConfirmed: true, submittedAt: "2026-10-10T12:00:00Z", isCurrent: current, failureCode, failureDetail, submitterAccessUnavailable: false } };
}
function json(body: unknown, code = 200) { return new Response(JSON.stringify(body), { status: code }); }
function registryVersion() { return countMode === "normal" ? version : { ...version, route_count: countMode === "zero" ? 0 : null, stop_count: countMode === "zero" ? 0 : null, trip_count: countMode === "zero" ? 0 : null, route_service_level_rows: countMode === "zero" ? 0 : null, stop_service_level_rows: countMode === "zero" ? 0 : null }; }
beforeEach(() => {
 routerRefresh.mockClear(); failureCode = null; failureDetail = null;
 window.localStorage.clear(); posts = []; state = "queued"; current = false; material = false; unknown = false; cancelReceipt = null; decisionUnavailable = false; countMode = "normal";
 vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (path, rawInit) => {
  const url = String(path), init = rawInit ?? {};
  if (init.method === "POST") {
   posts.push({ path: url, init });
   if (url.endsWith("/adopt")) {
    const body = JSON.parse(String(init.body)); if (decisionUnavailable) return json({}, 503); current = true;
    return json({ managed: true, adoption: { command: body.command.commandId, version: id(6), adopted: true, alreadyCurrent: false, basis: body.command.basis, humanAcceptShrinkage: body.command.acceptMaterialShrinkage, adoptedAt: "2026-10-10T12:00:00Z", reviewAccepted: true } });
   }
   if (url.endsWith("/cancel")) {
    const body = JSON.parse(String(init.body)), requestId = url.split("/").at(-2)!;
    cancelReceipt = { command: body.commandId, requestId, workspaceId: scope.workspaceId, state: "cancelled", versionId: null, versionCancellation: null, cancelledAt: "2026-10-10T12:00:00Z" };
    return json({ managed: true, requestId, cancellation: cancelReceipt });
   }
   return json({ managed: true, adopted: true }, 202);
  }
  if (url.includes("/catalog/search")) return json({ status: "matched", feeds: [{ entry: { catalogId: "fixture-feed", name: "Fixture catalog", provider: "Fixture", statedLocation: { countryCode: "US", subdivisionName: "California", municipality: null }, feedContactEmail: null }, serviceAreaSpread: 0.1, focusOffsetDegrees: 0 }], disclosure: { staticEntriesConsidered: 1, supersededOrInactiveCoveringArea: 0, requiringApiKey: 0, withoutDownloadUrl: 0, entriesWithNoPublishedServiceAreaAnywhere: 0 }, catalogUrl: "https://example.org/catalog.csv" });
  if (url.includes("/submissions/")) return json(status(url.split("/").at(-1)!.split("?")[0]));
  if (url.includes("/versions/") && url.includes("/status?")) return json(status(id(4)));
  if (url.includes("/review?")) return json({ managed: true, review: { basis: current ? { ...basis, previousVersionId: id(6), previousRouteCount: 14, previousStopCount: 287 } : material ? { ...basis, previousVersionId: id(9), previousRouteCount: 20, previousStopCount: 500 } : basis, materialShrinkage: material && !current, isCurrent: current } });
  if (url.includes("/feeds?")) return json({ feeds: [{ ...feed, current_version_id: current ? id(6) : null }], currentVersions: current ? [registryVersion()] : [], recentVersions: [registryVersion()], caveatsByFeedId: {} });
  if (url.includes(`/feeds/${id(5)}?`)) return json({ feed, versions: [registryVersion()] });
  throw new Error(`Unexpected fixture route ${url}`);
 }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function panel(readOnly = false, initialLabel?: string) {
 const rendered = render(<GtfsIngestPanel workspaceId={scope.workspaceId} managed={{ enabled: true, scope }} today="2026-10-10" maxUploadBytes={10000} readOnly={readOnly} />);
 await screen.findByTestId("gtfs-managed-imports"); await screen.findByText(initialLabel ?? /This browser has no retained transit requests|Waiting for a worker/); return rendered;
}
async function urlImport() {
 fireEvent.click(screen.getByRole("tab", { name: "Paste a feed address" })); fireEvent.change(screen.getByRole("textbox", { name: "GTFS feed address" }), { target: { value: "https://example.org/feed.zip" } }); fireEvent.click(screen.getByRole("button", { name: "Fetch and read this feed" }));
 return screen.findByText("Waiting for a worker");
}
describe("planner managed transit panel", () => {
 it("uses retained URL identity and shows queued progress without success or adoption", async () => {
  await panel(); await urlImport(); const saved = readGtfsClientRequests(window.localStorage, scope); expect(saved).toHaveLength(1); expect(new Headers(posts[0].init.headers).get("x-openplan-gtfs-request-id")).toBe(saved[0].requestId); expect(screen.queryByTestId("gtfs-ingest-outcome")).toBeNull(); expect(screen.queryByText("In use")).toBeNull(); expect(screen.queryByText("Ready for review")).toBeNull();
 });
 it("refreshes dependent server reads and preserves custody on an equivalent server render", async () => {
  const view = await panel(); await urlImport(); await waitFor(() => expect(routerRefresh).toHaveBeenCalled());
  const before = readGtfsClientRequests(window.localStorage, scope), refreshed = routerRefresh.mock.calls.length;
  await act(async () => { view.rerender(<GtfsIngestPanel workspaceId={scope.workspaceId} managed={{ enabled: true, scope: { ...scope } }} today="2026-10-10" maxUploadBytes={10000} />); });
  expect(readGtfsClientRequests(window.localStorage, scope)).toEqual(before); expect(posts).toHaveLength(1);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(routerRefresh.mock.calls.length).toBe(refreshed);
 });
 it("uses retained ZIP, catalog and refresh imports from the existing doors", async () => {
  await panel(); fireEvent.click(screen.getByRole("tab", { name: /Upload/ })); fireEvent.change(screen.getByLabelText("GTFS archive"), { target: { files: [new File(["bytes"], "fixture.zip")] } }); fireEvent.click(screen.getByRole("button", { name: "Upload and read this archive" })); await waitFor(() => expect(posts).toHaveLength(1)); await screen.findByText("Waiting for a worker");
  fireEvent.click(screen.getByRole("button", { name: "Refresh from source" })); await waitFor(() => expect(posts).toHaveLength(2)); await waitFor(() => expect(screen.getAllByText("Waiting for a worker")).toHaveLength(2));
  fireEvent.click(screen.getByRole("tab", { name: "Search the feed catalog" })); fireEvent.click(screen.getByRole("button", { name: "Use fixture study area" })); fireEvent.click(screen.getByRole("button", { name: "Search the feed catalog for this area" })); fireEvent.click(await screen.findByRole("button", { name: "Ingest this feed" })); await waitFor(() => expect(posts).toHaveLength(3));
  const saved = readGtfsClientRequests(window.localStorage, scope); expect(saved.map(item => item.intent.source)).toEqual(["upload", "refresh", "catalog"]); expect(posts.every((post, index) => new Headers(post.init.headers).get("x-openplan-gtfs-request-id") === saved[index].requestId)).toBe(true); expect(saved[2].intent).toMatchObject({ catalogId: "fixture-feed", area: { minLon: -122, minLat: 37, maxLon: -121.9, maxLat: 37.1 } });
 });
 it("opens another submitter's completed workspace version and reviews parser counts", async () => {
  state = "ready"; await panel(); fireEvent.change(screen.getByRole("combobox", { name: "Open a recent version" }), { target: { value: id(6) } });
  const view = await screen.findByRole("region", { name: "Selected transit version" }); expect(await within(view).findByText(/Completed schedule: 14 routes and 287 stops/)).toBeInTheDocument(); expect(within(view).queryByText(/Completed schedule: 95/)).toBeNull(); expect(posts).toHaveLength(0);
  fireEvent.click(within(view).getByRole("button", { name: "Use this reviewed version" })); await waitFor(() => expect(posts).toHaveLength(1)); const body = JSON.parse(String(posts[0].init.body)); expect(body.command.basis).toEqual(basis); expect(readGtfsClientDecisions(window.localStorage, scope)[0].commandId).toBe(body.command.commandId); expect(await screen.findByText("Exact command receipt confirmed in this session.", { exact: false })).toBeInTheDocument(); await within(view).findByText("This version is currently in use.");
 });
 it("requires explicit acceptance of material shrinkage", async () => {
  state = "ready"; material = true; await panel(); fireEvent.change(screen.getByRole("combobox", { name: "Open a recent version" }), { target: { value: id(6) } }); const accept = await screen.findByRole("checkbox", { name: /I accept the reduction/ }); const use = screen.getByRole("button", { name: "Use this reviewed version" }); expect(use).toBeDisabled(); fireEvent.click(accept); expect(use).toBeEnabled(); fireEvent.click(use); await waitFor(() => expect(posts).toHaveLength(1)); expect(JSON.parse(String(posts[0].init.body)).command).toMatchObject({ acceptMaterialShrinkage: true, basis: { previousRouteCount: 20, previousStopCount: 500 } });
 });
 it("retains a lost adoption command and replays the exact command instead of creating another", async () => {
  state = "ready"; decisionUnavailable = true; await panel(); fireEvent.change(screen.getByRole("combobox", { name: "Open a recent version" }), { target: { value: id(6) } }); fireEvent.click(await screen.findByRole("button", { name: "Use this reviewed version" })); await screen.findByText(/Command acknowledgement unconfirmed/); const original = posts[0].init.body; decisionUnavailable = false; fireEvent.click(screen.getByRole("button", { name: "Replay exact command" })); await waitFor(() => expect(posts).toHaveLength(2)); expect(posts[1].init.body).toBe(original); expect(readGtfsClientDecisions(window.localStorage, scope)).toHaveLength(1);
 });
 it("cancels an unconfirmed request with an explicit reason and preserves its identity", async () => {
  unknown = true; await panel(); fireEvent.click(screen.getByRole("tab", { name: "Paste a feed address" })); fireEvent.change(screen.getByRole("textbox", { name: "GTFS feed address" }), { target: { value: "https://example.org/feed.zip" } }); fireEvent.click(screen.getByRole("button", { name: "Fetch and read this feed" })); await screen.findByText("Submission unconfirmed"); const saved = readGtfsClientRequests(window.localStorage, scope)[0]; expect(screen.getByRole("button", { name: "Cancel this request" })).toBeDisabled(); fireEvent.change(screen.getByLabelText(`Reason for cancelling ${saved.requestId}`), { target: { value: "Wrong operator" } }); fireEvent.click(screen.getByRole("button", { name: "Cancel this request" })); await screen.findByText("Cancelled"); expect(posts[1].path).toBe(`/api/gtfs/submissions/${saved.requestId}/cancel`); expect(JSON.parse(String(posts[1].init.body)).reason).toBe("Wrong operator"); expect(readGtfsClientRequests(window.localStorage, scope)[0].requestId).toBe(saved.requestId);
 });
 it("keeps viewer review readable and adoption disabled", async () => {
  state = "ready"; await panel(true); fireEvent.change(screen.getByRole("combobox", { name: "Open a recent version" }), { target: { value: id(6) } }); expect(await screen.findByRole("button", { name: "Use this reviewed version" })).toBeDisabled(); expect(screen.queryByRole("button", { name: "Cancel this request" })).toBeNull(); expect(posts).toHaveLength(0);
 });
 it("does not send untracked imports when enabled configuration is unavailable", async () => {
  render(<GtfsIngestPanel workspaceId={scope.workspaceId} managed={{ enabled: true, unavailable: "Worker unavailable" }} today="2026-10-10" maxUploadBytes={10000} />); await screen.findByText("Worker unavailable"); fireEvent.click(screen.getByRole("tab", { name: "Paste a feed address" })); fireEvent.change(screen.getByRole("textbox", { name: "GTFS feed address" }), { target: { value: "https://example.org/feed.zip" } }); fireEvent.click(screen.getByRole("button", { name: "Fetch and read this feed" })); await screen.findByText("Managed transit import history is unavailable. Nothing was sent."); expect(posts).toHaveLength(0);
 });
 it("isolates displayed browser history when the account changes", async () => {
  retainGtfsClientRequest(window.localStorage, scope, { source: "url", workspaceId: scope.workspaceId, url: "https://example.org/old-actor.zip" }, id(4)); const view = await panel(); expect(await screen.findByText("https://example.org/old-actor.zip")).toBeInTheDocument(); await act(async () => { view.rerender(<GtfsIngestPanel workspaceId={scope.workspaceId} managed={{ enabled: true, scope: { ...scope, actorId: id(99) } }} today="2026-10-10" maxUploadBytes={10000} />); }); expect(await screen.findByText(/This browser has no retained transit requests/)).toBeInTheDocument(); expect(screen.queryByText("https://example.org/old-actor.zip")).toBeNull();
 });
 it("does not convert missing current counts into zero", async () => {
  current = true; countMode = "missing"; await panel(); const stored = within(screen.getByTestId(`gtfs-feed-${id(5)}`)).getByText(/service-level rows derived from/); expect(stored.textContent).toContain("not recorded"); expect(stored.textContent).not.toMatch(/\b0 (?:route|stop|trip)/);
 });
 it("preserves actually recorded zero counts", async () => {
  current = true; countMode = "zero"; await panel(); const stored = within(screen.getByTestId(`gtfs-feed-${id(5)}`)).getByText(/service-level rows derived from/); expect(stored.textContent).toContain("0 route and 0 stop"); expect(stored.textContent).not.toContain("not recorded");
 });
 it("does not convert missing historical counts into zero", async () => {
  countMode = "missing"; await panel(); fireEvent.click(screen.getByRole("button", { name: "Show every ingest of this feed" })); const history = await screen.findByTestId(`gtfs-feed-history-${id(5)}`); expect(await within(history).findByText(/not recorded route and not recorded stop/)).toBeInTheDocument(); expect(history.textContent).not.toMatch(/\b0 (?:route|stop)/);
 });
 it("explains a malformed ZIP in retained progress and version review without library guidance", async () => {
  state = "failed"; failureCode = "not_a_zip"; failureDetail = "Can't find end of central directory. See https://stuk.github.io/jszip/documentation/howto/read_zip.html";
  retainGtfsClientRequest(window.localStorage, scope, { source: "url", workspaceId: scope.workspaceId, url: "https://example.org/invalid.zip" }, id(4));
  await panel(false, "Processing failed");
  const explanation = "This file could not be opened as a ZIP archive. Choose the agency's GTFS ZIP file and start a new import.";
  expect(await screen.findByText(explanation)).toBeInTheDocument();
  expect(screen.queryByText(/central directory|stuk.github.io/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open version" }));
  const selected = await screen.findByRole("region", { name: "Selected transit version" });
  expect(await within(selected).findByText(explanation)).toBeInTheDocument();
  expect(within(selected).queryByText(/central directory|stuk.github.io/)).toBeNull();
  expect(within(selected).queryByRole("button", { name: "Use this reviewed version" })).toBeNull();
  expect(posts).toHaveLength(0);
 });
 it("keeps other recorded failures distinct from malformed ZIP recovery", async () => {
  state = "failed"; failureCode = "retained_archive_unavailable"; failureDetail = "The original retained archive fixture is unavailable.";
  retainGtfsClientRequest(window.localStorage, scope, { source: "url", workspaceId: scope.workspaceId, url: "https://example.org/missing.zip" }, id(4));
  await panel(false, "Processing failed"); expect(await screen.findByText(failureDetail)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open version" }));
  const selected = await screen.findByRole("region", { name: "Selected transit version" });
  expect(await within(selected).findByText(failureDetail)).toBeInTheDocument();
  expect(screen.queryByText(/Choose the agency's GTFS ZIP file/)).toBeNull();
  expect(within(selected).queryByRole("button", { name: "Use this reviewed version" })).toBeNull();
  expect(posts).toHaveLength(0);
 });

});
