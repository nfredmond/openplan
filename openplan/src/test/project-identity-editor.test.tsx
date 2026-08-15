import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  confirmDestructiveAction,
  confirmDialogText,
  declineConfirmation,
} from "./helpers/confirm-dialog";
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

  /**
   * A HAND-DRAWN AREA HAS NO PLACE NAME, AND THIS ONCE READ THAT AS NO AREA.
   *
   * A fresh tester drew a study-area polygon, saved it, reloaded, and this
   * readout said "No study area set" while the board on the same page said the
   * area "was drawn by hand". Saving had worked; the readout was asking the
   * wrong question — `label`, which a saved drawn area does not carry, instead
   * of `source`, which says whether one exists at all. The case above this one
   * covers a drawn area that DOES have a name; this is the one a planner
   * actually produces by drawing.
   */
  it("shows a saved hand-drawn area with no name as present, not as no study area", () => {
    render(
      <ProjectIdentityEditor
        project={{
          ...PROJECT,
          place: {
            ...EMPTY_PLACE_OF_RECORD,
            source: DRAWN_PLACE_SOURCE,
            label: null,
            geometry: { type: "Polygon", coordinates: [] },
          },
        }}
        canWrite
      />
    );

    // The denial is the defect; its absence is the assertion that matters.
    expect(screen.queryByText(/no study area set/i)).toBeNull();
    // "Drawn area" appears twice by design — the badge naming the unnamed shape,
    // and the sentence saying what a drawn area cannot be used for downstream.
    expect(screen.getAllByText(/drawn area/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/cannot derive a county filter/i)).toBeTruthy();
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

  it("asks the server what is attached BEFORE deleting, and renders its refusal", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            deletable: false,
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
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);

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
    // NAMED, AND LINKED. A blocker a planner cannot navigate to is a refusal
    // they have to go and hunt for; the server sends the href for this reason.
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/reports");

    // THE POINT OF THE PRE-FLIGHT: nothing was attempted. The old control found
    // this out by issuing the DELETE and reading the 409, which meant the
    // planner had to reach for the irreversible action to learn it was refused.
    const methods = fetchMock.mock.calls.map((call) => call[1]?.method ?? "GET");
    expect(methods).toEqual(["GET"]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/delete-preflight");
    // No question is asked either: there is nothing to agree to.
    expect(screen.queryByRole("alertdialog")).toBeNull();
    // A refusal must not navigate away as though it had worked.
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("asks before deleting an empty project, and deletes only after the planner agrees", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      String(url).includes("/delete-preflight")
        ? new Response(
            JSON.stringify({
              deletable: true,
              headline: "Nothing is attached to this project, so deleting it removes only the project record.",
              alternative: "",
              blockers: [],
            }),
            { status: 200 }
          )
        : new Response(JSON.stringify({ deleted: { id: PROJECT.id } }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<ProjectIdentityEditor project={PROJECT} canWrite />);
    fireEvent.click(screen.getByRole("button", { name: /delete project/i }));

    // The empty case was the one that used to delete on a single click, with no
    // question anywhere — the irreversible path was the unguarded one.
    const copy = await confirmDialogText();
    expect(copy).toContain("Main Street Corridor");
    expect(copy).toContain("removes only the project record");
    expect(copy).toContain("This cannot be undone.");

    await confirmDestructiveAction("Delete this project");
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/projects"));
    expect(
      fetchMock.mock.calls.some((call) => call[1]?.method === "DELETE")
    ).toBe(true);
  });

  it("deletes nothing when the planner backs out of the question", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({ deletable: true, headline: "Nothing is attached.", alternative: "", blockers: [] }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<ProjectIdentityEditor project={PROJECT} canWrite />);
    fireEvent.click(screen.getByRole("button", { name: /delete project/i }));
    await declineConfirmation();

    expect(
      fetchMock.mock.calls.some((call) => call[1]?.method === "DELETE")
    ).toBe(false);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("offers the reversible alternative inside the question, and takes it without deleting", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({ deletable: true, headline: "Nothing is attached.", alternative: "", blockers: [] }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<ProjectIdentityEditor project={PROJECT} canWrite />);
    fireEvent.click(screen.getByRole("button", { name: /delete project/i }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark it complete instead" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        (call) => call[1]?.method === "PATCH"
      );
      expect(patch).toBeDefined();
      expect(JSON.parse(String(patch![1]!.body))).toEqual({ status: "complete" });
    });
    expect(
      fetchMock.mock.calls.some((call) => call[1]?.method === "DELETE")
    ).toBe(false);
  });

  it("offers no write controls to a viewer", () => {
    render(<ProjectIdentityEditor project={PROJECT} canWrite={false} />);

    expect(screen.queryByRole("button", { name: /edit project/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /set study area/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete project/i })).toBeNull();
  });
});
