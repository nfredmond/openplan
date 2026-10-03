import { parseSynthesisGenerationRequestRecords, type SynthesisGenerationRequestScope } from "./synthesis-generation-request-records";

const digest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, "0")).join("");

/** Verify returned bytes and scope before browser display. Native authorization
 * establishes custody; these hashes do not independently prove authorship.
 */
export async function inspectSynthesisGenerationRequest(raw: unknown, scope: SynthesisGenerationRequestScope) {
  const result = parseSynthesisGenerationRequestRecords(raw, scope), { state } = result;
  if (state.request && await digest(state.request.intentText) !== state.request.intentSha256) throw new Error("Synthesis request bytes differ");
  if (state.cancellation && await digest(state.cancellation.receiptText) !== state.cancellation.receiptSha256) throw new Error("Synthesis cancellation bytes differ");
  return result;
}
