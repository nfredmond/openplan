import { describe, expect, it } from "vitest";
import { bcaDocumentSchema } from "@/lib/bca/workbench/schema";
import { bcaDraftSchema, readBcaDraft } from "@/lib/bca/workbench/draft";
import { canonicalBcaJson } from "@/lib/bca/workbench/canonical";
import { exampleBcaDocument, reviewBcaProjectPlace } from "@/lib/bca/workbench/document";
import { bcaPlaceReview, bcaProjectPlaceSchema, readBcaProjectPlace } from "@/lib/bca/workbench/project-place";
import { DRAWN_PLACE_SOURCE, UPLOADED_PLACE_SOURCE } from "@/lib/geographies/place-of-record";
import { bcaActorId, bcaProjectId, bcaProjectPlace, bcaProjectRow } from "./fixtures/bca/project-place";
import { readProjectJurisdiction } from "@/lib/projects/project-jurisdiction";

describe("BCA project-place reader and document boundary", () => {
  it("distinguishes a fully read missing place from an absent projection or wrong project", () => {
    expect(readBcaProjectPlace(bcaProjectId, bcaProjectRow())).toEqual({ status: "available", snapshot: bcaProjectPlace() });
    const { jurisdiction_context: _context, ...missing } = bcaProjectRow();
    expect(readBcaProjectPlace(bcaProjectId, missing).status).toBe("unavailable");
    const { place_set_at: _setAt, ...missingTimestamp } = bcaProjectRow();
    expect(readBcaProjectPlace(bcaProjectId, missingTimestamp).status).toBe("unavailable");
    expect(readBcaProjectPlace(bcaActorId, bcaProjectRow()).status).toBe("unavailable");
    expect(bcaProjectPlace()).toMatchObject({ status: "missing", placeSetAt: null, jurisdiction: null });
  });
  it("retains drawn and uploaded provenance without inventing identity or authority", () => {
    for (const source of [DRAWN_PLACE_SOURCE, UPLOADED_PLACE_SOURCE]) {
      const row = { ...bcaProjectRow(), place_source: source, place_label: "Synthetic area",
        place_set_at: "2026-10-19T01:02:03.123456+00:00", place_min_lon: 170, place_max_lon: -170,
        place_min_lat: -20, place_max_lat: 20 };
      const read = readBcaProjectPlace(bcaProjectId, row);
      expect(read.status).toBe("available");
      if (read.status !== "available") throw new Error("Expected complete area scope");
      expect(read.snapshot.status).toBe(source === DRAWN_PLACE_SOURCE ? "drawn" : "uploaded");
      expect(read.snapshot.place).toMatchObject({ source, kind: null, ref: null, countryCode: null, subdivisionCode: null, geometry: null,
        bbox: { minLon: 170, maxLon: -170 } });
      expect(read.snapshot.jurisdiction).toBeNull();
      expect(readBcaProjectPlace(bcaProjectId, { ...row, place_ref: "invented-identity" }).status).toBe("invalid");
    }
  });
  it("retains opaque resolver identity and sovereign/overlapping context independently", () => {
    const jurisdiction = { version: 1, state: "declared", recordedBy: bcaActorId,
      recordedAt: "2026-10-19T00:00:00.654321+00:00", entries: ["sovereign", "overlap"].map(scope => ({
        label: `Synthetic ${scope} body`, countryCode: null, subdivisionCode: null, kind: "authority",
        reference: null, scope, identity: "staff_declared",
      })) };
    const read = readBcaProjectPlace(bcaProjectId, { ...bcaProjectRow(), place_source: "synthetic-resolver",
      place_kind: "area", place_ref: "opaque:area-1", place_label: "Synthetic area", place_set_at: "2026-10-19T00:00:00Z",
      place_min_lon: 1, place_min_lat: 1, place_max_lon: 2, place_max_lat: 2, jurisdiction_context: jurisdiction });
    expect(read.status).toBe("available");
    if (read.status !== "available") throw new Error("Expected complete resolver scope");
    expect(read.snapshot.place.ref).toBe("opaque:area-1");
    expect(read.snapshot.jurisdiction).toEqual(jurisdiction);
  });
  it("refuses partial, malformed and unreadable context instead of substituting an empty place", () => {
    for (const patch of [
      { place_min_lon: 1 }, { place_label: "Orphaned label" }, { jurisdiction_context: undefined },
      { jurisdiction_context: { version: 1, state: "declared", entries: [] } },
      { updated_at: "not-a-time" },
      { place_source: "tigerweb", place_kind: "unsupported", place_ref: "12345", place_set_at: "2026-10-19T00:00:00Z",
        place_min_lon: 1, place_min_lat: 1, place_max_lon: 2, place_max_lat: 2 },
    ]) expect(readBcaProjectPlace(bcaProjectId, { ...bcaProjectRow(), ...patch }).status).toBe("invalid");
  });
  it("compares exact microseconds and full source/context values without Date rounding", () => {
    const snapshot = bcaProjectPlace();
    const doc = reviewBcaProjectPlace(exampleBcaDocument(bcaProjectId), snapshot);
    expect(bcaPlaceReview(doc, { status: "available", snapshot }).status).toBe("matched-at-read");
    expect(bcaPlaceReview(doc, { status: "available", snapshot: { ...snapshot,
      projectUpdatedAt: "2026-10-19T01:02:03.123457+00:00" } }).status).toBe("changed-since-review");
    expect(bcaPlaceReview(doc, { status: "invalid", message: "Malformed current record" }).status).toBe("current-unavailable");
  });
  it("accepts reader UUID versions 1-8, RFC variants, nil and max but refuses native-only version zero", () => {
    const ids = [
      ...Array.from({ length: 8 }, (_, i) => `00000000-0000-${i + 1}000-8000-000000000001`),
      ...["9", "a", "b"].map(variant => `00000000-0000-4000-${variant}000-000000000001`),
      "00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff",
    ];
    for (const id of ids) {
      const read = readBcaProjectPlace(id, { ...bcaProjectRow(), id });
      expect(read.status, id).toBe("available");
      if (read.status !== "available") throw new Error(`Unreadable UUID survivor: ${id}`);
      expect(read.snapshot.projectId).toBe(id);
      expect(bcaDocumentSchema.safeParse(reviewBcaProjectPlace(exampleBcaDocument(id), read.snapshot)).success).toBe(true);
    }
    const id = "00000000-0000-0000-8000-000000000001";
    expect(readBcaProjectPlace(id, { ...bcaProjectRow(), id }).status).toBe("invalid");
    expect(bcaProjectPlaceSchema.safeParse({ ...bcaProjectPlace(), projectId: id }).success).toBe(false);
  });
  it("requires four-digit source years separately for revision and place timestamps without losing microseconds", () => {
    const area = { ...bcaProjectRow(), place_source: DRAWN_PLACE_SOURCE, place_label: "Synthetic area",
      place_min_lon: 1, place_min_lat: 1, place_max_lon: 2, place_max_lat: 2 };
    for (const timestamp of ["0001-01-01T00:00:00+00:00", "9999-12-31T23:59:59.123456+00:00",
      "2026-10-19T01:02:03.123456+00:00"]) {
      const read = readBcaProjectPlace(bcaProjectId, { ...area, updated_at: timestamp, place_set_at: timestamp });
      expect(read.status, timestamp).toBe("available");
      if (read.status !== "available") throw new Error(`Unreadable timestamp survivor: ${timestamp}`);
      expect(read.snapshot.projectUpdatedAt).toBe(timestamp);
      expect(read.snapshot.placeSetAt).toBe(timestamp);
    }
    const timestamp = "10000-01-01T00:00:00+00:00";
    expect(readBcaProjectPlace(bcaProjectId, { ...bcaProjectRow(), updated_at: timestamp }).status).toBe("invalid");
    expect(readBcaProjectPlace(bcaProjectId, { ...area, place_set_at: timestamp }).status).toBe("invalid");
    expect(bcaProjectPlaceSchema.safeParse({ ...bcaProjectPlace(), projectUpdatedAt: timestamp }).success).toBe(false);
    expect(bcaProjectPlaceSchema.safeParse({ ...bcaProjectPlace(), status: "drawn", placeSetAt: timestamp,
      place: { ...bcaProjectPlace().place, source: DRAWN_PLACE_SOURCE, label: "Synthetic area",
        bbox: { minLon: 1, minLat: 1, maxLon: 2, maxLat: 2 } } }).success).toBe(false);
  });
  it("keeps a normalized legacy fixture and pending request unbound until explicit local review", () => {
    const legacy = bcaDocumentSchema.parse(exampleBcaDocument(bcaProjectId)), original = canonicalBcaJson(legacy);
    const raw = JSON.stringify({ document: legacy, pending: { id: bcaActorId, document: legacy } });
    const recovered = readBcaDraft(raw, bcaProjectId);
    expect(recovered.unreadable).toBe(false);
    expect(JSON.stringify({ document: recovered.document, pending: recovered.pending })).toBe(raw);
    expect(bcaPlaceReview(legacy, { status: "available", snapshot: bcaProjectPlace() }).status).toBe("unbound");
    const reviewed = reviewBcaProjectPlace(legacy, bcaProjectPlace());
    expect(reviewed.schemaVersion).toBe(2);
    expect(reviewed.geography).toBe(legacy.geography);
    expect(canonicalBcaJson(legacy)).toBe(original);
    expect(recovered.pending?.document.schemaVersion).toBe(1);
    expect(bcaDocumentSchema.parse(legacy)).toEqual(legacy);
    expect(bcaDocumentSchema.parse(reviewed)).toEqual(reviewed);
  });
  it("keeps constructor-order legacy values and pending identity unbound across reloads", () => {
    const legacy = exampleBcaDocument(bcaProjectId);
    const pending = { id: bcaActorId, document: legacy };
    const documentIdentity = canonicalBcaJson(legacy), pendingIdentity = canonicalBcaJson(pending);
    let raw = JSON.stringify({ document: legacy, pending });
    for (let reload = 0; reload < 2; reload++) {
      const recovered = readBcaDraft(raw, bcaProjectId);
      expect(recovered.unreadable).toBe(false);
      expect(recovered.document).toEqual(legacy);
      expect(recovered.pending?.id).toBe(bcaActorId);
      expect(recovered.pending).toEqual(pending);
      expect(recovered.document?.schemaVersion).toBe(1);
      expect(recovered.pending?.document.schemaVersion).toBe(1);
      expect(canonicalBcaJson(recovered.document)).toBe(documentIdentity);
      expect(canonicalBcaJson(recovered.pending)).toBe(pendingIdentity);
      expect(recovered.document).not.toHaveProperty("projectPlace");
      expect(recovered.pending?.document).not.toHaveProperty("projectPlace");
      raw = JSON.stringify({ document: recovered.document, pending: recovered.pending });
    }
  });
  it("refuses raw contexts changed by the shared reader instead of normalizing a BCA snapshot", () => {
    const context = { version: 1, state: "declared", recordedBy: bcaActorId,
      recordedAt: "2026-10-19T00:00:00.654321+00:00", entries: [{ label: "Synthetic body", kind: "authority",
        countryCode: null, subdivisionCode: null, reference: null, scope: "sovereign", identity: "staff_declared" }] };
    for (const padding of [" ", "\t", "\u00a0", "\ufeff"]) {
      const raw = { ...context, entries: [{ ...context.entries[0], label: `${padding}Synthetic body${padding}` }] };
      expect(readProjectJurisdiction({ jurisdiction_context: raw })?.entries[0].label).toBe("Synthetic body");
      const source = readBcaProjectPlace(bcaProjectId, { ...bcaProjectRow(), jurisdiction_context: raw });
      expect(source.status).toBe("invalid");
      expect(bcaProjectPlaceSchema.safeParse({ ...bcaProjectPlace(), jurisdiction: raw }).success).toBe(false);
      expect(raw.entries[0].label).toBe(`${padding}Synthetic body${padding}`);
    }
    expect(readBcaProjectPlace(bcaProjectId, { ...bcaProjectRow(), jurisdiction_context: context }).status).toBe("available");
    for (const count of [100, 101]) {
      const raw = { ...context, entries: [{ ...context.entries[0], label: "😀".repeat(count) }] };
      expect(readBcaProjectPlace(bcaProjectId, { ...bcaProjectRow(), jurisdiction_context: raw }).status)
        .toBe(count === 100 ? "available" : "invalid");
    }
  });
  it("requires an exact project identity and complete snapshot in both retained and draft schemas", () => {
    const doc = reviewBcaProjectPlace(exampleBcaDocument(bcaProjectId), bcaProjectPlace());
    expect(bcaDocumentSchema.safeParse({ ...doc, projectId: bcaActorId }).success).toBe(false);
    expect(bcaDraftSchema.safeParse({ ...doc, projectId: bcaActorId }).success).toBe(false);
    expect(bcaDocumentSchema.safeParse({ ...doc, projectPlace: undefined }).success).toBe(false);
    expect(bcaDocumentSchema.safeParse({ ...exampleBcaDocument(bcaProjectId), projectPlace: bcaProjectPlace() }).success).toBe(false);
    expect(bcaProjectPlaceSchema.safeParse({ ...bcaProjectPlace(), status: "recorded" }).success).toBe(false);
    expect(bcaDraftSchema.safeParse({ ...doc, title: "", endYear: 1900 }).success).toBe(true);
    expect(bcaDraftSchema.safeParse({ ...doc, projectPlace: { ...bcaProjectPlace(), projectUpdatedAt: "invalid" } }).success).toBe(false);
    expect(() => reviewBcaProjectPlace(doc, { ...bcaProjectPlace(), projectId: bcaActorId })).toThrow("different project");
  });
});
