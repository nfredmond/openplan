import { observeNodeQueue } from "../../src/lib/ops/node-queue-observation";
import { processNextEngagementReport } from "../../src/lib/engagement/review-export-worker";
/** Run with npm run worker:document-exports. Jobs and completed files remain in Documents. */
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { createServiceRoleClient } from "../../src/lib/supabase/server";
import { loadWorkProgramExportIdentity, renderWorkProgramExport } from "../../src/lib/programs/work-program/export-job";
import { storeWorkProgramExport, workProgramExportFailureDetail } from "../../src/lib/programs/work-program/export-storage";

async function main(noticeStopping: () => void) {
const service = createServiceRoleClient();
const root = process.env.OPENPLAN_DOCUMENT_EXPORT_WORK_DIR || join(homedir(), ".local/state/openplan/document-exports");
await mkdir(root, { recursive: true, mode: 0o700 });
let stopping = false;
process.on("SIGTERM", () => { stopping = true; noticeStopping(); });
process.on("SIGINT", () => { stopping = true; noticeStopping(); });
while (!stopping) {
  const token = randomUUID();
  const claimed = await service.rpc("claim_work_program_export", { p_token: token });
  if (claimed.error) { console.error("Document export queue unavailable; retrying."); await delay(5000); continue; }
  const job = claimed.data as { id: string; document_id: string } | null;
  if (!job?.id) {
    try { if (await processNextEngagementReport(root)) continue; } catch { console.error("Campaign report queue unavailable; retrying."); }
    await delay(2000); continue;
  }
  const heartbeat = setInterval(() => { void service.from("kb_ocr_jobs").update({ lease_until: new Date(Date.now()+600_000).toISOString() }).eq("id", job.id).eq("lease_token", token).eq("status", "running").then(({error})=>{if(error) console.error("Export lease renewal unavailable.");}); }, 30_000);
  try {
    const identity = await loadWorkProgramExportIdentity(job.document_id);
    const folder = join(root, job.id);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    let artifact: Awaited<ReturnType<typeof renderWorkProgramExport>> | null = null;
    try {
      const metadata = JSON.parse(await readFile(join(folder, "artifact.json"), "utf8"));
      const bytes = await readFile(join(folder, "artifact.bin"));
      if (Object.entries(identity).every(([key, value]) => metadata[key] === value) && typeof metadata.engine === "string" && typeof metadata.checksum === "string" && createHash("sha256").update(bytes).digest("hex") === metadata.checksum) artifact = { ...metadata, bytes };
    } catch { /* Interrupted rendering or a corrupt cache is recoverable from the immutable revision. */ }
    if (!artifact) {
      artifact = await renderWorkProgramExport(job.document_id);
      const {bytes, ...metadata} = artifact;
      await writeFile(join(folder,"artifact.bin.partial"),bytes,{mode:0o600});
      await rename(join(folder,"artifact.bin.partial"),join(folder,"artifact.bin"));
      await writeFile(join(folder,"artifact.json.partial"),JSON.stringify({...metadata,documentId:job.document_id}),{mode:0o600});
      await rename(join(folder,"artifact.json.partial"),join(folder,"artifact.json"));
    }
    const objectPath = `${identity.workspaceId}/${identity.documentId}/${artifact.checksum}.${identity.format}`;
    // Checks the workspace storage limit, then stores or proves the retained bytes.
    await storeWorkProgramExport(service, { workspaceId: identity.workspaceId, objectPath, bytes: artifact.bytes, checksum: artifact.checksum, contentType: identity.contentType });
    const finished = await service.rpc("finish_work_program_export", {p_job:job.id,p_token:token,p_checksum:artifact.checksum,p_bytes:artifact.bytes.length,p_storage_ref:`storage://kb-documents/${objectPath}`,p_engine:artifact.engine});
    if(finished.error) throw new Error("Export custody could not be committed");
    console.log(`Retained document export ${job.id}`);
  } catch (error) {
    await service.from("kb_ocr_jobs").update({status:"failed",failure_detail:workProgramExportFailureDetail(error)}).eq("id",job.id).eq("lease_token",token).eq("status","running");
    console.error(`Document export ${job.id} needs retry.`);
  } finally { clearInterval(heartbeat); }
}

}
void observeNodeQueue("document-exports", main).catch(()=>{console.error("Document export worker could not start.");process.exitCode=1;});
