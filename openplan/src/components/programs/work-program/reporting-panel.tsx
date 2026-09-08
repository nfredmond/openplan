"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ActualEntry, type ReportingData } from "./actual-entry";
import { PeriodReporting } from "./period-reporting";
import type { ActualCommand, ManagementCommand, ReportingPeriod, PeriodReport } from "@/lib/programs/work-program/reporting";
type Data = ReportingData & { periods: ReportingPeriod[]; reports: PeriodReport[]; events: { id: string; revision_id: string; kind: string; payload: { targetEventId?: string } }[] };
export function ReportingPanel({ programId, userId }: { programId: string; userId: string }) {
 const [data, setData] = useState<Data | null>(null), [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [pending, setPending] = useState<ActualCommand | ManagementCommand | null>(null);
 const key = `owp-reporting-pending:${userId}:${programId}`, url = `/api/programs/${programId}/work-program/reporting`;
 const reload = useCallback(async () => { const response = await fetch(url, { cache: "no-store" }); const result = await response.json(); if (!response.ok) throw new Error(result.error); setData(result); }, [url]);
 useEffect(() => { void reload().catch(e => setMessage(e.message)); try { const saved = localStorage.getItem(key); if (saved) setPending(JSON.parse(saved)); } catch { setMessage("Pending save could not be read. The local recovery text remains retained."); } }, [reload, key]);
 async function save(command: ActualCommand | ManagementCommand) {
  setBusy(true); setMessage("");
  try {
   localStorage.setItem(key, JSON.stringify(command)); setPending(command);
   const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
   const result = await response.json();
   if (!response.ok) { if (response.status < 500) { localStorage.removeItem(key); setPending(null); } throw new Error(result.error); }
   localStorage.removeItem(key); setPending(null);
   setMessage("Saved. The source entry and save identity are retained.");
   try { await reload(); } catch { setMessage("Save succeeded. Refresh failed; use Reload entries to see the saved version."); }
   return true;
  } catch (e) { setMessage(e instanceof Error ? e.message : "Save could not be confirmed. Retry the retained request."); return false; }
  finally { setBusy(false); }
 }
 return <div className="space-y-6 min-w-0"><nav aria-label="Work program sections" className="flex flex-wrap gap-4 text-sm underline"><a href="#actual-work">Actual work</a><a href="#period-reports">Period reports</a><a href="#budget-position">Budget position</a><a href="#preparation">Preparation and adoption history</a></nav><div className="flex flex-wrap gap-3"><Button className="h-auto min-h-10 max-w-full whitespace-normal" variant="outline" onClick={() => void reload().catch(e => setMessage(e.message))}>Reload entries</Button>{pending && <Button className="h-auto min-h-10 max-w-full whitespace-normal" disabled={busy} onClick={() => save(pending)}>Retry pending save</Button>}</div>{message && <p role="status" className="rounded-lg border p-3 text-sm">{message}</p>}{pending && <p role="alert">A save may have reached the server. Retry its retained request before creating another entry.</p>}{data ? data.revisions.length ? <><ActualEntry programId={programId} data={data} save={save} disabled={busy || !!pending}/>{data.canManage && <PeriodReporting programId={programId} data={data} save={save} disabled={busy || !!pending}/>}</> : <p>Save a preparation revision below before attributing actual work. Adopt a baseline before issuing a management report.</p> : <p>Loading reporting entries…</p>}</div>;
}
