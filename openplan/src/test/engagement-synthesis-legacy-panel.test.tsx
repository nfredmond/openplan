// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EngagementSynthesisPanel } from "@/components/engagement/engagement-synthesis-panel";
import { historical } from "./fixtures/engagement/legacy-synthesis";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("earlier synthesis inspection", () => {
  it("preserves historical words and counts without generation controls or current-coverage claims", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const before = JSON.stringify(historical);
    render(<EngagementSynthesisPanel initialSynthesis={historical} initialSynthesizedAt="2026-09-01T12:00:00Z" />);
    expect(screen.getByText("SYNTHETIC stored narrative.")).toBeTruthy();
    expect(screen.getByText("SYNTHETIC legacy theme")).toBeTruthy();
    expect(screen.getByText("SYNTHETIC stored theme wording.")).toBeTruthy();
    expect(screen.getByText(/Original record caveat: SYNTHETIC original caveat/)).toBeTruthy();
    expect(screen.getByText(/Stored counts: 299 analyzed of 300 supplied comments/)).toBeTruthy();
    expect(screen.getByText(/at most 300 approved comments, omit survey answers and shorten comment text/)).toBeTruthy();
    expect(screen.getByText(/Complete source coverage, current relevance and staff approval are not established/)).toBeTruthy();
    expect(screen.getByText(/neutral labels were not a sentiment assessment/)).toBeTruthy();
    expect(screen.getByText(/they do not generate AI themes or approve findings/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull(); expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(historical)).toBe(before);
  });
  it("reads the current server record when refreshed without retaining another record in local state", () => {
    const { rerender } = render(<EngagementSynthesisPanel initialSynthesis={historical} initialSynthesizedAt={null} />);
    rerender(<EngagementSynthesisPanel initialSynthesis={{ ...historical, source: "ai", narrative: "SYNTHETIC different retained output." }} initialSynthesizedAt={null} />);
    expect(screen.queryByText("SYNTHETIC stored narrative.")).toBeNull();
    expect(screen.getByText("SYNTHETIC different retained output.")).toBeTruthy();
    expect(screen.queryByText(/neutral labels were not a sentiment assessment/)).toBeNull();
    expect(screen.getByText(/Stored sentiment label:/)).toBeTruthy();
  });
  it("does not invent a saved summary for an empty record", () => {
    render(<EngagementSynthesisPanel initialSynthesis={null} initialSynthesizedAt={null} />);
    expect(screen.getByText("No earlier synthesis summary is saved.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/Stored counts:/)).toBeNull();
  });
});
