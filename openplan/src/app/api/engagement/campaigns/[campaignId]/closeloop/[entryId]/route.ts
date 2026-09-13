import { responseWriteRoute } from "@/lib/engagement/response-write-route";

export const PATCH = responseWriteRoute("update");
export const DELETE = responseWriteRoute("remove");
