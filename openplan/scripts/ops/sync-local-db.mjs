import {execFileSync} from "node:child_process";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import nextEnv from "@next/env";

/** Refuse a different local stack before the first schema mutation. Never print status credentials.
 * @param {{apiUrl?: string, workdir?: string, run: (args: string[], privateOutput: boolean) => string | null}} input
 */
export function syncLocalDatabase({apiUrl,workdir,run}) {
  const scope=workdir?["--workdir",workdir]:[];
  const status=JSON.parse(run(["status",...scope,"--output","json"],true) ?? "null");
  let appOrigin,stackOrigin;
  try {appOrigin=new URL(apiUrl).origin;stackOrigin=new URL(status.API_URL).origin;} catch {throw new Error("Configure NEXT_PUBLIC_SUPABASE_URL and start the intended local stack before syncing migrations.");}
  if(appOrigin!==stackOrigin) throw new Error("Database mismatch: the application and local migration target are different. Set OPENPLAN_SUPABASE_WORKDIR to the intended stack before retrying. No migrations were applied.");
  run(["migration","up",...scope,"--local","--yes","--output-format","json"],false);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
    syncLocalDatabase({apiUrl:process.env.NEXT_PUBLIC_SUPABASE_URL,workdir:process.env.OPENPLAN_SUPABASE_WORKDIR,run:(args,privateOutput)=>execFileSync(resolve("node_modules/.bin/supabase"),args,{encoding:"utf8",stdio:privateOutput?["ignore","pipe","pipe"]:"inherit"})});
  } catch(error) {console.error(error instanceof Error&&error.message.startsWith("Database mismatch:")?error.message:"Local migration sync refused. Check the application database and OPENPLAN_SUPABASE_WORKDIR; status credentials were withheld.");process.exitCode=1;}
}
