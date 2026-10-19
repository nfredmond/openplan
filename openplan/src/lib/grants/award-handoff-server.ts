import "server-only";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { AWARD_HANDOFF_MIGRATION } from "./award-handoff";

export function handoffFailure(error: { code?: string; message: string }) {
  const missing = /schema cache|does not exist|could not find.*function|could not find.*column/i.test(error.message);
  const status = missing ? 503 : ["PT409", "40001"].includes(error.code ?? "") ? 409 : error.code === "42501" ? 403 : ["22023", "23514", "23503", "22P02", "22007", "22008"].includes(error.code ?? "") ? 422 : 500;
  return NextResponse.json({ error: missing ? `Award handoff requires migration ${AWARD_HANDOFF_MIGRATION}.` : status === 500 ? "Award handoff failed. Retain and retry the exact reviewed request after a lost response." : error.message }, { status });
}

type VerifiedSource = { id: string; checksum: string; byteSize: number; objectIdentity: unknown };
/** The SQL snapshot has already checked actor/same-audience/source scope. Verify actual
 * bytes against its stored upload checksum. SQL compares and locks the exact object
 * identity at apply; object/row guards prevent replacement while the source exists. */
export async function verifyHandoffBytes(reviewed: Record<string, unknown>): Promise<VerifiedSource[]> {
  const state = reviewed.state as { sources?: Array<{ id: string; bucket: string; objectName: string; checksum: string; byteSize: number; objectIdentity: unknown }> } | undefined;
  if (!state || !Array.isArray(state.sources) || !state.sources.length) throw new Error("Actual retained notice PDF required");
  const verified: VerifiedSource[] = [];
  const service = createServiceRoleClient();
  for (const source of state.sources) {
    if (source.bucket !== "kb-documents" || !source.objectName.startsWith(`${(reviewed.state as { workspaceId: string }).workspaceId}/${source.id}/`)) throw new Error("Excluded source storage identity");
    const result = await service.storage.from(source.bucket).download(source.objectName);
    if (result.error || !result.data) throw new Error("Original notice bytes unavailable");
    const bytes = Buffer.from(await result.data.arrayBuffer());
    if (bytes.byteLength !== Number(source.byteSize) || createHash("sha256").update(bytes).digest("hex") !== source.checksum || !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("Original notice bytes differ from the retained upload checksum or PDF identity");
    verified.push({ id: source.id, checksum: source.checksum, byteSize: source.byteSize, objectIdentity: source.objectIdentity });
  }
  return verified;
}

export async function managedCloseout(input: { actorId: string; awardId: string; expectedRevisionId: string | null | undefined; event: "earned_coverage" | "reopen"; note: string | null }) {
  if (!input.expectedRevisionId && input.event!=="reopen") return NextResponse.json({ error: "Review current award conditions and supply expectedCurrentRevisionId." }, { status: 409 });
  const result = await createServiceRoleClient().rpc("managed_award_closeout", { p_actor: input.actorId, p_award: input.awardId, p_expected: input.expectedRevisionId ?? null, p_event: input.event, p_note: input.note });
  if (result.error) return handoffFailure(result.error);
  return NextResponse.json(result.data);
}
