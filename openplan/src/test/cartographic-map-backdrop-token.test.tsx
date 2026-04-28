import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
const ORIGINAL_LEGACY_MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const ORIGINAL_FETCH = global.fetch;

const mockMapConstructor = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

vi.mock("mapbox-gl", () => ({
  default: {
    Map: mockMapConstructor,
    accessToken: "",
  },
}));

function mockEmptyFeatureFetch() {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ type: "FeatureCollection", features: [] }),
  }) as unknown as typeof fetch;
}

async function importBackdrop() {
  vi.resetModules();
  return import("@/components/cartographic/cartographic-map-backdrop");
}

describe("CartographicMapBackdrop Mapbox token guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmptyFeatureFetch();
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = ORIGINAL_MAPBOX_TOKEN;
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = ORIGINAL_LEGACY_MAPBOX_TOKEN;
    global.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it("uses the CSS fallback and does not initialize Mapbox when the public token is an sk.* secret", async () => {
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "sk.secret-token-should-not-reach-mapbox";
    delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

    const { CartographicMapBackdrop } = await importBackdrop();
    const { container } = render(<CartographicMapBackdrop />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    expect(container.querySelector(".op-map-backdrop__canvas")).toBeNull();
    expect(mockMapConstructor).not.toHaveBeenCalled();
  });
});
