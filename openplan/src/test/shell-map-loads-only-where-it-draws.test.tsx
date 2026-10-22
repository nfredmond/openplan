/**
 * THE SHELL MAP, AND MAPBOX-GL WITH IT, LOADS ONLY WHERE IT DRAWS.
 *
 * `cartographic-shell.tsx` imported the 2,500-line backdrop statically, which
 * put mapbox-gl in the bundle of every signed-in page while the backdrop drew
 * only on the Aerial index (two-month review, finding 10). The shell now mounts
 * a loader that imports the backdrop with `next/dynamic` behind the route check.
 *
 * What this cannot prove: bundle sizes. It proves the module is not requested
 * off a map route, and the shell does not import it directly. A build and a
 * bundle report would measure the bytes; neither was run here.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pathname: "/projects", backdropImported: 0 }));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
}));

vi.mock("@/components/cartographic/cartographic-map-backdrop", () => {
  state.backdropImported += 1;
  return {
    CartographicMapBackdrop: ({ workspaceId }: { workspaceId?: string | null }) => (
      <div data-testid="shell-backdrop" data-workspace={workspaceId ?? ""} />
    ),
  };
});

async function renderLoader(pathname: string) {
  state.pathname = pathname;
  const { CartographicMapBackdropLoader } = await import(
    "@/components/cartographic/cartographic-map-backdrop-loader"
  );
  return render(<CartographicMapBackdropLoader workspaceId="ws-1" />);
}

beforeEach(() => {
  vi.resetModules();
  state.backdropImported = 0;
  delete document.body.dataset.mapOwner;
});

afterEach(() => cleanup());

describe("the shell map loader", () => {
  it("never requests the backdrop on an ordinary page, and still marks the page", async () => {
    await renderLoader("/projects");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(state.backdropImported).toBe(0);
    expect(screen.queryByTestId("shell-backdrop")).toBeNull();
    // The flag the backdrop used to set here; it hides the shell's inspector dock.
    expect(document.body.dataset.mapOwner).toBe("true");
  });

  it("does not load it on a route that builds its own map either", async () => {
    await renderLoader("/safety");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(state.backdropImported).toBe(0);
    expect(document.body.dataset.mapOwner).toBe("true");
  });

  it("loads and draws the backdrop on the Aerial index", async () => {
    await renderLoader("/aerial");
    expect(await screen.findByTestId("shell-backdrop")).toHaveAttribute("data-workspace", "ws-1");
    expect(state.backdropImported).toBe(1);
    expect(document.body.dataset.mapOwner).toBeUndefined();
  });

  it("is what the shell mounts; the shell does not import the backdrop itself", () => {
    const shell = readFileSync(
      path.join(process.cwd(), "src/components/cartographic/cartographic-shell.tsx"),
      "utf8",
    );
    expect(shell).toMatch(/import\s*\{\s*CartographicMapBackdropLoader\s*\}\s*from\s*["']\.\/cartographic-map-backdrop-loader["']/);
    expect(shell).toContain("<CartographicMapBackdropLoader");
    expect(shell).not.toMatch(/from\s*["']\.\/cartographic-map-backdrop["']/);
    expect(shell).not.toMatch(/from\s*["']mapbox-gl["']/);
  });
});
