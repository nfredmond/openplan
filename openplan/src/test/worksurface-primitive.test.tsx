import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Worksurface, WorksurfaceSection } from "@/components/ui/worksurface";
import { Inspector, InspectorField, InspectorGroup, InspectorEmpty } from "@/components/ui/inspector";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";

describe("Worksurface primitive", () => {
  it("renders all three slots (leftRail + worksurface + inspector) when provided", () => {
    render(
      <Worksurface
        ariaLabel="grants"
        leftRail={<nav data-testid="rail">Rail</nav>}
        worksurface={<main data-testid="work">Work</main>}
        inspector={<section data-testid="inspector">Inspector</section>}
      />
    );
    expect(screen.getByTestId("rail")).toBeTruthy();
    expect(screen.getByTestId("work")).toBeTruthy();
    expect(screen.getByTestId("inspector")).toBeTruthy();
    expect(screen.getByLabelText("grants")).toBeTruthy();
  });

  it("supports worksurface-only variant (no rails)", () => {
    const { container } = render(
      <Worksurface worksurface={<div>Body</div>} />
    );
    expect(container.querySelector("[data-worksurface-slot='left-rail']")).toBeNull();
    expect(container.querySelector("[data-worksurface-slot='inspector']")).toBeNull();
    expect(container.querySelector("[data-worksurface-slot='worksurface']")).not.toBeNull();
  });

  it("full-bleed variant hides inspector even when supplied", () => {
    const { container } = render(
      <Worksurface
        variant="full-bleed"
        worksurface={<div>Body</div>}
        inspector={<div data-testid="inspector">Inspector</div>}
      />
    );
    expect(container.querySelector("[data-worksurface-slot='inspector']")).toBeNull();
    expect(screen.queryByTestId("inspector")).toBeNull();
  });

  it("WorksurfaceSection renders label, title, description, trailing, and body", () => {
    render(
      <WorksurfaceSection
        id="s1"
        label="Lane"
        title="Opportunities"
        description="Recent calls"
        trailing={<span data-testid="trail">T</span>}
      >
        <div data-testid="body">Body</div>
      </WorksurfaceSection>
    );
    expect(screen.getByText("Lane")).toBeTruthy();
    expect(screen.getByText("Opportunities")).toBeTruthy();
    expect(screen.getByText("Recent calls")).toBeTruthy();
    expect(screen.getByTestId("trail")).toBeTruthy();
    expect(screen.getByTestId("body")).toBeTruthy();
  });
});

describe("Inspector primitive", () => {
  it("renders title, subtitle, actions, and body", () => {
    render(
      <Inspector title="Project alpha" subtitle="Selected" actions={<button>X</button>}>
        <InspectorField label="Status" value="Open" />
      </Inspector>
    );
    expect(screen.getByText("Project alpha")).toBeTruthy();
    expect(screen.getByText("Selected")).toBeTruthy();
    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByRole("button", { name: "X" })).toBeTruthy();
  });

  it("supports grouped fields and empty states", () => {
    render(
      <Inspector title="Empty">
        <InspectorGroup label="Funding">
          <InspectorField label="Need" value="$100,000" hint="local match not yet recorded" />
        </InspectorGroup>
        <InspectorEmpty title="No award" description="Pending decision" />
      </Inspector>
    );
    expect(screen.getByText("Funding")).toBeTruthy();
    expect(screen.getByText("$100,000")).toBeTruthy();
    expect(screen.getByText("local match not yet recorded")).toBeTruthy();
    expect(screen.getByText("No award")).toBeTruthy();
    expect(screen.getByText("Pending decision")).toBeTruthy();
  });
});

describe("DataTable primitive", () => {
  type Row = { id: string; title: string; amount: number };

  const columns: Array<DataTableColumn<Row>> = [
    { id: "title", header: "Title", cell: (row) => row.title },
    { id: "amount", header: "Amount", align: "right", cell: (row) => `$${row.amount}` },
  ];

  it("renders rows and headers", () => {
    const rows: Row[] = [
      { id: "a", title: "Alpha", amount: 10 },
      { id: "b", title: "Bravo", amount: 20 },
    ];
    render(
      <DataTable<Row>
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
      />
    );
    expect(screen.getByText("Title")).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("$20")).toBeTruthy();
  });

  it("shows empty state when rows are empty", () => {
    render(
      <DataTable<Row>
        columns={columns}
        rows={[]}
        getRowId={(r) => r.id}
        emptyState={<div data-testid="empty">No data</div>}
      />
    );
    expect(screen.getByTestId("empty")).toBeTruthy();
  });

  it("fires onRowSelect when an interactive row is clicked, and marks selection", () => {
    const rows: Row[] = [{ id: "a", title: "Alpha", amount: 10 }];
    const onRowSelect = vi.fn();
    const { container } = render(
      <DataTable<Row>
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        onRowSelect={onRowSelect}
        selectedRowId="a"
      />
    );
    const row = container.querySelector("tr[data-row-id='a']")!;
    fireEvent.click(row);
    expect(onRowSelect).toHaveBeenCalledTimes(1);
    expect(onRowSelect.mock.calls[0]?.[0]).toEqual(rows[0]);
    expect(row.getAttribute("aria-selected")).toBe("true");
  });
});
