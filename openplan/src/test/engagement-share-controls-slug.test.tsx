import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EngagementShareControls } from "@/components/engagement/engagement-share-controls";

/**
 * The "Easy link name" field — the WRITER for engagement_campaigns.public_slug
 * (20260810000002). The public resolver for /engage/{slug} shipped first; this
 * field is what keeps it from being a door nobody can put an address on.
 *
 * The save contract matters as much as the field: the console reads the slug
 * column failure-tolerantly, so the component may only send `publicSlug` when
 * the planner actually edited it — an untouched save carrying an empty value
 * would clear a live printed address on the strength of a failed read.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function campaign(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    title: "Downtown listening",
    status: "active",
    share_token: "abcdef0123456789abcdef01",
    public_description: "Tell us about downtown.",
    public_slug: null,
    allow_public_submissions: true,
    submissions_closed_at: null,
    demographics_enabled: false,
    ...overrides,
  };
}

const fetchMock = vi.fn();

function slugField() {
  return screen.getByLabelText(/easy link name/i);
}

function saveButton() {
  return screen.getByText("Save share settings");
}

function bodyOfCall(index: number): Record<string, unknown> {
  return JSON.parse((fetchMock.mock.calls[index][1] as { body: string }).body);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EngagementShareControls — the printable link name", () => {
  it("shows the full printable address when a link name is set", () => {
    // A name that appears nowhere in the helper copy, so the match below can
    // only be the rendered address itself.
    render(<EngagementShareControls campaign={campaign({ public_slug: "elm-creek-trail-plan" })} />);

    expect(slugField()).toBeTruthy();
    expect(screen.getByText(/Printable address:/)).toBeTruthy();
    expect(screen.getByText(/\/engage\/elm-creek-trail-plan/)).toBeTruthy();
  });

  it("explains the field in planner language, not database language", () => {
    render(<EngagementShareControls campaign={campaign()} />);
    expect(screen.getByText(/read off a flyer/i)).toBeTruthy();
    expect(screen.queryByText(/slug/i)).toBeNull();
  });

  it("sends the link name only when edited, and sends what was typed — binding varied", async () => {
    render(<EngagementShareControls campaign={campaign()} />);

    // Untouched save: no publicSlug key at all, so a failed slug read can
    // never be replayed as a deliberate clear.
    fireEvent.click(saveButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect("publicSlug" in bodyOfCall(0)).toBe(false);

    // First edit travels, lowercased as typed.
    fireEvent.change(slugField(), { target: { value: "Jefferson-Street-Study" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(bodyOfCall(1).publicSlug).toBe("jefferson-street-study");

    // A DIFFERENT edit travels as itself — one fixture cannot tell "threads
    // the binding" from "hardcodes its value".
    fireEvent.change(slugField(), { target: { value: "oak-avenue-plan" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(bodyOfCall(2).publicSlug).toBe("oak-avenue-plan");
  });

  it("clears with an emptied field, sent as null", async () => {
    render(<EngagementShareControls campaign={campaign({ public_slug: "jefferson-street-study" })} />);

    fireEvent.change(slugField(), { target: { value: "" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(bodyOfCall(0).publicSlug).toBeNull();
  });

  it("refuses a bad name before sending anything, with the shared sentence", async () => {
    render(<EngagementShareControls campaign={campaign()} />);

    fireEvent.change(slugField(), { target: { value: "not a link name!" } });
    fireEvent.click(saveButton());

    // The refusal sentence, not the helper copy — the shared constant opens
    // with "A link name uses…", which the helper text does not.
    expect(await screen.findByText(/A link name uses lowercase letters/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the server's 'taken' refusal to the planner", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "That link name is taken — another campaign is already using it. Pick a different one." }),
    });
    render(<EngagementShareControls campaign={campaign()} />);

    fireEvent.change(slugField(), { target: { value: "downtown-plan" } });
    fireEvent.click(saveButton());

    expect(await screen.findByText(/That link name is taken/)).toBeTruthy();
  });
});
