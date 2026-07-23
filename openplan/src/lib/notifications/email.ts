// Email transport seam. At $0 there is NO provider configured, so sendEmail()
// honestly no-ops (mirroring the pervasive "AI offline" fallback) — it never
// pretends to have delivered. A provider is added later by setting RESEND_API_KEY
// (+ optional RESEND_FROM_EMAIL) with no other code change; the caller always
// records the message in engagement_email_outbox regardless, so nothing is lost.

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

export type EmailSendResult = {
  delivered: boolean;
  transport: string; // "none" when unconfigured, otherwise the provider name
  error?: string;
  reason?: string; // e.g. "not_configured"
};

export function isEmailTransportConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

/** Human-readable transport name for honest UI/labelling ("none" at $0). */
export function emailTransportName(): string {
  return isEmailTransportConfigured() ? "resend" : "none";
}

export async function sendEmail(message: EmailMessage): Promise<EmailSendResult> {
  if (!isEmailTransportConfigured()) {
    // Honest no-op. The outbox row (written by the caller) is the durable record.
    console.info("[notifications] email transport not configured — skipping send", { to: message.to, subject: message.subject });
    return { delivered: false, transport: "none", reason: "not_configured" };
  }

  const from = process.env.RESEND_FROM_EMAIL?.trim() || "OpenPlan <onboarding@resend.dev>";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({ from, to: message.to, subject: message.subject, text: message.text }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { delivered: false, transport: "resend", error: `HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}` };
    }
    return { delivered: true, transport: "resend" };
  } catch (error) {
    return { delivered: false, transport: "resend", error: error instanceof Error ? error.message : "send failed" };
  }
}
