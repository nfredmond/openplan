// @vitest-environment node
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("node:timers/promises",()=>({setTimeout:vi.fn()}));
vi.mock("@/lib/engagement/synthesis-execution-queue-coordinator",()=>({runSynthesisExecutionQueuePass:vi.fn()}));
import {runSynthesisExecutionQueuePass} from "@/lib/engagement/synthesis-execution-queue-coordinator";
import {runSynthesisExecutionService,synthesisExecutionOptions} from "@/lib/engagement/synthesis-execution-service";
const pass=vi.mocked(runSynthesisExecutionQueuePass),wait=vi.mocked(delay),target="http://localhost:29821";
const empty={outcomes:[],queueWrapped:true};
beforeEach(()=>{vi.resetAllMocks();pass.mockResolvedValue(empty);wait.mockResolvedValue(undefined);});
function fixture(once=true){const controller=new AbortController();const args={service:{} as Pick<SupabaseClient,"rpc"|"from">,target,root:"/tmp/synthetic-root",directory:"/tmp/synthetic-execution-service",signal:controller.signal,once,report:vi.fn(),reportError:vi.fn()};return{args,controller,run:()=>runSynthesisExecutionService(args)};}
describe("execution command options",()=>{
 it.each([[],["--once"]].map(argv=>({argv})))("partitions durable state by canonical database target for $argv",({argv})=>{
  const result=synthesisExecutionOptions(argv,{NEXT_PUBLIC_SUPABASE_URL:target+"/",OPENPLAN_SYNTHESIS_GENERATION_WORK_DIR:"/tmp/synthetic-root"});
  expect(result).toEqual({help:false,once:argv.length>0,target,root:"/tmp/synthetic-root",directory:join("/tmp/synthetic-root",createHash("sha256").update(target).digest("hex"),"queue-coordinator")});
  expect(synthesisExecutionOptions(argv,{NEXT_PUBLIC_SUPABASE_URL:"http://localhost:29831",OPENPLAN_SYNTHESIS_GENERATION_WORK_DIR:"/tmp/synthetic-root"})).not.toEqual(result);
 });
 it("uses a private default root and supports help without credentials",()=>{
  expect(synthesisExecutionOptions(["--help"],{})).toEqual({help:true});
  expect(synthesisExecutionOptions([],{NEXT_PUBLIC_SUPABASE_URL:target})).toMatchObject({directory:join(homedir(),".local/state/openplan/synthesis-generation-worker",createHash("sha256").update(target).digest("hex"),"queue-coordinator")});
 });
 it.each([["--unknown"],["--once","--once"],["--help","--once"],["--once","extra"]].map(argv=>({argv})))("refuses invalid options $argv",({argv})=>{expect(()=>synthesisExecutionOptions(argv,{NEXT_PUBLIC_SUPABASE_URL:target})).toThrow("options_invalid");});
 it.each(["","file:///tmp/db","http://user:private@localhost:29821","http://localhost:29821?key=private","http://localhost:29821#fragment"])("refuses unsafe target %s",url=>{expect(()=>synthesisExecutionOptions([],{NEXT_PUBLIC_SUPABASE_URL:url})).toThrow();});
 it("refuses relative journal roots",()=>{expect(()=>synthesisExecutionOptions([],{NEXT_PUBLIC_SUPABASE_URL:target,OPENPLAN_SYNTHESIS_GENERATION_WORK_DIR:"relative"})).toThrow("must_be_absolute");});
});
describe("execution service lifecycle",()=>{
 it("runs one bounded pass and reports its actual result without waiting",async()=>{
  const f=fixture();expect(await f.run()).toBe("pass_complete");expect(pass).toHaveBeenCalledExactlyOnceWith(f.args);expect(f.args.report).toHaveBeenCalledExactlyOnceWith(empty);expect(wait).not.toHaveBeenCalled();
 });
 it("reports pending custody separately from a completed pass",async()=>{
  const f=fixture();pass.mockResolvedValue({...empty,outcomes:[{queueId:"synthetic",state:"unconfirmed"}]});expect(await f.run()).toBe("unconfirmed");expect(wait).not.toHaveBeenCalled();
 });
 it("reports one-pass errors without exposing the underlying message",async()=>{
  const f=fixture();pass.mockRejectedValue(new Error("PRIVATE"));expect(await f.run()).toBe("error");expect(f.args.reportError).toHaveBeenCalledExactlyOnceWith();expect(f.args.report).not.toHaveBeenCalled();expect(wait).not.toHaveBeenCalled();
 });
 it.each([0,2])("polls continuously with %i pending records using an interruptible delay",async pendingCount=>{
  const f=fixture(false);pass.mockResolvedValue({...empty,outcomes:pendingCount?[{queueId:"synthetic",state:"unconfirmed"}]:[]});wait.mockImplementationOnce(async()=>undefined).mockImplementationOnce(async()=>{f.controller.abort();});
  expect(await f.run()).toBe("stopped");expect(pass).toHaveBeenCalledTimes(2);expect(wait.mock.calls).toEqual(Array(2).fill([pendingCount?5000:2000,undefined,{signal:f.args.signal}]));
 });
 it("backs off after a failed pass and then continues with the same target and directory",async()=>{
  const f=fixture(false);pass.mockRejectedValueOnce(new Error("unavailable"));wait.mockImplementationOnce(async()=>undefined).mockImplementationOnce(async()=>{f.controller.abort();});
  expect(await f.run()).toBe("stopped");expect(pass.mock.calls).toEqual([[f.args],[f.args]]);expect(wait.mock.calls.map(c=>c[0])).toEqual([5000,2000]);expect(f.args.reportError).toHaveBeenCalledOnce();expect(f.args.report).toHaveBeenCalledOnce();
 });
 it.each(["before","during-success","during-error","waiting"])("stops during %s without claiming completion",async when=>{
  const f=fixture(false);
  if(when==="before")f.controller.abort();
  if(when==="during-success")pass.mockImplementationOnce(async()=>{f.controller.abort();return empty;});
  if(when==="during-error")pass.mockImplementationOnce(async()=>{f.controller.abort();throw new Error("aborted");});
  if(when==="waiting")wait.mockImplementationOnce(async()=>{f.controller.abort();throw new Error("aborted");});
  expect(await f.run()).toBe("stopped");expect(pass).toHaveBeenCalledTimes(when==="before"?0:1);expect(f.args.report).toHaveBeenCalledTimes(when==="waiting"?1:0);expect(f.args.reportError).not.toHaveBeenCalled();
 });
 it("does not hide a failed timer when no stop was requested",async()=>{const f=fixture(false);wait.mockRejectedValue(new Error("timer fault"));await expect(f.run()).rejects.toThrow("wait_failed");});
});
