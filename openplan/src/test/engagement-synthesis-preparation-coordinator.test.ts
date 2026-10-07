// @vitest-environment node
import { mkdtemp, readFile, writeFile, rm, chmod, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("@/lib/engagement/synthesis-preparation-candidates", () => ({ listSynthesisPreparationCandidates: vi.fn() }));
vi.mock("@/lib/engagement/synthesis-preparation-journal", () => ({ runSynthesisPreparationJournal: vi.fn() }));
vi.mock("@/lib/engagement/synthesis-preparation-driver", () => ({ prepareSynthesisStage: vi.fn() }));
const io = vi.hoisted(() => ({ before: vi.fn(), after: vi.fn() }));
vi.mock("../../../workers/planner_agent_connector/connector-worker.mjs", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../workers/planner_agent_connector/connector-worker.mjs")>();
  return { ...actual, writeConnectorJournal: async (directory: string, value: unknown) => {
    await io.before(directory, value); await actual.writeConnectorJournal(directory, value); await io.after(directory, value);
  } };
});
import { acquireConnectorLock } from "../../../workers/planner_agent_connector/connector-worker.mjs";
import { listSynthesisPreparationCandidates } from "@/lib/engagement/synthesis-preparation-candidates";
import { runSynthesisPreparationJournal } from "@/lib/engagement/synthesis-preparation-journal";
import { prepareSynthesisStage } from "@/lib/engagement/synthesis-preparation-driver";
import { runSynthesisPreparationQueuePass } from "@/lib/engagement/synthesis-preparation-coordinator";
import type { SynthesisPreparationLease } from "@/lib/engagement/synthesis-preparation-worker";
const list = vi.mocked(listSynthesisPreparationCandidates), attempt = vi.mocked(runSynthesisPreparationJournal), prepare = vi.mocked(prepareSynthesisStage);
const id = (n: number) => `e3000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const target = "http://localhost:29821", directories: string[] = [];
const receipt = (requestId: string) => ({ state: "acknowledged" as const, requestId, token: id(900), outcome: { sealSha256: "a".repeat(64) } });
beforeEach(() => { vi.resetAllMocks(); list.mockResolvedValue({ requestIds: [], nextAfter: null }); attempt.mockImplementation(async args => receipt(args.requestId)); });
afterEach(async () => { for (const p of directories.splice(0)) await rm(p, { recursive: true, force: true }); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "preparation-coordinator-")); directories.push(directory);
  const controller = new AbortController(), service = {} as Pick<SupabaseClient, "rpc" | "from">;
  const args = { directory, target: target + "/", signal: controller.signal, service };
  const journal = async () => JSON.parse(await readFile(join(directory, "pending.json"), "utf8"));
  const state = { version: 1, target, after: null as string | null, retryAfter: null as string | null, pending: [] as Array<{ requestId: string; directoryId: string }> };
  const save = (value: unknown) => writeFile(join(directory, "pending.json"), JSON.stringify(value), { mode: 0o600 });
  return { args, directory, controller, journal, state, save, run: () => runSynthesisPreparationQueuePass(args) };
}
describe("durable preparation queue coordination", () => {
  it("persists target before discovery and every directory identity before an attempt", async () => {
    const f = await fixture();
    list.mockImplementationOnce(async args => { expect(await f.journal()).toEqual(f.state); expect(args).toMatchObject({ service: f.args.service, after: null }); return { requestIds: [id(1), id(2)], nextAfter: id(2) }; });
    attempt.mockImplementation(async args => {
      const state = await f.journal(); expect(state.after).toBe(id(2));
      expect(state.pending).toContainEqual({ requestId: args.requestId, directoryId: args.directory.split("/").at(-1) });
      expect(args.target).toBe(target); expect(args.service).toBe(f.args.service); expect(args.signal.aborted).toBe(false); return receipt(args.requestId);
    });
    const running = f.run(); await expect(running).resolves.toMatchObject({pendingCount:0}); const result = await running; expect(result.outcomes.map(r => r.state)).toEqual(["acknowledged", "acknowledged"]); expect(result.pendingCount).toBe(0); expect(result.queueWrapped).toBe(false); expect((await f.journal()).pending).toEqual([]);
  });
  it("resumes unknown work in its original directory before discovery while unrelated work continues", async () => {
    const f = await fixture(); list.mockResolvedValueOnce({ requestIds: [id(1), id(2)], nextAfter: id(2) }); attempt.mockRejectedValueOnce(new Error("PRIVATE unknown"));
    const first = f.run(); await expect(first).resolves.toMatchObject({pendingCount:1}); expect((await first).outcomes.map(r => r.state)).toEqual(["unconfirmed", "acknowledged"]); const old = attempt.mock.calls[0][0].directory;
    list.mockImplementationOnce(async () => { expect(attempt).toHaveBeenCalledTimes(3); return { requestIds: [id(3)], nextAfter: id(3) }; });
    const result = await f.run(); expect(attempt.mock.calls[2][0].directory).toBe(old); expect(result.outcomes.map(r => r.requestId)).toEqual([id(1), id(3)]); expect(result.pendingCount).toBe(0);
  });
  it("does not duplicate an unresolved request discovered again", async () => {
    const f = await fixture(); f.state.pending = [{ requestId: id(1), directoryId: id(11) }]; await f.save(f.state);
    attempt.mockRejectedValue(new Error("unknown")); list.mockResolvedValue({ requestIds: [id(1), id(2)], nextAfter: id(2) });
    await expect(f.run()).resolves.toMatchObject({pendingCount:2}); expect(attempt.mock.calls.map(c => c[0].requestId)).toEqual([id(1), id(2)]);
    expect((await f.journal()).pending.find((e: {requestId:string}) => e.requestId === id(1)).directoryId).toBe(id(11));
  });
  it("rotates retries beyond64 unresolved requests and wraps without dropping custody", async () => {
    const f = await fixture(); f.state.pending = Array.from({ length: 130 }, (_, i) => ({ requestId: id(i + 1), directoryId: id(i + 1001) })); await f.save(f.state); attempt.mockRejectedValue(new Error("unknown"));
    await f.run(); expect(attempt.mock.calls.map(c => c[0].requestId)).toEqual(Array.from({length:64},(_,i)=>id(i+1)));
    await f.run(); expect(attempt.mock.calls.slice(64).map(c => c[0].requestId)).toEqual(Array.from({length:64},(_,i)=>id(i+65)));
    await f.run(); expect(attempt.mock.calls.slice(128).map(c => c[0].requestId)).toEqual([id(129),id(130)]);
    await f.run(); expect(attempt.mock.calls.slice(130).map(c => c[0].requestId)).toEqual(Array.from({length:64},(_,i)=>id(i+1))); expect((await f.journal()).pending).toHaveLength(130);
  });
  it("continues short discovery pages until an empty page wraps", async () => {
    const f = await fixture(); list.mockResolvedValueOnce({ requestIds:[id(1)],nextAfter:id(1) }).mockResolvedValueOnce({ requestIds:[id(2)],nextAfter:id(2) });
    await f.run(); await f.run(); expect((await f.run()).queueWrapped).toBe(true); await f.run(); expect(list.mock.calls.map(c=>c[0].after)).toEqual([null,id(1),id(2),null]);
  });
  it("retains terminal child files while removing active entries", async () => {
    const f=await fixture(); list.mockResolvedValueOnce({requestIds:[id(1)],nextAfter:id(1)});
    attempt.mockImplementationOnce(async args => { await mkdir(args.directory,{mode:0o700}); await writeFile(join(args.directory,"pending.json"),"terminal"); return { state:"not_active",requestId:args.requestId,token:id(99) }; });
    const result=await f.run(); expect(result.pendingCount).toBe(0); expect(result.outcomes[0].state).toBe("not_active"); await expect(readFile(join(attempt.mock.calls[0][0].directory,"pending.json"),"utf8")).resolves.toBe("terminal");
  });
  it("forwards the original stage driver lease and signal", async () => {
    const f=await fixture(); list.mockResolvedValueOnce({requestIds:[id(1)],nextAfter:id(1)}); const lease={requestId:id(1)} as SynthesisPreparationLease, s=new AbortController().signal;
    prepare.mockResolvedValue({sealSha256:"a".repeat(64)}); attempt.mockImplementationOnce(async args=>{expect(await args.prepare(lease,s)).toEqual({sealSha256:"a".repeat(64)});return receipt(args.requestId);});
    await f.run(); expect(prepare).toHaveBeenCalledExactlyOnceWith(f.args.service,lease,s);
  });
  it.each(["request","outcome","state"])("keeps differing %s results unconfirmed",async kind=>{
    const f=await fixture();list.mockResolvedValueOnce({requestIds:[id(1)],nextAfter:id(1)});const result:unknown=kind==="request"?receipt(id(2)):kind==="outcome"?{...receipt(id(1)),outcome:{sealSha256:"bad"}}:{...receipt(id(1)),state:"finished"};attempt.mockResolvedValueOnce(result as Awaited<ReturnType<typeof runSynthesisPreparationJournal>>);
    expect((await f.run()).outcomes[0].state).toBe("unconfirmed");expect((await f.journal()).pending).toHaveLength(1);
  });
  it.each(["before","after"])("recovers %s fresh-index persistence failure",async when=>{
    const f=await fixture();list.mockResolvedValue({requestIds:[id(1)],nextAfter:id(1)});const hook=when==="before"?io.before:io.after;hook.mockImplementation(async(_dir,value)=>{if(value.pending.length)throw new Error("disk unknown");});
    await expect(f.run()).rejects.toThrow("disk unknown");expect(attempt).not.toHaveBeenCalled();const pending=(await f.journal()).pending;hook.mockReset();list.mockResolvedValue({requestIds:when==="before"?[id(1)]:[],nextAfter:null});await f.run();expect(attempt).toHaveBeenCalledTimes(1);if(when==="after")expect(attempt.mock.calls[0][0].directory).toBe(join(f.directory,pending[0].directoryId));
  });
  it("replays the same terminal child when index removal fails",async()=>{
    const f=await fixture();list.mockResolvedValueOnce({requestIds:[id(1)],nextAfter:id(1)});io.before.mockImplementation(async(_dir,value)=>{if(attempt.mock.calls.length&&value.pending.length===0)throw new Error("disk unavailable");});
    await expect(f.run()).rejects.toThrow("disk unavailable");const directory=attempt.mock.calls[0][0].directory;expect((await f.journal()).pending).toHaveLength(1);io.before.mockReset();await f.run();expect(attempt.mock.calls[1][0].directory).toBe(directory);
  });
  it("retains the queue cursor on a failed discovery read",async()=>{
    const f=await fixture();f.state.after=id(7);await f.save(f.state);list.mockRejectedValueOnce(new Error("unavailable"));await expect(f.run()).rejects.toThrow("unavailable");expect((await f.journal()).after).toBe(id(7));expect(attempt).not.toHaveBeenCalled();
  });
  it.each(["before","during"])("honors interruption %s work",async when=>{
    const f=await fixture();list.mockResolvedValueOnce({requestIds:[id(1),id(2)],nextAfter:id(2)});if(when==="before")f.controller.abort();else attempt.mockImplementationOnce(async args=>{f.controller.abort();return receipt(args.requestId);});
    await expect(f.run()).rejects.toThrow();expect(attempt).toHaveBeenCalledTimes(when==="before"?0:1);if(when==="during")expect((await f.journal()).pending).toHaveLength(2);
  });
  it.each(["target","version","unknown","duplicate-request","duplicate-directory","order","path"])("refuses invalid saved %s before network",async kind=>{
    const f=await fixture();f.state.pending=[{requestId:id(1),directoryId:id(11)},{requestId:id(2),directoryId:id(12)}];if(kind==="target")f.state.target="http://localhost:9999";if(kind==="version")f.state.version=2;if(kind==="unknown")Object.assign(f.state,{extra:true});if(kind==="duplicate-request")f.state.pending[1].requestId=id(1);if(kind==="duplicate-directory")f.state.pending[1].directoryId=id(11);if(kind==="order")f.state.pending.reverse();if(kind==="path")f.state.pending[0].directoryId="../other";
    await f.save(f.state);await expect(f.run()).rejects.toThrow();expect(list).not.toHaveBeenCalled();expect(attempt).not.toHaveBeenCalled();expect(await f.journal()).toEqual(f.state);
  });
  it.each(["malformed","public","symlink","oversized"])("refuses %s state",async kind=>{
    const f=await fixture(),path=join(f.directory,"pending.json");await f.save(f.state);if(kind==="oversized")await writeFile(path,JSON.stringify(f.state).padEnd(16*1024*1024+1," "));if(kind==="malformed")await writeFile(path,"{");if(kind==="public")await chmod(path,0o644);if(kind==="symlink"){await rm(path);await writeFile(join(f.directory,"other.json"),JSON.stringify(f.state),{mode:0o600});await symlink(join(f.directory,"other.json"),path);}await expect(f.run()).rejects.toThrow();expect(list).not.toHaveBeenCalled();expect(attempt).not.toHaveBeenCalled();
  });
  it("requires an exclusive private directory",async()=>{
    const f=await fixture(),lock=await acquireConnectorLock(f.directory);try{await expect(f.run()).rejects.toThrow();expect(list).not.toHaveBeenCalled();}finally{await lock.release();}await chmod(f.directory,0o755);await expect(f.run()).rejects.toThrow();expect(list).not.toHaveBeenCalled();
  });
  it("refuses an oversized serialization before replacing its journal",async()=>{
    const f=await fixture();await f.save(f.state);const bytes=vi.spyOn(Buffer,"byteLength").mockReturnValueOnce(16*1024*1024+1);
    try{await expect(f.run()).rejects.toThrow("exceeds its byte bound");expect(io.before).not.toHaveBeenCalled();expect(list).not.toHaveBeenCalled();}finally{bytes.mockRestore();}
    expect(await f.journal()).toEqual(f.state);
  });
  it("rejects credentials in the target before writing",async()=>{
    const f=await fixture();f.args.target="http://user:private@localhost:29821";await expect(f.run()).rejects.toThrow();expect(io.before).not.toHaveBeenCalled();expect(list).not.toHaveBeenCalled();
  });
});
