import { useEffect, useState } from "react";
import { cleanup, fireEvent, render, screen, within, waitFor, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlanAuthorityFields } from "@/components/land-use-plans/plan-authority-fields";
import { PlanStudyAreaFields } from "@/components/land-use-plans/plan-study-area-fields";
import { assessmentFromDraft, contextCommandFromDraft, planContextDraft, planContextDraftSchema, withResolvedStudyPlace, type PlanContextDraft } from "@/lib/land-use-plans/plan-context-draft";
import { syntheticPlanContext } from "./fixtures/land-use-plans/plan-context";
import { planApplicabilityBlocker } from "@/lib/land-use-plans/plan-context";
import { getJurisdictionPlanDescriptor } from "@/lib/land-use-plans/registry";
import type { PlaceBoundaryResponse } from "@/lib/api/place-geographies";
const { picker } = vi.hoisted(() => ({ picker: { current: null as null | { onCorridorChange: (text: string) => void; onPlaceResolved: (place: PlaceBoundaryResponse | null) => void } } }));
vi.mock("@/components/models/study-area-picker", () => ({ StudyAreaPicker: (props: NonNullable<typeof picker.current>) => { picker.current = props; return <div>Existing study area picker</div>; } }));
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const geometry: { type: "Polygon"; coordinates: [number, number][][] } = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const boundary: PlaceBoundaryResponse = { kind: "county", geoid: "41051", label: "SYNTHETIC resolved place", geojson: geometry, bbox: { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 } };
const conditions = { commandId: id(1), versionId: id(2), expectedContextHash: "a".repeat(64), descriptorId: "local-unconfigured", planKindKey: "community" };
const labels = { authority: "SYNTHETIC body label", geography: "SYNTHETIC area label" };
let observed: PlanContextDraft;
function Harness({ area = false, saved = false, disabled = false }: { area?: boolean; saved?: boolean; disabled?: boolean }) {
  const [draft, setDraft] = useState(() => planContextDraft(saved ? syntheticPlanContext() : null, labels)); useEffect(() => { observed = draft; }, [draft]);
  return area ? <PlanStudyAreaFields value={draft} onChange={setDraft} hasSavedArea={saved} disabled={disabled} /> : <PlanAuthorityFields value={draft} onChange={setDraft} disabled={disabled} />;
}
afterEach(() => { cleanup(); picker.current = null; });

describe("plan context authoring fields", () => {
  it("keeps inherited labels distinct from assessed authority and study geometry", () => {
    const draft = planContextDraft(null, labels);
    expect(draft.authorities[0]).toMatchObject({ label: labels.authority, jurisdictionUnknown: true, country: "", subdivision: "", kind: "", role: "", sourceText: "" });
    expect(draft.place.geometryText).toBe(""); expect(draft.applicability.status).toBe("unresolved");
    expect(() => contextCommandFromDraft(draft, conditions)).toThrow();
  });
  it("retains exact saved geography without resending resolver or geometry claims", () => {
    const context = syntheticPlanContext(); const draft = planContextDraft(context, labels);
    expect(planContextDraftSchema.parse(draft)).toEqual(draft);
    const command = contextCommandFromDraft(draft, conditions);
    expect(command.place).toEqual({ mode: "retained" }); expect(command.assessment).toEqual(context.assessment);
  });
  it("round trips a sourced multi-authority assessment without normalizing it into one jurisdiction", () => {
    const context = syntheticPlanContext();
    context.assessment = { authorities: [
      { id: id(3), label: "SYNTHETIC regional body", kind: "regional_body", role: "coordinating", jurisdiction: { country: "US", subdivision: null }, sourceUrls: ["https://example.org/region"] },
      { id: id(4), label: "SYNTHETIC sovereign body", kind: "tribal_government", role: "adopting", jurisdiction: null, sourceUrls: ["https://example.org/authority"] },
    ], applicability: { status: "staff_assessed", authorityIds: [id(3), id(4)], explanation: "Synthetic source review", sourceUrls: ["https://example.org/basis"] } };
    const draft = planContextDraft(context, labels); expect(planContextDraftSchema.parse(draft)).toEqual(draft);
    expect(assessmentFromDraft(draft)).toEqual(context.assessment);
    expect(planApplicabilityBlocker(assessmentFromDraft(draft), getJurisdictionPlanDescriptor("us-ca-general-plan")!)).toContain("outside");
  });
  it("changes a study place without changing authorities or their assessment", () => {
    const draft = planContextDraft(syntheticPlanContext(), labels);
    const selected = withResolvedStudyPlace(draft, boundary);
    expect(selected.authorities).toEqual(draft.authorities); expect(selected.applicability).toEqual(draft.applicability);
    expect(contextCommandFromDraft(selected, conditions).place).toEqual({ mode: "place", kind: "county", geoid: "41051", label: boundary.label });
    const drawn = withResolvedStudyPlace(selected, null);
    expect(drawn.place).toMatchObject({ mode: "drawn", kind: null, geoid: "" }); expect(drawn.authorities).toEqual(draft.authorities);
  });
  it("preserves incomplete source text while typing and validates only when preparing the command", () => {
    render(<Harness saved />);
    fireEvent.change(screen.getByLabelText("Authority sources"), { target: { value: "https://example.org/source\n" } });
    expect(screen.getByLabelText("Authority sources")).toHaveValue("https://example.org/source\n");
    expect(assessmentFromDraft(observed).authorities[0].sourceUrls).toEqual(["https://example.org/source"]);
    fireEvent.change(screen.getByLabelText("Authority sources"), { target: { value: "not a source URL" } });
    expect(() => assessmentFromDraft(observed)).toThrow(); expect(observed.authorities[0].sourceText).toBe("not a source URL");
  });
  it("adds and removes distinct bodies without dangling assessment references", () => {
    render(<Harness saved />); const first = observed.authorities[0].id;
    fireEvent.click(screen.getByRole("button", { name: "Add responsible body" }));
    expect(observed.authorities).toHaveLength(2); expect(observed.authorities[1].id).not.toBe(first);
    fireEvent.change(screen.getByLabelText("Applicability assessment"), { target: { value: "staff_assessed" } });
    const group = screen.getByRole("group", { name: "Bodies covered by this checklist assessment" });
    fireEvent.click(within(group).getAllByRole("checkbox")[0]); expect(observed.applicability.authorityIds).toEqual([first]);
    fireEvent.click(screen.getByRole("button", { name: "Remove responsible body 1" }));
    expect(observed.authorities).toHaveLength(1); expect(observed.applicability.authorityIds).toEqual([]);
  });
  it("shows body type names and preserves a custom type without imposing a closed taxonomy", () => {
    render(<Harness saved />);
    fireEvent.change(screen.getByLabelText("Type of body"), { target: { value: "Tribal government" } });
    expect(screen.getByLabelText("Type of body")).toHaveValue("Tribal government"); expect(observed.authorities[0].kind).toBe("tribal_government");
    fireEvent.change(screen.getByLabelText("Type of body"), { target: { value: "SYNTHETIC joint authority" } });
    expect(observed.authorities[0].kind).toBe("SYNTHETIC joint authority");
  });
  it("does not assign jurisdiction until staff enter it", () => {
    render(<Harness saved />); expect(screen.queryByLabelText("Country code")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Jurisdiction is not assessed"));
    fireEvent.change(screen.getByLabelText("Country code"), { target: { value: "ca" } });
    expect(assessmentFromDraft(observed).authorities[0].jurisdiction).toEqual({ country: "CA", subdivision: null });
    fireEvent.click(screen.getByLabelText("Jurisdiction is not assessed")); expect(assessmentFromDraft(observed).authorities[0].jurisdiction).toBeNull();
  });
  it("requires a new boundary choice after leaving the retained study area", () => {
    render(<Harness area saved />); expect(screen.queryByText("Existing study area picker")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Keep the saved study area unchanged"));
    expect(observed.place.geometryText).toBe(""); expect(() => contextCommandFromDraft(observed, conditions)).toThrow();
    const before = observed.authorities;
    act(() => { picker.current!.onCorridorChange(JSON.stringify(geometry)); picker.current!.onPlaceResolved(boundary); });
    expect(observed.place).toMatchObject({ mode: "place", geoid: boundary.geoid }); expect(observed.authorities).toEqual(before);
  });
  it("keeps uploads distinct from resolved jurisdictions and refuses invalid coordinates", async () => {
    render(<Harness area />);
    const file = { size: 100, text: async () => JSON.stringify({ type: "Feature", geometry }) };
    fireEvent.change(screen.getByLabelText("Or upload a study boundary"), { target: { files: [file] } });
    await waitFor(() => expect(observed.place.mode).toBe("uploaded")); expect(observed.place.kind).toBeNull(); expect(observed.place.geoid).toBe("");
    const saved = observed.place;
    fireEvent.change(screen.getByLabelText("Or upload a study boundary"), { target: { files: [{ size: 100, text: async () => JSON.stringify({ type: "Point", coordinates: [0, 0] }) }] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("not a closed WGS84"); expect(observed.place).toEqual(saved);
  });
  it("bounds boundary files before reading them and handles missing place labels", () => {
    render(<Harness area />); const text = vi.fn();
    fireEvent.change(screen.getByLabelText("Or upload a study boundary"), { target: { files: [{ size: 2000001, text }] } });
    expect(text).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toHaveTextContent("smaller than 2 MB");
    const changed = withResolvedStudyPlace(planContextDraft(syntheticPlanContext(), labels), { ...boundary, label: null });
    expect(changed.place.label).toBe(""); expect(() => contextCommandFromDraft(changed, conditions)).toThrow();
  });
  it("prevents a delayed file read from replacing a newer place selection", async () => {
    render(<Harness area />); let finish!: (value: string) => void;
    fireEvent.change(screen.getByLabelText("Or upload a study boundary"), { target: { files: [{ size: 100, text: () => new Promise<string>(resolve => { finish = resolve; }) }] } });
    act(() => picker.current!.onPlaceResolved(boundary));
    await act(async () => finish(JSON.stringify(geometry)));
    expect(observed.place.mode).toBe("place"); expect(observed.place.geoid).toBe(boundary.geoid);
  });
  it("prevents a pending upload or map callback from changing disabled fields", async () => {
    const view = render(<Harness area />); let finish!: (value: string) => void;
    fireEvent.change(screen.getByLabelText("Or upload a study boundary"), { target: { files: [{ size: 100, text: () => new Promise<string>(resolve => { finish = resolve; }) }] } });
    const before = observed; view.rerender(<Harness area disabled />);
    await act(async () => finish(JSON.stringify(geometry))); act(() => picker.current!.onPlaceResolved(boundary));
    expect(observed).toEqual(before);
  });
});
