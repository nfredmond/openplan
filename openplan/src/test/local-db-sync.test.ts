import {describe,expect,it,vi} from "vitest";
import {syncLocalDatabase} from "../../scripts/ops/sync-local-db.mjs";
describe("local migration database identity",()=>{
  it("refuses mismatched application and migration databases before mutation",()=>{
    const run=vi.fn(()=>JSON.stringify({API_URL:"http://127.0.0.1:54321",SERVICE_ROLE_KEY:"synthetic-secret"}));
    expect(()=>syncLocalDatabase({apiUrl:"http://127.0.0.1:56321",run})).toThrow("Database mismatch");expect(run).toHaveBeenCalledTimes(1);expect(run.mock.calls[0]).toEqual([["status","--output","json"],true]);
  });
  it("scopes both status and migration commands to the matching explicit workdir",()=>{
    const run=vi.fn(()=>JSON.stringify({API_URL:"http://127.0.0.1:56321"}));syncLocalDatabase({apiUrl:"http://127.0.0.1:56321",workdir:"/synthetic/isolated",run});
    expect(run.mock.calls).toEqual([[["status","--workdir","/synthetic/isolated","--output","json"],true],[["migration","up","--workdir","/synthetic/isolated","--local","--yes","--output-format","json"],false]]);
  });
  it("fails closed on missing configuration and unreadable target status",()=>{
    const run=vi.fn(()=>"{}");expect(()=>syncLocalDatabase({apiUrl:undefined,run})).toThrow();expect(run).toHaveBeenCalledTimes(1);
    run.mockImplementation(()=>{throw new Error("status unavailable");});expect(()=>syncLocalDatabase({apiUrl:"http://127.0.0.1:56321",run})).toThrow();expect(run).toHaveBeenCalledTimes(2);
  });
});
