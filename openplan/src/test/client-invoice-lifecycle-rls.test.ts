import { requireContractVerificationStack } from "./helpers/contract-verification-stack";
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

/**
 * Live custody for client invoice status rules (KI-2026-10-12-007).
 *
 * The rules used to live only in the invoice route, while the table policies
 * check membership. These cases write through the authenticated role, the same
 * path the public Data API offers. Status rules are exercised as an admin, who
 * passes the role rule, so the guard triggers are what refuse. The role rule
 * (20261102120000) is exercised as a member and a viewer, who must be refused
 * every draft write, and as the owner, an admin and service_role, who must not
 * be. Harness cases drop the guard triggers or the new policies, or weaken a
 * function, inside the same rolled-back transaction, and the refusal must then
 * fail.
 */
const CORRECTED = readFileSync("supabase/migrations/20261017000005_money_integrity_corrections.sql", "utf8");
const replaceStart = CORRECTED.indexOf("CREATE FUNCTION public.replace_client_invoice_lines(");
const replaceFunction = CORRECTED.slice(replaceStart, CORRECTED.indexOf("END $$;", replaceStart) + 7).replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION");
const STAMP_CHECK = "IF stamped<>cardinality(ids) THEN RAISE EXCEPTION 'One or more time entries are already billed on another invoice' USING ERRCODE='PT409'; END IF;";
const withoutGuards = `DROP TRIGGER retained_client_invoice_lifecycle ON public.client_invoices;
DROP TRIGGER retained_client_invoice_line_lifecycle ON public.client_invoice_line_items;`;
const ROLE_RULE = readFileSync("supabase/migrations/20261102120000_client_invoice_owner_admin_writes.sql", "utf8");
const roleFunctionStart = ROLE_RULE.indexOf("CREATE FUNCTION public.workspace_member_can_write_invoices(");
const roleFunction = ROLE_RULE.slice(roleFunctionStart, ROLE_RULE.indexOf("$$;", ROLE_RULE.indexOf("AS $$", roleFunctionStart)) + 3).replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION");
const ROLE_LIST = "AND wm.role IN ('owner', 'admin')";
const withoutRoleRule = ["insert", "update", "delete"].flatMap((command) => [
  `DROP POLICY client_invoices_invoice_writer_${command} ON public.client_invoices;`,
  `DROP POLICY client_invoice_line_items_invoice_writer_${command} ON public.client_invoice_line_items;`,
]).join(" ");

function exercise(body: string, replacement = "") {
  requireContractVerificationStack(resolveLocalDbContainer());
  const injected = process.env.OPENPLAN_CONTRACT_TEST_SQL ? readFileSync(process.env.OPENPLAN_CONTRACT_TEST_SQL, "utf8") : "";
  return execFileSync("docker", ["exec", "-i", resolveLocalDbContainer(), "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    input: `BEGIN; SET LOCAL lock_timeout='5s';${injected}\n${replacement}
DO $test$ DECLARE
 owner_id uuid:=gen_random_uuid(); admin_id uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid(); viewer_id uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); workspace uuid:=gen_random_uuid();
 client uuid:=gen_random_uuid(); engagement uuid:=gen_random_uuid(); project uuid:=gen_random_uuid(); deliverable uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid();
 invoice uuid:=gen_random_uuid(); other_invoice uuid:=gen_random_uuid(); line_one uuid:=gen_random_uuid(); other_line uuid:=gen_random_uuid();
 entry_one uuid:=gen_random_uuid(); entry_two uuid:=gen_random_uuid(); entry_three uuid:=gen_random_uuid();
 lines jsonb; n integer; before jsonb; created uuid;
BEGIN
 INSERT INTO auth.users(id,email) VALUES(owner_id,owner_id||'@example.test'),(admin_id,admin_id||'@example.test'),(member_id,member_id||'@example.test'),(viewer_id,viewer_id||'@example.test'),(outsider,outsider||'@example.test');
 INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'Synthetic receivables',workspace::text);
 INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,owner_id,'owner'),(workspace,admin_id,'admin'),(workspace,member_id,'member'),(workspace,viewer_id,'viewer');
 INSERT INTO public.projects(id,workspace_id,name) VALUES(project,workspace,'Synthetic corridor study');
 INSERT INTO public.project_deliverables(id,project_id,title) VALUES(deliverable,project,'Synthetic draft report');
 INSERT INTO public.invoicing_clients(id,workspace_id,name) VALUES(client,workspace,'Synthetic client, not a real agency');
 INSERT INTO public.invoicing_engagements(id,workspace_id,client_id,project_id,title) VALUES(engagement,workspace,client,project,'Synthetic on-call contract');
 INSERT INTO public.invoicing_staff(id,workspace_id,name) VALUES(staff,workspace,'Synthetic planner');
 INSERT INTO public.invoicing_time_entries(id,workspace_id,staff_id,engagement_id,entry_date,hours) VALUES(entry_one,workspace,staff,engagement,'2026-09-01',2),(entry_two,workspace,staff,engagement,'2026-09-02',1),(entry_three,workspace,staff,engagement,'2026-09-03',1);
 INSERT INTO public.client_invoices(id,workspace_id,client_id,engagement_id,project_id,invoice_number,status,subtotal_amount,total_amount) VALUES(invoice,workspace,client,engagement,project,'SYNTH-001','draft',100,100),(other_invoice,workspace,client,engagement,project,'SYNTH-002','draft',50,50);
 INSERT INTO public.client_invoice_line_items(id,invoice_id,position,description,amount,deliverable_id) VALUES(line_one,invoice,0,'Original line',100,deliverable),(other_line,other_invoice,0,'Other invoice line',50,NULL);
 UPDATE public.invoicing_time_entries SET billed_line_item_id=line_one WHERE id=entry_one;
 UPDATE public.invoicing_time_entries SET billed_line_item_id=other_line WHERE id=entry_three;
 ${body}
END $test$;
SELECT 'INVOICE_LIFECYCLE_ASSERTIONS_REACHED'; ROLLBACK;`,
  });
}
const reached = (output: string) => expect(output).toContain("INVOICE_LIFECYCLE_ASSERTIONS_REACHED");
const asMember = `PERFORM set_config('request.jwt.claim.sub',member_id::text,true); EXECUTE 'SET LOCAL ROLE authenticated';`;
const asOwner = `PERFORM set_config('request.jwt.claim.sub',owner_id::text,true); EXECUTE 'SET LOCAL ROLE authenticated';`;
const asAdmin = `PERFORM set_config('request.jwt.claim.sub',admin_id::text,true); EXECUTE 'SET LOCAL ROLE authenticated';`;
const asViewer = `PERFORM set_config('request.jwt.claim.sub',viewer_id::text,true); EXECUTE 'SET LOCAL ROLE authenticated';`;
const reset = `EXECUTE 'RESET ROLE';`;
const markPaid = `UPDATE public.client_invoices SET status='sent',sent_date='2026-09-05' WHERE id=invoice;
 UPDATE public.client_invoices SET status='paid',paid_date='2026-09-20' WHERE id=invoice;`;
const refuse = (statement: string, label: string) =>
  `BEGIN ${statement} RAISE EXCEPTION '${label}'; EXCEPTION WHEN check_violation THEN NULL; END;`;

const paidRefusals = `${markPaid}${asAdmin}
 ${refuse("UPDATE public.client_invoices SET total_amount=1 WHERE id=invoice;", "Paid invoice repriced through the Data API")}
 ${refuse("UPDATE public.client_invoices SET status='draft' WHERE id=invoice;", "Paid invoice reopened")}
 ${refuse("UPDATE public.client_invoices SET paid_date='2026-09-21' WHERE id=invoice;", "Paid date rewritten")}
 ${refuse("UPDATE public.client_invoice_line_items SET amount=1 WHERE invoice_id=invoice;", "Paid line repriced")}
 ${refuse("DELETE FROM public.client_invoice_line_items WHERE invoice_id=invoice;", "Paid line deleted")}
 ${refuse("INSERT INTO public.client_invoice_line_items(invoice_id,position,description,amount) VALUES(invoice,9,'Appended line',1);", "Line appended to paid invoice")}
 UPDATE public.client_invoices SET status='void' WHERE id=invoice; GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'Voiding a paid invoice was refused'; END IF;
 ${refuse("UPDATE public.client_invoices SET status='sent' WHERE id=invoice;", "Void invoice revived")}
 ${reset}
 ${refuse("DELETE FROM public.client_invoices WHERE id=invoice;", "Void invoice deleted")}
 IF (SELECT total_amount FROM public.client_invoices WHERE id=invoice)<>100 OR (SELECT amount FROM public.client_invoice_line_items WHERE id=line_one)<>100 THEN RAISE EXCEPTION 'Retained invoice changed'; END IF;`;

const replaceLines = `lines:=jsonb_build_array(
  jsonb_build_object('description','Revised work, September 1','quantity',2,'unit_label','hours','unit_amount',100,'amount',200,'deliverable_id',deliverable,'milestone_id',NULL,'source_time_entry_ids',jsonb_build_array(entry_one)),
  jsonb_build_object('description','Revised work, September 2','quantity',NULL,'unit_label',NULL,'unit_amount',NULL,'amount',100,'deliverable_id',NULL,'milestone_id',NULL,'source_time_entry_ids',jsonb_build_array(entry_two)));`;
const raceRefused = `${asOwner}${replaceLines}
 SELECT jsonb_build_object('lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.position) FROM public.client_invoice_line_items l WHERE l.invoice_id=invoice),'stamps',(SELECT jsonb_agg(jsonb_build_array(t.id,t.billed_line_item_id) ORDER BY t.id) FROM public.invoicing_time_entries t WHERE t.workspace_id=workspace),'total',(SELECT total_amount FROM public.client_invoices WHERE id=invoice)) INTO before;
 lines:=jsonb_set(lines,'{1,source_time_entry_ids}',jsonb_build_array(entry_three));
 BEGIN PERFORM public.replace_client_invoice_lines(invoice,lines,300,0,300); RAISE EXCEPTION 'Replacement stamped time billed on another invoice';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 IF jsonb_build_object('lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.position) FROM public.client_invoice_line_items l WHERE l.invoice_id=invoice),'stamps',(SELECT jsonb_agg(jsonb_build_array(t.id,t.billed_line_item_id) ORDER BY t.id) FROM public.invoicing_time_entries t WHERE t.workspace_id=workspace),'total',(SELECT total_amount FROM public.client_invoices WHERE id=invoice))<>before THEN RAISE EXCEPTION 'Failed replacement left a partial change'; END IF;
 ${reset}`;

const draftState = `SELECT jsonb_build_object('invoices',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.client_invoices i WHERE i.workspace_id=workspace),'lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.client_invoice_line_items l JOIN public.client_invoices i ON i.id=l.invoice_id WHERE i.workspace_id=workspace)) INTO before;`;
const draftUnchanged = (label: string) => `IF (SELECT jsonb_build_object('invoices',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.client_invoices i WHERE i.workspace_id=workspace),'lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.client_invoice_line_items l JOIN public.client_invoices i ON i.id=l.invoice_id WHERE i.workspace_id=workspace)))<>before THEN RAISE EXCEPTION '${label}'; END IF;`;
const rowCount = (expected: number, label: string) => `GET DIAGNOSTICS n=ROW_COUNT; IF n<>${expected} THEN RAISE EXCEPTION '${label}'; END IF;`;
const refusedByRole = (statement: string, label: string) =>
  `BEGIN ${statement} RAISE EXCEPTION '${label}'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;`;

// A member and a viewer may read invoices but may not write a draft or its lines (role matrix invoices.write).
// An insert is refused loudly; an update or delete matches no row, so the row count and the stored rows are checked.
const roleRefusals = (as: string, who: string) => `${as}
 ${refusedByRole(`INSERT INTO public.client_invoices(workspace_id,client_id,engagement_id,project_id,invoice_number,status) VALUES(workspace,client,engagement,project,'SYNTH-${who}','draft');`, `${who} created a draft invoice`)}
 UPDATE public.client_invoices SET notes='${who} note',total_amount=1 WHERE id=invoice; ${rowCount(0, `${who} edited a draft invoice`)}
 UPDATE public.client_invoices SET status='void' WHERE id=invoice; ${rowCount(0, `${who} voided a draft invoice`)}
 DELETE FROM public.client_invoices WHERE id=other_invoice; ${rowCount(0, `${who} deleted a draft invoice`)}
 ${refusedByRole(`INSERT INTO public.client_invoice_line_items(invoice_id,position,description,amount) VALUES(invoice,9,'${who} line',1);`, `${who} added a draft line`)}
 UPDATE public.client_invoice_line_items SET amount=1 WHERE id=line_one; ${rowCount(0, `${who} repriced a draft line`)}
 DELETE FROM public.client_invoice_line_items WHERE invoice_id=invoice; ${rowCount(0, `${who} deleted a draft line`)}
 ${refusedByRole("PERFORM public.replace_client_invoice_lines(invoice,lines,300,0,300);", `${who} replaced draft lines`)}
 IF (SELECT count(*) FROM public.client_invoices WHERE workspace_id=workspace)<>2 THEN RAISE EXCEPTION '${who} cannot read the workspace invoices'; END IF;
 ${reset}`;
const memberAndViewerRefusals = `${replaceLines}${draftState}
 ${roleRefusals(asMember, "Member")}
 ${roleRefusals(asViewer, "Viewer")}
 ${draftUnchanged("A refused draft write changed the stored invoice or lines")}`;

// The create route inserts the invoice and its lines with the caller's session after its owner-or-admin
// check, PATCH updates or voids with that session or replaces lines through the function, and a failed
// create is rolled back with the service-role client. A member's project delete clears the project from
// invoices through the foreign key, which runs as the table owner.
const writersAllowed = `${replaceLines}
 ${asAdmin}
 BEGIN
  INSERT INTO public.client_invoices(workspace_id,client_id,engagement_id,project_id,invoice_number,status,subtotal_amount,total_amount,created_by) VALUES(workspace,client,engagement,project,'SYNTH-ADMIN','draft',40,40,admin_id) RETURNING id INTO created;
  INSERT INTO public.client_invoice_line_items(invoice_id,position,description,amount) VALUES(created,0,'Admin line',40);
 EXCEPTION WHEN insufficient_privilege THEN RAISE EXCEPTION 'Admin refused a draft the create route allows'; END;
 UPDATE public.client_invoices SET notes='Admin draft note',due_date='2026-10-01' WHERE id=invoice; ${rowCount(1, "Admin refused a draft edit")}
 UPDATE public.client_invoice_line_items SET amount=120 WHERE id=line_one; ${rowCount(1, "Admin refused a draft line edit")}
 DELETE FROM public.client_invoice_line_items WHERE invoice_id=created; ${rowCount(1, "Admin refused a draft line delete")}
 BEGIN SELECT count(*) INTO n FROM public.replace_client_invoice_lines(invoice,lines,300,0,300); EXCEPTION WHEN insufficient_privilege THEN RAISE EXCEPTION 'Admin refused a line replacement'; END;
 IF n<>2 THEN RAISE EXCEPTION 'Admin line replacement incomplete'; END IF;
 UPDATE public.client_invoices SET status='void' WHERE id=other_invoice; ${rowCount(1, "Admin refused voiding a draft")}
 ${reset}${asOwner}
 UPDATE public.client_invoices SET status='sent',sent_date='2026-09-05' WHERE id=invoice; ${rowCount(1, "Owner refused sending a draft")}
 ${reset}
 EXECUTE 'SET LOCAL ROLE service_role';
 DELETE FROM public.client_invoices WHERE id=created; ${rowCount(1, "Service role refused the create route rollback delete")}
 ${reset}${asMember}
 DELETE FROM public.projects WHERE id=project; ${rowCount(1, "Member project delete refused")}
 ${reset}
 IF EXISTS(SELECT 1 FROM public.client_invoices WHERE workspace_id=workspace AND project_id IS NOT NULL) THEN RAISE EXCEPTION 'Deleted project kept on an invoice'; END IF;
 IF (SELECT row(status,total_amount) FROM public.client_invoices WHERE id=invoice)<>row('sent'::text,300::numeric) THEN RAISE EXCEPTION 'Allowed writes not stored'; END IF;`;

(LIVE_RLS ? describe : describe.skip)("client invoice lifecycle in the database", () => {
  it("refuses direct admin edits to a paid or void invoice and its lines, while paid to void still works", () => reached(exercise(paidRefusals)));

  it("keeps the route's draft and sent rules, and allows cleanup that cascades or clears a deleted reference", () => reached(exercise(`${asAdmin}
   UPDATE public.client_invoices SET notes='Synthetic draft note',due_date='2026-10-01' WHERE id=invoice;
   UPDATE public.client_invoice_line_items SET amount=120 WHERE id=line_one;
   ${refuse("UPDATE public.client_invoices SET status='paid',paid_date='2026-09-20' WHERE id=invoice;", "Draft marked paid without being sent")}
   UPDATE public.client_invoices SET status='sent',sent_date='2026-09-05' WHERE id=invoice;
   ${refuse("UPDATE public.client_invoices SET sent_date='2026-09-06' WHERE id=invoice;", "Sent date rewritten")}
   ${refuse("UPDATE public.client_invoices SET notes='Changed after sending' WHERE id=invoice;", "Sent invoice edited")}
   ${reset}
   ${refuse("DELETE FROM public.client_invoices WHERE id=invoice;", "Sent invoice deleted")}
   DELETE FROM public.client_invoices WHERE id=other_invoice;
   IF (SELECT billed_line_item_id FROM public.invoicing_time_entries WHERE id=entry_three) IS NOT NULL THEN RAISE EXCEPTION 'Deleted draft kept its time'; END IF;
   DELETE FROM public.project_deliverables WHERE id=deliverable;
   IF (SELECT deliverable_id FROM public.client_invoice_line_items WHERE id=line_one) IS NOT NULL THEN RAISE EXCEPTION 'Deleted deliverable reference kept'; END IF;
   DELETE FROM public.invoicing_engagements WHERE id=engagement;
   DELETE FROM public.invoicing_clients WHERE id=client;
   IF EXISTS(SELECT 1 FROM public.client_invoices WHERE workspace_id=workspace) THEN RAISE EXCEPTION 'Client deletion did not cascade'; END IF;
  `)));

  it("harness: without the guard triggers an admin reprices a paid invoice", () => {
    expect(() => exercise(paidRefusals, withoutGuards)).toThrow(/Paid invoice repriced through the Data API/);
  });

  it("refuses a member and a viewer every draft write and leaves the draft unchanged", () => reached(exercise(memberAndViewerRefusals)));

  it("lets the owner, an admin and the route's service-role path write drafts, and keeps owner-run cascades working", () => reached(exercise(writersAllowed)));

  it("harness: without the role policies a member creates and edits a draft, and an equivalent role list still passes", () => {
    expect(() => exercise(memberAndViewerRefusals, withoutRoleRule)).toThrow(/Member created a draft invoice/);
    if (!roleFunction.includes(ROLE_LIST)) throw new Error("Role list text not found in the migration");
    reached(exercise(memberAndViewerRefusals, roleFunction.replace(ROLE_LIST, "AND wm.role = ANY (ARRAY['admin', 'owner'])")));
  });

  it("harness: an owner-only rule refuses the admin the route allows", () => {
    expect(() => exercise(writersAllowed, roleFunction.replace(ROLE_LIST, "AND wm.role = 'owner'"))).toThrow(/Admin refused a draft the create route allows/);
  });

  it("replaces a draft invoice's lines, time links and totals in one call", () => reached(exercise(`${asOwner}${replaceLines}
   SELECT count(*) INTO n FROM public.replace_client_invoice_lines(invoice,lines,300,30,270);
   IF n<>2 OR EXISTS(SELECT 1 FROM public.client_invoice_line_items WHERE id=line_one) THEN RAISE EXCEPTION 'Lines not replaced'; END IF;
   IF (SELECT array_agg(l.position ORDER BY l.position) FROM public.client_invoice_line_items l WHERE l.invoice_id=invoice)<>ARRAY[0,1] THEN RAISE EXCEPTION 'Line order lost'; END IF;
   IF (SELECT row(subtotal_amount,retention_amount,total_amount) FROM public.client_invoices WHERE id=invoice)<>row(300::numeric,30::numeric,270::numeric) THEN RAISE EXCEPTION 'Totals not stored'; END IF;
   IF (SELECT l.description FROM public.invoicing_time_entries t JOIN public.client_invoice_line_items l ON l.id=t.billed_line_item_id WHERE t.id=entry_one)<>'Revised work, September 1'
    OR (SELECT l.description FROM public.invoicing_time_entries t JOIN public.client_invoice_line_items l ON l.id=t.billed_line_item_id WHERE t.id=entry_two)<>'Revised work, September 2' THEN RAISE EXCEPTION 'Time links not moved to the new lines'; END IF;
   ${reset}
  `)));

  it("leaves the previous lines, links and totals untouched when a time entry is already billed elsewhere", () => reached(exercise(raceRefused)));

  it("refuses sent invoices, members, inconsistent totals and anonymous callers", () => reached(exercise(`${replaceLines}
   ${asMember}
   BEGIN PERFORM public.replace_client_invoice_lines(invoice,lines,300,0,300); RAISE EXCEPTION 'Member replaced invoice lines'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   ${reset}${asOwner}
   BEGIN PERFORM public.replace_client_invoice_lines(invoice,lines,250,0,250); RAISE EXCEPTION 'Totals that disagree with the lines accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
   BEGIN PERFORM public.replace_client_invoice_lines(invoice,jsonb_set(lines,'{1,source_time_entry_ids}',jsonb_build_array(entry_one)),300,0,300); RAISE EXCEPTION 'One time entry backed two lines'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
   ${reset}
   UPDATE public.client_invoices SET status='sent',sent_date='2026-09-05' WHERE id=invoice;
   ${asOwner}
   BEGIN PERFORM public.replace_client_invoice_lines(invoice,lines,300,0,300); RAISE EXCEPTION 'Sent invoice lines replaced'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
   ${reset}
   EXECUTE 'SET LOCAL ROLE anon';
   BEGIN PERFORM public.replace_client_invoice_lines(invoice,lines,300,0,300); RAISE EXCEPTION 'Anonymous caller executed the function'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   ${reset}
  `)));

  it("harness: without the stamp count check the race case is caught, and a harmless edit still passes", () => {
    if (!replaceFunction.includes(STAMP_CHECK)) throw new Error("Stamp check text not found in the migration");
    expect(() => exercise(raceRefused, replaceFunction.replace(STAMP_CHECK, ""))).toThrow(/Replacement stamped time billed on another invoice/);
    reached(exercise(raceRefused, replaceFunction.replace("A time entry may back only one line item", "One time entry may back only one line item")));
  });
});
