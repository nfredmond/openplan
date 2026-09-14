import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SynthesisSourceInspection } from "@/components/engagement/synthesis-source-inspection";
import { makeSourceSnapshot, savedSource } from "./fixtures/engagement/synthesis-source";

afterEach(cleanup);
describe("prepared source inspection", () => {
  it("shows complete counts and all group members through search and paging, with assessment limits", () => {
    const snapshot = makeSourceSnapshot(301);
    render(<SynthesisSourceInspection snapshot={snapshot} sha256={savedSource(snapshot).snapshotSha256} />);
    expect(screen.getByText("302 contributions accounted for: 301 comments, 0 replies and 1 survey answers.")).toBeTruthy();
    expect(screen.getByText(/Themes, sentiment, typed-answer interpretation and representative support are not assessed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next source page" }));
    expect(screen.getByText(/Page 2 of 13/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search all retained contributions"), { target: { value: "FINAL SOURCE TAIL" } });
    expect(screen.getByText(/SYNTHETIC long concern é/, { selector: "p" }).textContent).toContain("FINAL SOURCE TAIL");
    fireEvent.change(screen.getByLabelText("Inspect a prepared group"), { target: { value: "question:0" } });
    expect(screen.getByLabelText("Search all retained contributions")).toHaveValue("");
    expect(screen.getByText(/1 matching contributions. Page 1 of 1/)).toBeTruthy();
    expect(screen.queryByText(/SYNTHETIC long concern é/, { selector: "p" })).toBeNull();
    expect(screen.getByText("SYNTHETIC distinct survey concern")).toBeTruthy();
    expect(screen.getByText(`answer:${snapshot.answers[0].id}`, { selector: "pre" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Inspect a prepared group"), { target: { value: "category:0" } });
    expect(screen.getByText(/302 matching contributions. Page 1 of 13/)).toBeTruthy();
    expect(screen.getByText(/item:b0000000-0000-4000-8000-000000000300/, { selector: "pre" }).textContent).toContain(`answer:${snapshot.answers[0].id}`);
    fireEvent.change(screen.getByLabelText("Inspect a prepared group"), { target: { value: "" } });
    expect(screen.queryByText("Complete group membership")).toBeNull();
  });
  it("displays unavailable historical context and sessions without selected answers explicitly", () => {
    const snapshot = makeSourceSnapshot(1);
    snapshot.items[0].configuration_version_id = null;
    snapshot.answers = []; snapshot.counts.answers = 0;
    render(<SynthesisSourceInspection snapshot={snapshot} sha256={savedSource(snapshot).snapshotSha256} />);
    expect(screen.getByText(/1 retained survey responses have no selected answers/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Inspect a prepared group"), { target: { value: "category:0" } });
    expect(screen.getByText("Historical definition unavailable: 1 contributions. Historical definition unavailable.")).toBeTruthy();
    expect(screen.getByText("Historical version: unavailable.")).toBeTruthy();
  });
});
