import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

const migration = readFileSync("supabase/migrations/20261015000001_measure_period_fund_integrity.sql", "utf8");
const tables = ["measure_allocations", "measure_period_off_the_top", "measure_period_reserve"] as const;
type ChildTable = typeof tables[number];

/** Replay the upgrade and all assertions within one disposable transaction. */
function probe(options: { historicalTable?: ChildTable; mutation?: string; harmless?: boolean } = {}) {
  const container = resolveLocalDbContainer();
  if (!(process.env.GITHUB_ACTIONS === "true" && container === "supabase_db_openplan") &&
      !/^supabase_db_(independent-fixes-20261001|openplan-security-verification(?:-[a-z0-9-]+)?)$/.test(container)) {
    throw new Error("Select a disposable financial parent verification stack");
  }
  const actor = randomUUID(), workspace = randomUUID(), fund = randomUUID(), otherFund = randomUUID(), period = randomUUID();
  const insert = (table: ChildTable, label: string, parent = fund) => {
    const common = `workspace_id,measure_fund_id,period_id`;
    const values = `'${workspace}','${parent}','${period}'`;
    if (table === "measure_allocations") return `INSERT INTO public.${table}(${common},category_id,amount,computation_basis,rationale) VALUES(${values},'${label}',12.34,'manual','SYNTHETIC original retained rationale')`;
    if (table === "measure_period_off_the_top") return `INSERT INTO public.${table}(${common},off_the_top_id,label,amount,uncapped_amount,cap_status) VALUES(${values},'${label}','SYNTHETIC retained clause',12.34,12.34,'no_cap')`;
    return `INSERT INTO public.${table}(${common},reserve_id,label,basis_kind,basis_amount,percent,amount,computed_amount) VALUES(${values},'${label}','SYNTHETIC retained reserve','gross',123.40,10,12.34,12.34)`;
  };
  const before = tables.map(table => `ALTER TABLE public.${table} DROP CONSTRAINT ${table}_period_fund_fk;`).join("\n");
  const snapshot = tables.map(table => `INSERT INTO parent_before SELECT '${table}',id,to_jsonb(row) FROM public.${table} row WHERE period_id='${period}';`).join("\n");
  const preserved = tables.map(table => `SELECT pg_temp.assert_true(NOT EXISTS(
    SELECT 1 FROM parent_before original LEFT JOIN public.${table} current ON current.id=original.row_id
    WHERE original.table_name='${table}' AND original.payload IS DISTINCT FROM to_jsonb(current)),
    'Migration changed retained ${table} rows');`).join("\n");
  const validation = tables.map(table => `SELECT pg_temp.assert_true((SELECT convalidated=${options.historicalTable === table ? "false" : "true"}
    FROM pg_constraint WHERE conrelid='public.${table}'::regclass AND conname='${table}_period_fund_fk'),
    'Unexpected validation state for ${table}');`).join("\n");
  const refusal = tables.map(table => `
    ${insert(table, "valid-new")};
    SELECT pg_temp.expect_fk($statement$${insert(table, "wrong-new", otherFund)}$statement$,'${table}_period_fund_fk','New ${table} mismatch was allowed');
    SELECT pg_temp.expect_fk($statement$UPDATE public.${table} SET measure_fund_id='${otherFund}' WHERE period_id='${period}' AND measure_fund_id='${fund}'$statement$,
      '${table}_period_fund_fk','Updated ${table} mismatch was allowed');`).join("\n");
  const repair = options.historicalTable ? `
    UPDATE public.${options.historicalTable} SET measure_fund_id='${fund}' WHERE period_id='${period}' AND measure_fund_id='${otherFund}';
    ALTER TABLE public.${options.historicalTable} VALIDATE CONSTRAINT ${options.historicalTable}_period_fund_fk;
    SELECT pg_temp.assert_true((SELECT convalidated FROM pg_constraint WHERE conrelid='public.${options.historicalTable}'::regclass
      AND conname='${options.historicalTable}_period_fund_fk'),'Operator reconciliation did not permit validation');` : "";
  const sql = `BEGIN; SET LOCAL statement_timeout='20s'; SET LOCAL lock_timeout='2s';
${before}
ALTER TABLE public.measure_fund_periods DROP CONSTRAINT measure_period_fund_workspace_uniq;
INSERT INTO auth.users(id,aud,role,email) VALUES('${actor}','authenticated','authenticated','finance-${actor}@example.invalid');
INSERT INTO public.workspaces(id,name,slug) VALUES('${workspace}','SYNTHETIC parent migration','finance-${workspace}');
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('${workspace}','${actor}','member');
INSERT INTO public.programs(id,workspace_id,title,program_type,cycle_name) VALUES
 ('${fund}','${workspace}','SYNTHETIC original fund','local_measure','FY26'),
 ('${otherFund}','${workspace}','SYNTHETIC unrelated fund','local_measure','FY26');
INSERT INTO public.measure_funds(id,workspace_id,program_id,receipt_cadence,currency_code) VALUES
 ('${fund}','${workspace}','${fund}','quarterly','USD'),('${otherFund}','${workspace}','${otherFund}','quarterly','USD');
INSERT INTO public.measure_fund_periods(id,workspace_id,measure_fund_id,period_label,fiscal_year_label,period_start,period_end,received_amount)
 VALUES('${period}','${workspace}','${fund}','Q1','FY26','2026-01-01','2026-03-31',123.40);
${tables.map(table => insert(table, "original") + ";").join("\n")}
${options.historicalTable ? insert(options.historicalTable, "historical-mismatch", otherFund) + ";" : ""}
CREATE TEMP TABLE parent_before(table_name text,row_id uuid,payload jsonb);
${snapshot}
CREATE FUNCTION pg_temp.assert_true(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION '%',label; END IF; END $$;
CREATE FUNCTION pg_temp.expect_fk(statement text,expected_constraint text,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual_constraint text;
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN foreign_key_violation THEN
  GET STACKED DIAGNOSTICS actual_constraint=CONSTRAINT_NAME;
  IF expected_constraint IS NOT NULL AND actual_constraint IS DISTINCT FROM expected_constraint THEN
   RAISE EXCEPTION '%: wrong foreign key %',label,actual_constraint;
  END IF;
  RETURN;
 END;
 RAISE EXCEPTION '%',label;
END $$;
${options.harmless ? "-- Harmless upgrade comment control.\n" : ""}${migration}
${preserved}
${validation}
${options.mutation ?? ""}
${preserved}
${refusal}
SELECT set_config('request.jwt.claim.sub','${actor}',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_fk($statement$SELECT public.replace_measure_period_allocation('${otherFund}','${period}','[]','[]','[]')$statement$,
 NULL,'Empty replacement accepted a foreign fund period');
RESET ROLE;
${preserved}
${repair}
SELECT 'measure-parent-upgrade-verified';
ROLLBACK;`;
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30000,
  });
}

describe.skipIf(!LIVE_RLS)("native measure period parent upgrade", () => {
  it("validates a clean upgrade and all three child relationships", () => {
    expect(probe()).toContain("measure-parent-upgrade-verified");
  });
  it("survives an added SQL comment", () => {
    expect(probe({ harmless: true })).toContain("measure-parent-upgrade-verified");
  });
  it.each(tables)("preserves historical %s mismatches while enforcing new writes", historicalTable => {
    expect(probe({ historicalTable })).toContain("measure-parent-upgrade-verified");
  });
  it.each(tables)("detects a missing %s relationship", table => {
    // Mutate after catalog checks so only an actual write can detect the defect.
    let failure: unknown;
    try {
      probe({ mutation: `ALTER TABLE public.${table} DROP CONSTRAINT ${table}_period_fund_fk;` });
    } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    expect(String((failure as { stderr?: unknown }).stderr)).toContain(`New ${table} mismatch was allowed`);
  });
  it("detects removal of the empty-replacement parent check", () => {
    let failure: unknown;
    try {
      probe({ mutation: `DO $fault$ DECLARE body text; BEGIN
        body=pg_get_functiondef('public.replace_measure_period_allocation(uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure);
        IF position('IF NOT FOUND THEN' IN body)=0 THEN RAISE EXCEPTION 'Missing parent-check mutation seam'; END IF;
        EXECUTE replace(body,'IF NOT FOUND THEN','IF false THEN'); END $fault$;` });
    } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    expect(String((failure as { stderr?: unknown }).stderr)).toContain("Empty replacement accepted a foreign fund period");
  });
  it("detects loss of historical financial rows during upgrade", () => {
    let failure: unknown;
    try {
      probe({ historicalTable: "measure_allocations", mutation: "DELETE FROM public.measure_allocations WHERE id IN (SELECT row_id FROM parent_before WHERE table_name='measure_allocations');" });
    } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    expect(String((failure as { stderr?: unknown }).stderr)).toContain("Migration changed retained measure_allocations rows");
  });
});
