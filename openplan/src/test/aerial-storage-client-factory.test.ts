import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.create }));
vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
import { createServiceRoleClient } from "@/lib/supabase/server";

describe("aerial Storage client configuration authority", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    mocks.create.mockClear();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://isolated-target.example.invalid");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
  });

  it("preserves the configured target and forwards the supplied cancellable transport", () => {
    const transport = vi.fn() as unknown as typeof fetch;
    createServiceRoleClient({ fetchImpl: transport });
    expect(mocks.create, "Factory preserves the original configuration authority").toHaveBeenCalledWith(
      "https://isolated-target.example.invalid", "synthetic-service-key",
      { global: { fetch: transport }, auth: { persistSession: false, autoRefreshToken: false } }
    );
  });

  it("keeps default service clients on the existing SDK transport", () => {
    createServiceRoleClient();
    expect(mocks.create, "Default callers retain their SDK transport").toHaveBeenCalledWith(
      "https://isolated-target.example.invalid", "synthetic-service-key",
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  });

  it("refuses a missing configured target before constructing a Storage client", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(() => createServiceRoleClient({ fetchImpl: vi.fn() as unknown as typeof fetch })).toThrow(
      "Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL"
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
