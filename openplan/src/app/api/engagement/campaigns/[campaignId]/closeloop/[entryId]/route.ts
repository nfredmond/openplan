import { responseWriteRoute } from "@/lib/engagement/response-write-route";
import { createApiAuditLogger } from "@/lib/observability/audit";

export const PATCH = responseWriteRoute("update", request => createApiAuditLogger("engagement.response.update", request));
export const DELETE = responseWriteRoute("remove", request => createApiAuditLogger("engagement.response.remove", request));
