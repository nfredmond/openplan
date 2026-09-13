import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emailTransportName, isEmailTransportConfigured, sendEmail } from "@/lib/notifications/email";

describe("email transport seam", () => {
  const original = process.env.RESEND_API_KEY;
  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (original === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = original;
  });

  it("reports unconfigured at $0 and honestly no-ops sendEmail (never claims delivery)", async () => {
    expect(isEmailTransportConfigured()).toBe(false);
    expect(emailTransportName()).toBe("none");

    const result = await sendEmail({ to: "a@example.com", subject: "Hi", text: "Body" });
    expect(result.delivered).toBe(false);
    expect(result.transport).toBe("none");
    expect(result.reason).toBe("not_configured");
  });

  it("reports configured when a key is present", () => {
    process.env.RESEND_API_KEY = "re_test_key";
    expect(isEmailTransportConfigured()).toBe(true);
    expect(emailTransportName()).toBe("resend");
  });
  it("bounds a stalled provider request and preserves its unknown delivery result", async () => {
    process.env.RESEND_API_KEY = "SYNTHETIC_NO_NETWORK";
    const nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => nativeTimeout(1));
    const fetch = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      if (!options.signal) { reject(new Error("No deadline")); return; }
      options.signal.addEventListener("abort", () => reject(new Error("Provider response was interrupted")));
    }));
    vi.stubGlobal("fetch", fetch);
    const result = await sendEmail({ to: "recipient@example.invalid", subject: "SYNTHETIC timeout", text: "No live delivery" });
    expect(timeout).toHaveBeenCalledExactlyOnceWith(20_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ delivered: false, transport: "resend", error: "Provider response was interrupted" });
  });
});
