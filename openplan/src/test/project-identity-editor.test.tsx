import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectIdentityEditor } from "@/components/projects/project-identity-editor";
import { DRAWN_PLACE_SOURCE, EMPTY_PLACE_OF_RECORD } from "@/lib/geographies/place-of-record";

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: refreshMock }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// The picker owns place search and a Mapbox surface and has its own tests; here
// it only needs to be able to report a resolved place.
vi.mock("@/components/models/study-area-picker", () => ({
  StudyAreaPicker: ({ onPlaceResolved }: { onPlaceResolved?: (place: unknown) => void }) => (
    <button
      type="button"
      onClick={() =>
        onPlaceResolved?.({
          kind: "county",
          geoid: "39049",
          label: "Franklin County, Ohio",
          geojson: { type: "Polygon", coordinates: [] },
          bbox: { minLon: -83.2, minLat: 39.7, maxLon: -82.7, maxLat: 40.1 },
        })
      }
    >
      resolve place
    </button>
  ),
}));

const PROJECT = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Main Street Corridor",
  summary: null,
  status: "active",
  planType: "corridor_plan",
  deliveryPhase: "scoping",
  place: EMPTY_PLACE_OF_RECORD,
};

describe("ProjectIdentityEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ project: {} }), { status: 200 })));
  });

  it("renames a project through the record PATCH", async () => {
    render(<ProjectIdentityEditor project={PROJECT} canWrite />);

    fireEvent.click(screen.getByRole("button", { name: /edit project/i }));
    fireEvent.change(screen.getByLabelText(/^Name$/i), { target: { value: "Renamed corridor" } });
    fireEvent.click(screen.getByRole("button", { name: /save project/i }));

    await waitFor(() => {
      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe(`/api/projects/${PROJECT.id}`);
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(init.body).name).toBe("Renamed corridor");
    });
  });

  it("sends a searched place as a REFERENCE, never a client-supplied boundary", async () => {
    render(<ProjectIdentityEditor project={PROJECT} canWrite />);

    fireEvent.click(screen.getByRole("button", { name: /set study area/i }));
    fireEvent.click(screen.getByRole("button", { name: /resolve place/i }));
    fireEvent.click(screen.getByRole("button", { name: /save study area/i }));

    await waitFor(() => {
      const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.place).toEqual({ mode: "place", kind: "county", geoid: "39049" });
      // The server re-resolves. A client-supplied bbox or geometry would be an
      // unverifiable geography wearing trusted-looking provenance.
      expect(body.place.bbox).toBeUndefined();
      expect(body.place.geometry).toBeUndefined();
    });
  });

  it("names the real fallback when no area is set, and never invents one", () => {
    const { rerender } = render(
      <ProjectIdentityEditor project={PROJECT} canWrite workspaceHomeLabel="Franklin County, Ohio" />
    );
    expect(screen.getByText(/home geography \(Franklin County, Ohio\)/i)).toBeTruthy();

    rerender(<ProjectIdentityEditor project={PROJECT} canWrite workspaceHomeLabel={null} />);
    expect(screen.getByText(/every module will ask each time/i)).toBeTruthy();
  });

  it("says out loud that a drawn area has no identity", () => {
    render(
      <ProjectIdentityEditor
        project={{
          ...PROJECT,
          place: { ...EMPTY_PLACE_OF_RECORD, label: "Main St area", source: DRAWN_PLACE_SOURCE },
        }}
        canWrite
      />
    );

    expect(screen.getByText(/cannot derive a county filter/i)).toBeTruthy();
  });

  it("renders the server's delete refusal rather than guessing ahead of it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              headline: "This project has attached records.",
              alternative: "Set the project's status to complete to retire it.",
              blockers: [
                {
                  table: "reports",
                  label: "reports",
                  count: 2,
                  severity: "evidence",
                  behavior: "cascade",
                  reason: "2 reports would be deleted along with the project.",
                  href: "/reports",
                },
              ],
            }),
            { status: 409 }
          )
      )
    );

    render(<ProjectIdentityEditor project={PROJECT} canWrite />);
    fireEvent.click(screen.getByRole("button", { name: /delete project/i }));

    await waitFor(() => {
      expect(screen.getByText(/would be deleted along with the project/i)).toBeTruthy();
      // The SERVER's sentence, not the static help text above it — the refusal
      // has to render what the server actually found.
      expect(screen.getByText("Set the project's status to complete to retire it.")).toBeTruthy();
      expect(screen.getByText("This project has attached records.")).toBeTruthy();
      // Rendered twice by design: once as the count badge, once inside the reason.
      expect(screen.getAllByText(/2 reports/).length).toBeGreaterThanOrEqual(1);
    });
    // A refusal must not navigate away as though it had worked.
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("offers no write controls to a viewer", () => {
    render(<ProjectIdentityEditor project={PROJECT} canWrite={false} />);

    expect(screen.queryByRole("button", { name: /edit project/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /set study area/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete project/i })).toBeNull();
  });
});
