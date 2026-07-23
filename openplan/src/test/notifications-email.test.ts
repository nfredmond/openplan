import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emailTransportName, isEmailTransportConfigured, sendEmail } from "@/lib/notifications/email";

describe("email transport seam", () => {
  const original = process.env.RESEND_API_KEY;
  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
  });
  afterEach(() => {
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
});
