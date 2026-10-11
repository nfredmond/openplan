// @vitest-environment node
import { mkdtemp, readFile, writeFile, rm, chmod, stat, symlink, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ before: vi.fn(), after: vi.fn(), synced: vi.fn() }));
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
    const file = await actual.open(...args), sync = file.sync.bind(file);
    file.sync = async () => { await sync(); io.synced(String(args[0])); };
    return file;
  } };
});
vi.mock("../../../workers/planner_agent_connector/connector-worker.mjs", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../workers/planner_agent_connector/connector-worker.mjs")>();
  return { ...actual, writeConnectorJournal: async (directory: string, value: unknown) => {
    await io.before(directory, value); await actual.writeConnectorJournal(directory, value); await io.after(directory, value);
  } };
});
import { acquireConnectorLock } from "../../../workers/planner_agent_connector/connector-worker.mjs";
import { withGtfsAttemptJournal, type GtfsAttemptJournal, type GtfsJournalPayload } from "@/lib/gtfs/managed-worker-journal";
const id = (n: number) => `d8000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const dirs: string[] = [];
afterEach(async () => { io.before.mockReset(); io.after.mockReset(); io.synced.mockReset(); for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "openplan-gtfs-journal-")); dirs.push(directory);
  const controller = new AbortController();
  const options = { directory, target: "http://localhost:29821/", installationId: id(1), versionId: id(2), maxCommandBytes: 65536, signal: controller.signal };
  const payload: GtfsJournalPayload = { operation: "batch", arguments: { kind: "route", ordinal: 0, rows: [{ route_id: "R1" }] } };
  const path = join(directory,"command-route-0","pending.json");
  const saved = async () => JSON.parse(await readFile(path,"utf8"));
  const identity = async () => JSON.parse(await readFile(join(directory,"pending.json"),"utf8"));
  const send = vi.fn(async (commandId: string) => ({ commandId, rows: 1 }));
  const verify = vi.fn((raw: unknown, commandId: string) => {
    expect(raw).toEqual({ commandId, rows: 1 }); return raw;
  });
  const run = () => withGtfsAttemptJournal(options, j => j.deliver("route-0",payload,{ send, verify }));
  return { directory, controller, options, payload, path, saved, identity, send, verify, run };
}

describe("managed GTFS private command journal", () => {
  it("syncs attempt and exact command before dispatch, then revalidates a retained receipt without sending", async () => {
    const f=await fixture(); f.send.mockImplementation(async commandId => {
      expect(await f.identity()).toMatchObject({versionId:id(2),installationId:id(1),target:"http://localhost:29821"});
      expect(await f.saved()).toMatchObject({commandId,payload:f.payload,resolved:false,receipt:null});
      expect(io.synced.mock.calls.filter(([path])=>path===f.directory)).toHaveLength(2);
      return {commandId,rows:1};
    });
    const first=await f.run(); expect(first.retained).toBe(false);
    expect(await f.run()).toEqual({...first,retained:true}); expect(f.send).toHaveBeenCalledTimes(1); expect(f.verify).toHaveBeenCalledTimes(2);
    expect((await stat(f.directory)).mode & 0o777).toBe(0o700);
    expect((await stat(f.path)).mode & 0o777).toBe(0o600);
  });
  it("reuses command and attempt identities after an unknown response", async () => {
    const f=await fixture(); f.send.mockRejectedValueOnce(new Error("unknown response"));
    await expect(f.run()).rejects.toThrow("unknown response"); const attempt=await f.identity(), command=await f.saved();
    expect(command.resolved).toBe(false); await f.run();
    expect(await f.identity()).toEqual(attempt); expect(f.send.mock.calls[0][0]).toBe(f.send.mock.calls[1][0]);
  });
  it.each(["target","installationId","versionId"] as const)("refuses changed %s before dispatch", async field => {
    const f=await fixture(); await f.run(); f.send.mockClear();
    f.options[field]=field==="target"?"http://localhost:29822":id(3);
    await expect(f.run()).rejects.toThrow("attempt scope differs"); expect(f.send).not.toHaveBeenCalled();
  });
  it.each(["target","installationId","versionId","token"])("refuses changed command identity %s", async field => {
    const f=await fixture(); await f.run(); const saved=await f.saved(); saved.identity[field]=field==="target"?"https://example.invalid":id(9);
    await writeFile(f.path,JSON.stringify(saved)); await expect(f.run()).rejects.toThrow("command scope differs"); expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("refuses a relocated command and changed payload before sending", async () => {
    const f=await fixture(); await f.run(); const saved=await f.saved(); saved.slot="stop-0"; await writeFile(f.path,JSON.stringify(saved));
    await expect(f.run()).rejects.toThrow("command scope differs"); saved.slot="route-0"; await writeFile(f.path,JSON.stringify(saved));
    f.payload.arguments.ordinal=1; await expect(f.run()).rejects.toThrow("payload changed"); expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("accepts harmless property ordering without changing the immutable command", async () => {
    const f=await fixture(); await f.run(); f.payload.arguments={rows:[{route_id:"R1"}],ordinal:0,kind:"route"};
    expect((await f.run()).retained).toBe(true); expect(f.send).toHaveBeenCalledTimes(1);
  });
  it.each(["../escape","x/y","","../pending.json"])("rejects unsafe slot %s", async slot => {
    const f=await fixture(); await expect(withGtfsAttemptJournal(f.options, j=>j.deliver(slot,f.payload,{send:f.send,verify:f.verify}))).rejects.toThrow(); expect(f.send).not.toHaveBeenCalled();
  });
  it.each(["https://user:pass@example.invalid","https://example.invalid?token=x","file:///tmp/x","https://example.invalid/#x"])("rejects credential or invalid target %s", async target=>{
    const f=await fixture(); f.options.target=target; await expect(f.run()).rejects.toThrow("target is invalid"); expect(f.send).not.toHaveBeenCalled();
  });
  it.each(["attempt","prepared","resolved"])("refuses dispatch or acknowledgement after %s disk failure", async phase => {
    const f=await fixture(); io.before.mockImplementation((_dir,value)=>{
      if (phase==="attempt" && "token" in value || phase==="prepared" && value.resolved===false || phase==="resolved" && value.resolved===true) throw new Error("disk full");
    });
    await expect(f.run()).rejects.toThrow("disk full"); expect(f.send).toHaveBeenCalledTimes(phase==="resolved"?1:0);
    if(phase==="resolved") expect((await f.saved()).resolved).toBe(false);
    io.before.mockReset(); await f.run();
  });
  it("retains synced acknowledgement after post-write error", async () => {
    const f=await fixture(); io.after.mockImplementation((_dir,value)=>{if(value.resolved===true)throw new Error("sync acknowledgement lost");});
    await expect(f.run()).rejects.toThrow("sync acknowledgement lost"); io.after.mockReset();
    expect((await f.run()).retained).toBe(true); expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("never resolves an invalid receipt and revalidates cached evidence", async () => {
    const f=await fixture(); f.verify.mockImplementationOnce(()=>{throw new Error("wrong receipt");});
    await expect(f.run()).rejects.toThrow("wrong receipt"); expect((await f.saved()).resolved).toBe(false);
    await f.run(); f.verify.mockImplementationOnce(()=>{throw new Error("damaged receipt");});
    await expect(f.run()).rejects.toThrow("damaged receipt"); expect(f.send).toHaveBeenCalledTimes(2);
  });
  it("does not let the verifier or caller mutate the saved request or receipt", async () => {
    const f=await fixture(); const original=structuredClone(f.payload);
    await withGtfsAttemptJournal(f.options, async j=>{
      const work=j.deliver("route-0",f.payload,{send:async(commandId,payload)=>{
        expect(payload).toEqual(original); payload.arguments.kind="stop"; return {commandId,rows:1};
      },verify:(value)=>{(value as {rows:number}).rows=99; return value;}});
      f.payload.arguments.kind="changed"; await work;
    });
    expect((await f.saved()).payload).toEqual(original); expect((await f.saved()).receipt.rows).toBe(1);
  });
  it("refuses a second process lock and releases the first after failure", async () => {
    const f=await fixture(); const lock=await acquireConnectorLock(f.directory);
    try {await expect(f.run()).rejects.toThrow("already_running"); expect(f.send).not.toHaveBeenCalled();} finally {await lock.release();}
    await f.run();
  });
  it("refuses parallel reuse of one command slot", async () => {
    const f=await fixture(); await withGtfsAttemptJournal(f.options,async j=>{
      const first=j.deliver("route-0",f.payload,{send:f.send,verify:f.verify});
      expect(()=>j.deliver("route-0",f.payload,{send:f.send,verify:f.verify})).toThrow("already running"); await first;
    }); expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("rejects delivery after session release", async () => {
    const f=await fixture(); let retained: GtfsAttemptJournal | undefined;
    await withGtfsAttemptJournal(f.options,async j=>{retained=j;});
    expect(()=>retained!.deliver("route-0",f.payload,{send:f.send,verify:f.verify})).toThrow("session is closed"); expect(f.send).not.toHaveBeenCalled();
  });
  it("rejects an unawaited delivery and drains it before releasing ownership", async () => {
    const f=await fixture(); await expect(withGtfsAttemptJournal(f.options,async j=>{void j.deliver("route-0",f.payload,{send:f.send,verify:f.verify});})).rejects.toThrow("must await deliveries");
    expect(f.send).not.toHaveBeenCalled(); await f.run();
  });
  it("retains an unresolved command when cancelled during delivery", async () => {
    const f=await fixture(); f.send.mockImplementationOnce(async commandId=>{f.controller.abort();return {commandId,rows:1};});
    await expect(f.run()).rejects.toThrow(); expect((await f.saved()).resolved).toBe(false);
  });
  it("refuses pre-cancellation before creating attempt identity", async () => {
    const f=await fixture(); f.controller.abort(); await expect(f.run()).rejects.toThrow(); await expect(f.identity()).rejects.toMatchObject({code:"ENOENT"});
    await expect(stat(join(f.directory,"run.lock"))).rejects.toMatchObject({code:"ENOENT"});
  });
  it("captures directory and signal before the caller can change options", async () => {
    const f=await fixture(); const original=f.directory;
    const work=f.run(); f.options.directory=join(original,"changed"); f.options.signal=AbortSignal.abort();
    await work; expect((await f.saved()).resolved).toBe(true);
    await expect(stat(join(original,"changed"))).rejects.toMatchObject({code:"ENOENT"});
  });
  it("refuses claim caching because claim ownership must be read live", async () => {
    const f=await fixture(); f.payload.operation="claim" as GtfsJournalPayload["operation"];
    await expect(f.run()).rejects.toThrow(); expect(f.send).not.toHaveBeenCalled();
  });
  it("refuses unresolved receipt corruption", async () => {
    const f=await fixture(); f.send.mockRejectedValueOnce(new Error("lost")); await expect(f.run()).rejects.toThrow("lost");
    const saved=await f.saved(); saved.receipt={commandId:saved.commandId,rows:1}; await writeFile(f.path,JSON.stringify(saved));
    await expect(f.run()).rejects.toThrow("unresolved receipt is invalid"); expect(f.send).toHaveBeenCalledTimes(1);
  });
  it.each(["attempt","command"])("refuses unexpected %s fields", async kind => {
    const f=await fixture(); await f.run(); const path=kind==="attempt"?join(f.directory,"pending.json"):f.path;
    const saved=JSON.parse(await readFile(path,"utf8")); saved.unexpected=true; await writeFile(path,JSON.stringify(saved));
    await expect(f.run()).rejects.toThrow(); expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("refuses records beyond the configured bound before sending", async () => {
    const f=await fixture(); f.options.maxCommandBytes=1024; f.payload.arguments.large="a".repeat(2048);
    await expect(f.run()).rejects.toThrow("record exceeds configured bound"); expect(f.send).not.toHaveBeenCalled();
  });
  it.each(["public","symlink","malformed"])("refuses %s retained files", async kind=>{
    const f=await fixture(); await f.run();
    if(kind==="public")await chmod(f.path,0o644);
    if(kind==="symlink"){await rm(f.path);await symlink(join(f.directory,"pending.json"),f.path);}
    if(kind==="malformed")await writeFile(f.path,"not JSON");
    await expect(f.run()).rejects.toThrow(); expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("inspects a missing command without creating its directory", async () => {
    const f=await fixture(); await withGtfsAttemptJournal(f.options, async j=>{
      expect(await j.inspect("missing")).toBeNull();
      await expect(stat(join(f.directory,"command-missing"))).rejects.toMatchObject({code:"ENOENT"});
    }); expect(f.send).not.toHaveBeenCalled();
  });
  it("inspects exact unresolved inputs without exposing or changing a receipt", async () => {
    const f=await fixture(); f.send.mockRejectedValueOnce(new Error("unknown")); await expect(f.run()).rejects.toThrow("unknown");
    const before=await readFile(f.path,"utf8"), saved=await f.saved();
    await withGtfsAttemptJournal(f.options, async j=>{
      const found=await j.inspect("route-0"); expect(found).toEqual({commandId:saved.commandId,payload:f.payload,resolved:false});
      found!.payload.arguments.kind="changed"; expect((await j.inspect("route-0"))!.payload).toEqual(f.payload);
    }); expect(await readFile(f.path,"utf8")).toBe(before); expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("inspects resolved metadata without treating its receipt as current ownership", async () => {
    const f=await fixture(); await f.run(); await withGtfsAttemptJournal(f.options, async j=>{
      expect(await j.inspect("route-0")).toEqual({commandId:(await f.saved()).commandId,payload:f.payload,resolved:true});
    }); expect(f.send).toHaveBeenCalledTimes(1);
  });
  it.each(["token","slot"])("refuses inspection of changed %s", async kind=>{
    const f=await fixture(); await f.run(); const saved=await f.saved();
    if(kind==="token")saved.identity.token=id(99);else saved.slot="other";
    await writeFile(f.path,JSON.stringify(saved));
    await expect(withGtfsAttemptJournal(f.options,j=>j.inspect("route-0"))).rejects.toThrow("command scope differs");
  });
  it("refuses inspection while its command is running", async () => {
    const f=await fixture(); await withGtfsAttemptJournal(f.options, async j=>{
      const running=j.deliver("route-0",f.payload,{send:f.send,verify:f.verify});
      expect(()=>j.inspect("route-0")).toThrow("inspection is busy"); await running;
    });
  });
  it.each(["public","symlink"])("refuses a %s command directory during inspection", async kind=>{
    const f=await fixture(); await f.run(); const directory=join(f.directory,"command-route-0");
    if(kind==="public")await chmod(directory,0o755);
    else {await rename(directory,join(f.directory,"original"));await symlink(join(f.directory,"original"),directory);}
    await expect(withGtfsAttemptJournal(f.options,j=>j.inspect("route-0"))).rejects.toThrow("inspection directory is not private");
  });
  it("refuses unsafe inspection paths and inspection after release", async () => {
    const f=await fixture(); let saved: GtfsAttemptJournal|undefined;
    await withGtfsAttemptJournal(f.options,async j=>{saved=j;expect(()=>j.inspect("../escape")).toThrow();});
    expect(()=>saved!.inspect("route-0")).toThrow("session is closed");
  });

});
