import { describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((..._args: unknown[]) => {
  // Next's redirect() throws; the stub must too, so nothing runs past it.
  throw new Error("redirect");
});

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
}));

import CommandCenterRedirectPage from "@/app/(app)/command-center/page";

/**
 * /command-center is a redirect stub into /dashboard — the Overview page
 * absorbed the Command Center in the 2026-08-10 navigation overhaul (both
 * rendered the same workspace command board, and the recent-actions feed moved
 * to the dashboard). The stub exists for saved bookmarks and deep links, so
 * what it must do is forward, query string intact, and render nothing.
 */
describe("CommandCenterRedirectPage", () => {
  it("redirects to /dashboard", async () => {
    await expect(
      CommandCenterRedirectPage({ searchParams: Promise.resolve({}) })
    ).rejects.toThrow("redirect");

    expect(redirectMock).toHaveBeenCalledWith("/dashboard");
  });

  it("forwards the query string so saved deep links keep working", async () => {
    redirectMock.mockClear();

    await expect(
      CommandCenterRedirectPage({
        searchParams: Promise.resolve({
          view: "insights",
          tags: ["a", "b"],
          empty: undefined,
        }),
      })
    ).rejects.toThrow("redirect");

    const target = redirectMock.mock.calls[0]?.[0] as string;
    expect(target.startsWith("/dashboard?")).toBe(true);
    expect(target).toContain("view=insights");
    // Array params carry their first value; absent values are dropped.
    expect(target).toContain("tags=a");
    expect(target).not.toContain("empty");
  });

  it("redirects with no query when none was given", async () => {
    redirectMock.mockClear();

    await expect(CommandCenterRedirectPage({})).rejects.toThrow("redirect");
    expect(redirectMock).toHaveBeenCalledWith("/dashboard");
  });
});
