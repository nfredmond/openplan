import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess } from "@/lib/engagement/api";
import {
  loadCampaignEmailDeliverySummary,
  loadOperatorNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type EmailDeliverySummary,
} from "@/lib/notifications/engagement";
import { emailTransportName } from "@/lib/notifications/email";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";

const paramsSchema = z.object({ campaignId: z.string().uuid() });

const patchSchema = z
  .object({
    notificationId: z.string().uuid().optional(),
    markAllRead: z.boolean().optional(),
  })
  .refine((body) => Boolean(body.notificationId) || body.markAllRead === true, "Nothing to mark read");

type RouteContext = { params: Promise<{ campaignId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.notifications.list", request);
  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) return NextResponse.json({ error: "Invalid campaign id" }, { status: 400 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const access = await loadCampaignAccess(supabase, routeParams.data.campaignId, user.id, "engagement.read");
    if (access.error) return NextResponse.json({ error: "Failed to verify engagement campaign access" }, { status: 500 });
    if (!access.campaign) return NextResponse.json({ error: "Engagement campaign not found" }, { status: 404 });
    if (!access.allowed) return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });

    const notifications = await loadOperatorNotifications(supabase, access.campaign.id, { limit: 50 });
    const unreadCount = notifications.filter((n) => !n.is_read).length;

    // Delivery status for this campaign's outbox. The outbox holds participant
    // email addresses, so it is service-role-only and the summary carries counts
    // rather than recipients. Every message written since 2026-07-22 has been
    // recorded there and NOTHING displayed it, so an operator who broadcast a
    // "You said / We did" update could not find out whether it left the building.
    // Failing to read it must not take the notification list down with it, and a
    // deployment with no service-role key must say THAT rather than report zero.
    let emailDelivery: EmailDeliverySummary;
    try {
      emailDelivery = await loadCampaignEmailDeliverySummary(createServiceRoleClient(), access.campaign.id);
    } catch (deliveryError) {
      emailDelivery = {
        ok: false,
        message: deliveryError instanceof Error ? deliveryError.message : String(deliveryError),
      };
    }

    return NextResponse.json({
      notifications,
      unreadCount,
      emailDelivery,
      // The transport in effect right now, which is a different fact from what
      // the historical rows were sent through.
      emailTransport: emailTransportName(),
    });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Unexpected error while listing notifications" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.notifications.mark_read", request);
  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) return NextResponse.json({ error: "Invalid campaign id" }, { status: 400 });

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
    if (!payloadBody.ok) return payloadBody.response;
    const parsed = patchSchema.safeParse(payloadBody.data);
    if (!parsed.success) return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const access = await loadCampaignAccess(supabase, routeParams.data.campaignId, user.id, "engagement.read");
    if (access.error) return NextResponse.json({ error: "Failed to verify engagement campaign access" }, { status: 500 });
    if (!access.campaign) return NextResponse.json({ error: "Engagement campaign not found" }, { status: 404 });
    if (!access.allowed) return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });

    if (parsed.data.markAllRead) {
      await markAllNotificationsRead(supabase, access.campaign.id);
      return NextResponse.json({ ok: true });
    }

    const result = await markNotificationRead(supabase, { notificationId: parsed.data.notificationId as string, campaignId: access.campaign.id });
    // A write that failed and a write that matched no rows are different
    // answers: the first is ours to fix, the second means no such notification
    // in this campaign. Reporting both as 404 hid the first one.
    if (!result.ok) return NextResponse.json({ error: "Failed to mark the notification read" }, { status: 500 });
    if (!result.found) return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Unexpected error while updating notifications" }, { status: 500 });
  }
}
