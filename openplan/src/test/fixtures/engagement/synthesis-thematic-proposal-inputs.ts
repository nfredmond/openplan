import type { SupabaseClient } from "@supabase/supabase-js";
import { createSynthesisThematicInputPreparer, verifySynthesisThematicInput } from "@/lib/engagement/synthesis-thematic-inputs-server";
import { createSynthesisThematicInputManifest } from "@/lib/engagement/synthesis-thematic-input-manifest";
import { loadSynthesisThematicProposalInputs } from "@/lib/engagement/synthesis-thematic-proposal-inputs-server";
import { synthesisThematicPreparationFixture } from "./synthesis-thematic-preparation";
import { addThematicPreparationContext } from "./synthesis-thematic-preparation-context";
import { sourceHash as hash } from "./synthesis-source";

/** Transport-only fixture with actual source, context replay, input retention
 * and complete manifest construction. Native permissions are tested separately.
 */
export async function thematicProposalInputsFixture() {
  const f = await synthesisThematicPreparationFixture(), snapshot = JSON.parse(f.sourceRow.snapshot_text);
  const otherTarget = f.scope.targetRecordId.startsWith("answer:") ? `item:${snapshot.items[0].id}` : `answer:${snapshot.answers[0].id}`;
  const other = await addThematicPreparationContext(f, otherTarget, true);
  const { targetRecordId: _target, ...scope } = f.scope;
  const saved = { ...f.bundle.source, snapshotText: f.sourceRow.snapshot_text };
  type Record = ReturnType<typeof verifySynthesisThematicInput>["record"];
  const records = new Map<string, Record>(), calls: Array<{ name: string; args: { [key: string]: unknown }; signal?: AbortSignal }> = [];
  const metadata = () => [...records.values()].map(record => ({ targetRecordId: record.targetRecordId, proofText: record.proofText,
    proofSha256: record.proofSha256, outputSha256: record.outputSha256, outputBytes: Buffer.byteLength(record.outputText) }))
    .sort((a, b) => a.targetRecordId < b.targetRecordId ? -1 : 1);
  const plan = () => createSynthesisThematicInputManifest(f.bundle.thematic, scope, saved, metadata());
  const makeSeal = () => { const p = plan(), receiptText = JSON.stringify({ schemaVersion: 1, purpose: "private_synthesis_thematic_input_seal",
    requestId: scope.requestId, manifestSha256: p.manifestSha256, sealedAt: saved.createdAt });
    return { manifestText: p.manifestText, manifestSha256: p.manifestSha256, receiptText, receiptSha256: hash(receiptText) }; };
  type Seal = ReturnType<typeof makeSeal>;
  type Page = { schemaVersion: number; campaignId: string; workspaceId: string; requestId: string;
    thematic: typeof f.bundle.thematic; source: typeof f.bundle.source; afterTargetRecordId: unknown;
    hasMore: boolean; entries: ReturnType<typeof metadata>; seal: Seal | null };
  const options = { missingTarget: "", seal: null as Seal | null, deny: "", denyInventory: 0, inventoryReads: 0, abortInput: false,
    changeInventory: null as null | ((page: Page) => void), changeRecord: null as null | ((record: Record) => void) };
  function page(args: { [key: string]: unknown }): Page {
    const remaining = metadata().filter(row => args.p_after_target === null || row.targetRecordId > String(args.p_after_target));
    const limit = Number(args.p_limit);
    return { schemaVersion: 1, ...scope, thematic: structuredClone(f.bundle.thematic), source: { ...f.bundle.source },
      afterTargetRecordId: args.p_after_target, hasMore: remaining.length > limit, entries: remaining.slice(0, limit), seal: options.seal && { ...options.seal } };
  }
  const rpc = (name: string, args: { [key: string]: unknown }) => {
    if (!["retain_engagement_synthesis_thematic_input", "read_engagement_synthesis_thematic_input", "read_engagement_synthesis_thematic_input_inventory"].includes(name)) return f.service.rpc(name, args);
    const call = { name, args, signal: undefined as AbortSignal | undefined }; calls.push(call);
    const result = (async () => {
      let data: unknown;
      if (name === "retain_engagement_synthesis_thematic_input") {
        const key = String(args.p_target), replayed = records.has(key);
        if (!replayed) records.set(key, { schemaVersion: 1, requestId: String(args.p_request), targetRecordId: key,
          proofText: String(args.p_proof_text), proofSha256: hash(String(args.p_proof_text)), outputText: String(args.p_output_text),
          outputSha256: hash(String(args.p_output_text)), createdAt: saved.createdAt });
        data = { ...records.get(key)!, replayed };
      } else if (name === "read_engagement_synthesis_thematic_input") {
        const record = args.p_target === options.missingTarget ? undefined : records.get(String(args.p_target)); data = record ? structuredClone(record) : null;
        if (data) options.changeRecord?.(data as Record);
        if (options.abortInput) f.f.controller.abort();
      } else {
        options.inventoryReads++; const value = page(args); options.changeInventory?.(value); data = value;
      }
      return { data, error: options.deny === name || (name.endsWith("_inventory") && options.denyInventory === options.inventoryReads) ? { code: "42501" } : null };
    })();
    return Object.assign(result, { abortSignal(signal: AbortSignal) { call.signal = signal; return result; } });
  };
  const service = { rpc, from: f.service.from } as unknown as Pick<SupabaseClient, "rpc" | "from">;
  const prepare = createSynthesisThematicInputPreparer(service, scope);
  for (const target of [f.scope.targetRecordId, otherTarget]) await prepare(target, f.f.controller.signal);
  options.seal = makeSeal(); calls.length = 0; f.calls.length = 0; f.f.trace.length = 0; f.options.reads = 0;
  return { f, other, scope, saved, service, records, metadata, plan, makeSeal, options, calls,
    load: () => loadSynthesisThematicProposalInputs(service, scope, f.f.controller.signal) };
}
