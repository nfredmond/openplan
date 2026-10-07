// @vitest-environment node
import {spawn} from "node:child_process";
import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {afterEach,describe,expect,it} from "vitest";
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
const requestId="a4000000-0000-4000-8000-000000000001";
// Actual CLI and HTTP client; database replies here are synthetic. Native process
// recovery is verified separately against the isolated PostgreSQL stack.
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),"preparation-cli-"));cleanup.push(()=>rm(root,{recursive:true,force:true}));
 const requests:Array<{path:string;body:Record<string,unknown>|null}>=[];
 const options={queued:false,claimError:false,holdClaim:false,readError:false};
 const claimReached=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
 const server=createServer(async(req,res)=>{
  const path=new URL(req.url!,"http://localhost").pathname,chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=Buffer.concat(chunks).toString();requests.push({path,body:body?JSON.parse(body):null});res.setHeader("content-type","application/json");
  if(path==="/rest/v1/engagement_synthesis_preparation_jobs"){
   if(options.readError){res.statusCode=503;res.end('{"message":"PRIVATE database detail"}');}else res.end(JSON.stringify(options.queued?[{request_id:requestId,status:"queued",lease_until:null}]:[]));
  }else if(path.endsWith("/claim_engagement_synthesis_preparation")){
   claimReached.resolve();if(options.holdClaim)await release.promise;
   if(options.claimError){res.statusCode=503;res.end('{"message":"PRIVATE claim detail"}');}else res.end("null");
  }else{res.statusCode=404;res.end("{}");}
 });
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));cleanup.push(async()=>{release.resolve();server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));});
 const target=`http://127.0.0.1:${(server.address() as AddressInfo).port}`,directory=join(root,createHash("sha256").update(target).digest("hex"));
 function start(argv=["--once"],environment:Partial<NodeJS.ProcessEnv>={}){
  const child=spawn(process.execPath,["--conditions=react-server","--import","tsx","scripts/workers/synthesis-preparation.ts",...argv],{cwd:process.cwd(),env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:target,SUPABASE_SERVICE_ROLE_KEY:"SYNTHETIC-PRIVATE-KEY",OPENPLAN_SYNTHESIS_PREPARATION_WORK_DIR:root,...environment},stdio:["ignore","pipe","pipe"]});
  let stdout="",stderr="";const reported=Promise.withResolvers<void>();child.stdout.on("data",d=>{stdout+=String(d);if(stdout.includes("Preparation pass:"))reported.resolve();});child.stderr.on("data",d=>stderr+=String(d));
  const ended=new Promise<{code:number|null;signal:NodeJS.Signals|null;stdout:string;stderr:string}>((resolve,reject)=>{child.once("error",reject);child.once("exit",(code,signal)=>resolve({code,signal,stdout,stderr}));});
  cleanup.push(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill("SIGKILL");await ended;});return{child,ended,reported:reported.promise};
 }
 return{root,target,directory,requests,options,start,claimReached:claimReached.promise,release:()=>release.resolve(),journal:async()=>JSON.parse(await readFile(join(directory,"pending.json"),"utf8"))};
}
describe("preparation CLI processes",()=>{
 it("runs one bounded empty pass and creates private target custody",async()=>{
  const f=await fixture(),result=await f.start().ended;expect(result.code,result.stderr).toBe(0);expect(result.stdout).toContain("0 pending custody records");expect(result.stdout).toContain("not full queue completion");expect((await f.journal()).target).toBe(f.target);expect(f.requests).toHaveLength(1);
 });
 it("retains unknown claims and reuses their exact token in a fresh process",async()=>{
  const f=await fixture();f.options.queued=true;f.options.claimError=true;const first=await f.start().ended;expect(first.code,first.stderr).toBe(2);expect(first.stdout).toContain("1 pending custody records");expect(first.stdout+first.stderr).not.toContain("PRIVATE");const saved=await f.journal();expect(saved.pending).toHaveLength(1);
  const childPath=join(f.directory,saved.pending[0].directoryId,"pending.json"),claim=JSON.parse(await readFile(childPath,"utf8"));expect(claim.phase).toBe("claim");
  f.options.claimError=false;f.options.queued=false;const second=await f.start().ended;expect(second.code,second.stderr).toBe(0);expect((await f.journal()).pending).toEqual([]);
  const calls=f.requests.filter(r=>r.path.endsWith("/claim_engagement_synthesis_preparation"));expect(calls).toHaveLength(2);expect(calls[1].body).toEqual(calls[0].body);expect(calls[1].body?.p_token).toBe(claim.token);expect(JSON.parse(await readFile(childPath,"utf8")).phase).toBe("not_active");
 });
 it.each([{argv:[],signal:"SIGTERM" as const,code:0},{argv:["--once"],signal:"SIGINT" as const,code:1}])("stops an active claim with $signal",async({argv,signal,code})=>{
  const f=await fixture();f.options.queued=true;f.options.holdClaim=true;const running=f.start(argv);await Promise.race([f.claimReached,running.ended.then(r=>{throw new Error(r.stderr);})]);running.child.kill(signal);
  const result=await running.ended;expect(result.code,result.stderr).toBe(code);expect(result.stdout).toContain("worker stopped");expect((await f.journal()).pending).toHaveLength(1);expect(result.stdout).not.toContain("attempts acknowledged");f.release();
 });
 it("stops the continuous worker during its idle delay",async()=>{
  const f=await fixture(),running=f.start([]);await Promise.race([running.reported,running.ended.then(r=>{throw new Error(r.stderr);})]);running.child.kill("SIGTERM");const result=await running.ended;expect(result.code,result.stderr).toBe(0);expect(result.stdout).toContain("worker stopped");expect(f.requests).toHaveLength(1);
 });
 it("returns one for an unavailable inventory and keeps private errors out of output",async()=>{
  const f=await fixture();f.options.readError=true;const result=await f.start().ended;expect(result.code).toBe(1);expect(result.stderr).toContain("pass could not finish");expect(result.stdout+result.stderr).not.toContain("PRIVATE");expect((await f.journal()).pending).toEqual([]);
 });
 it.each([["--unknown"],["--once","--once"],["--help","--once"]].map(argv=>({argv})))("rejects invalid arguments before HTTP $argv",async({argv})=>{const f=await fixture(),result=await f.start(argv).ended;expect(result.code).toBe(1);expect(f.requests).toHaveLength(0);});
 it("prints help without database configuration",async()=>{const f=await fixture(),result=await f.start(["--help"],{NEXT_PUBLIC_SUPABASE_URL:"",SUPABASE_SERVICE_ROLE_KEY:""}).ended;expect(result.code,result.stderr).toBe(0);expect(result.stdout).toContain("Usage:");expect(f.requests).toHaveLength(0);});
 it.each([{NEXT_PUBLIC_SUPABASE_URL:"http://user:PRIVATE@localhost:29821"},{OPENPLAN_SYNTHESIS_PREPARATION_WORK_DIR:"relative"},{SUPABASE_SERVICE_ROLE_KEY:""}])("refuses invalid startup configuration without requests",async environment=>{const f=await fixture(),result=await f.start(["--once"],environment).ended;expect(result.code).toBe(1);expect(result.stderr).toContain("could not run");expect(result.stdout+result.stderr).not.toContain("PRIVATE");expect(f.requests).toHaveLength(0);});
});
