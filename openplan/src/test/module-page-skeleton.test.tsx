import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ModulePageSkeleton } from "@/components/ui/module-page-skeleton";

describe("ModulePageSkeleton", () => {
  it("renders the module-page worksurface shell with a header shimmer", () => {
    const { container } = render(<ModulePageSkeleton />);

    const root = container.querySelector('[data-testid="module-page-skeleton"]');
    expect(root).not.toBeNull();
    expect(root).toHaveClass("module-page");
    expect(root?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector(".module-header-grid")).not.toBeNull();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("renders one record-list surface per requested section", () => {
    const { container } = render(<ModulePageSkeleton sections={5} rowsPerSection={2} />);

    expect(container.querySelectorAll(".module-record-list")).toHaveLength(5);

    const firstList = container.querySelector(".module-record-list");
    expect(firstList?.querySelectorAll(".module-record-row")).toHaveLength(2);
  });
});
