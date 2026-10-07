"use client";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { bcaDraftSchema, bcaRetainedSaveSchema, readBcaDraft } from "@/lib/bca/workbench/draft";
import {
  bcaDocumentSchema,
  type BcaDocument,
  type BcaEvidence,
} from "@/lib/bca/workbench/schema";
import {
  newBcaDocument,
  newBcaFlow,
  exampleBcaDocument,
} from "@/lib/bca/workbench/document";
import { BCA_PROFILES, getBcaProfile } from "@/lib/bca/workbench/profiles";
import {
  importBcaModelEvidence,
  type BcaModelEvidence,
} from "@/lib/bca/workbench/model-evidence";
import { BcaFlowEditor } from "./flow-editor";
import { canonicalBcaJson } from "@/lib/bca/workbench/canonical";
import { BcaQuantityBuilder } from "./quantity-builder";
import { BcaResults } from "./results";
import { Field, NumberField, selectClass, buttonClass } from "./fields";

type Version = {
  id: string;
  created_at: string;
  created_by: string;
  document_json: unknown;
  inputHash: string;
};
type Pending = { id: string; document: BcaDocument };
const tabs = [
  "Scope and method",
  "Evidence",
  "Benefits and costs",
  "Results and review",
  "Saved versions",
] as const;
function download(content: BlobPart, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function BcaWorkbench({
  projectId,
  projectName,
  userId,
  canSave,
  models,
  modelReadFailed,
}: {
  models: BcaModelEvidence[];
  modelReadFailed: boolean;
  projectId: string;
  projectName: string;
  userId: string;
  canSave: boolean;
}) {
  const {confirm,confirmDialog}=useConfirmDialog();
  const [doc, setDoc] = useState(() => newBcaDocument(projectId));
  const [tab, setTab] = useState<(typeof tabs)[number]>(tabs[0]);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [storageProblem, setStorageProblem] = useState<{raw: string | null} | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [more, setMore] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const key = `openplan:bca:${userId}:${projectId}`;
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(key);
      if (raw) {
        const restored = readBcaDraft(raw, projectId);
        if (restored.document) setDoc(restored.document);
        else if (restored.pending) setDoc(restored.pending.document);
        if (restored.pending) setPending(restored.pending);
        if (restored.unreadable) {
          setStorageProblem({raw});
          setNotice("Part of this tab's saved draft cannot be read. The original remains preserved. Download it before resuming draft storage.");
        } else setNotice("Recovered this tab's draft, including unfinished edits. Check saved versions for confirmed server saves.");
      }
    } catch (e) {
      setStorageProblem({raw});
      setNotice(`Could not restore the browser draft: ${e instanceof Error ? e.message : "storage unavailable"}. The original has not been replaced.`);
    }
    setLoaded(true);
  }, [key, projectId]);
  useEffect(() => {
    if (!loaded || storageProblem) return;
    try {
      sessionStorage.setItem(key, JSON.stringify({ document: doc, pending }));
    } catch {
      setNotice(
        "Browser draft storage is unavailable. Download analysis JSON before leaving this page.",
      );
    }
  }, [doc, pending, key, loaded, storageProblem]);
  const parsed = bcaDocumentSchema.safeParse(doc);
  const set = <K extends keyof BcaDocument>(k: K, v: BcaDocument[K]) =>
    setDoc({ ...doc, [k]: v });
  async function history(older = false) {
    setBusy(true);
    try {
      const last = older ? versions.at(-1) : undefined;
      const cursor = last
        ? `?${new URLSearchParams({ before: last.created_at, beforeId: last.id })}`
        : "";
      const r = await fetch(`/api/projects/${projectId}/bca-analyses${cursor}`);
      const p = await r.json();
      if (!r.ok) throw new Error(p.error);
      setVersions(older ? [...versions, ...p.versions] : p.versions);
      setMore(p.hasMore);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not load history");
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!canSave || busy || storageProblem) return;
    const request =
      pending ??
      (parsed.success
        ? { id: crypto.randomUUID(), document: parsed.data }
        : null);
    if (!request) {
      setNotice("Correct the input errors before saving.");
      return;
    }
    try {
      sessionStorage.setItem(
        key,
        JSON.stringify({ document: doc, pending: request }),
      );
    } catch {
      setNotice(
        "Cannot retain the save for retry. Download analysis JSON and restore browser storage before saving.",
      );
      return;
    }
    setPending(request);
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/bca-analyses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(30000),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? "Save was not confirmed");
      if (
        payload.version?.id !== request.id ||
        payload.version?.created_by !== userId ||
        canonicalBcaJson(payload.version?.document_json) !==
          canonicalBcaJson(request.document)
      )
        throw new Error("Save reply did not match the request.");
      setPending(null);
      setNotice(
        `Saved an immutable version at ${new Date(payload.version.created_at).toLocaleString("en-US")}. Further edits create a new version.`,
      );
    } catch (e) {
      setNotice(
        `${e instanceof Error ? e.message : "Save was not confirmed"}. The original request is retained. Retry to recover the same save.`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function exportPackage() {
    if (!parsed.success) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/bca-analyses/export`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(parsed.data),
          signal: AbortSignal.timeout(60000),
        },
      );
      if (!response.ok) {
        const p = await response.json();
        throw new Error(p.error ?? "Export failed");
      }
      download(
        await response.arrayBuffer(),
        "application/zip",
        "openplan-bca.zip",
      );
      setNotice(
        "Downloaded calculation workbook, annual data, full inputs, source register, report and checksums. Review worklist and program attachments before use.",
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }
  const profile = getBcaProfile(doc.programId);
  return (
    <section
      aria-label="Benefit-cost analysis workbench"
      className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6"
    >
      <div className="flex flex-wrap gap-4 text-sm">
        <Link className="underline" href="/grants#grants-benefit-cost">
          Grants
        </Link>
        <Link className="underline" href={`/projects/${projectId}`}>
          {projectName}
        </Link>
        <Link className="underline" href="/scenarios">
          Model comparisons
        </Link>
        <Link className="underline" href="/safety">
          Safety evidence
        </Link>
      </div>
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">
          Benefit-cost analysis
        </h1>
        <p className="max-w-3xl text-muted-foreground">
          Build the comparison, inspect what drives it, and hand another analyst
          the calculations. Missing evidence stays visible. Program acceptance
          and professional review remain separate from arithmetic.
        </p>
      </header>
      <div className="flex flex-wrap gap-2">
        <button
          className={buttonClass}
          disabled={busy || !!storageProblem || !canSave || (!pending && !parsed.success)}
          onClick={save}
        >
          {pending ? "Retry retained save" : "Save a version"}
        </button>
        <button
          className={buttonClass}
          disabled={busy || !parsed.success}
          onClick={exportPackage}
        >
          Download analysis package
        </button>
        <button
          className={buttonClass}
          onClick={() =>
            download(
              JSON.stringify(doc, null, 2),
              "application/json",
              "bca-analysis.json",
            )
          }
        >
          Download analysis JSON
        </button>
        <button
          className={buttonClass}
          disabled={!!pending || busy}
          onClick={() => file.current?.click()}
        >
          Import analysis JSON
        </button>
        <button
          className={buttonClass}
          disabled={!!pending || busy}
          onClick={async () => {
            if (
              await confirm({headline:"Replace this draft with a synthetic example?",consequence:"Download your current analysis first if needed. Saved project versions remain available.",confirmLabel:"Load the example"})
            ) {
              setDoc(exampleBcaDocument(projectId));
              setNotice(
                "Synthetic training example loaded. No project evidence or application validity is asserted.",
              );
            }
          }}
        >
          Try a synthetic example
        </button>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          aria-label="Import analysis JSON file"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              if (f.size > 1000000) throw new Error("Input file exceeds 1 MB.");
              const data: unknown = JSON.parse(await f.text());
              const retained = bcaRetainedSaveSchema.safeParse(data);
              const next = retained.success ? retained.data.document : bcaDraftSchema.parse(data);
              if (next.projectId !== projectId)
                throw new Error(
                  "This file belongs to a different project. Open that project's analysis.",
                );
              setDoc(next);
              if (retained.success) setPending(retained.data);
              setNotice(retained.success ? "Retained save restored. Retry sends its original identifier and exact analysis. Editing remains paused." :
                "Imported inputs. Calculations and review checks use the current engine.",
              );
            } catch (error) {
              setNotice(
                error instanceof Error ? error.message : "Invalid file",
              );
            }
            e.target.value = "";
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Drafts stay in this browser tab until it closes. Saved versions belong
        to the project.{" "}
        {canSave
          ? ""
          : "Your workspace role permits reading and local analysis, but not saving project records."}
      </p>
      {notice && (
        <p
          role="status"
          className="rounded-md border border-border bg-card p-3 text-sm"
        >
          {notice}
        </p>
      )}
      {storageProblem && (
        <div role="alert" className="rounded border border-amber-600 p-3 text-sm">
          Draft storage is paused to protect the unreadable original. If storage could not be accessed, reload after restoring browser access.
          <button className={buttonClass} disabled={storageProblem.raw === null} onClick={async () => {
            download(storageProblem.raw ?? "", "application/json", "bca-browser-recovery.json");
            if (await confirm({headline:"Resume draft storage after downloading the original?",consequence:"The browser will retain the currently displayed analysis and any recovered pending save. Keep the downloaded original for repair.",confirmLabel:"Resume draft storage"})) setStorageProblem(null);
          }}>Download original and resume draft storage</button>
        </div>
      )}
      {pending && (
        <p role="alert" className="rounded border border-amber-600 p-3 text-sm">
          A save awaits confirmation. Editing is paused so retry preserves the
          exact values. Retry the retained save or inspect saved versions.{" "}
          <button
            className="underline"
            disabled={busy}
            onClick={async () => {
              download(
                JSON.stringify(pending, null, 2),
                "application/json",
                "bca-retained-save.json",
              );
              if (
                await confirm({headline:"Release the retained request and resume editing?",consequence:"This does not cancel a server save that may already have completed. Inspect saved versions before creating another version.",confirmLabel:"Resume editing"})
              ) {
                setPending(null);
                setNotice(
                  "Retained request downloaded. Editing resumed; any completed server version remains in history.",
                );
              }
            }}
          >
            Download retained request and resume editing
          </button>
        </p>
      )}
      <nav
        className="flex flex-wrap gap-2 border-b pb-3"
        aria-label="BCA workflow"
      >
        {tabs.map((name) => (
          <button
            className={`${buttonClass} ${tab === name ? "bg-card font-semibold" : ""}`}
            aria-pressed={tab === name}
            key={name}
            onClick={() => {
              setTab(name);
              if (name === "Saved versions") void history();
            }}
          >
            {name}
          </button>
        ))}
      </nav>
      {!parsed.success && (
        <div
          role="alert"
          className="space-y-1 rounded border border-destructive p-3 text-sm"
        >
          <p>
            Correct these document errors. Results and saving are unavailable.
          </p>
          {parsed.error.issues.slice(0, 8).map((i, n) => (
            <p key={n}>
              {i.path.join(".")}: {i.message}
            </p>
          ))}
        </div>
      )}
      <fieldset
        disabled={!!pending || busy}
        className="min-w-0 space-y-5 border-0 p-0"
      >
        {tab === "Scope and method" && (
          <>
            <h2 className="text-xl font-semibold">Define the comparison</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Analysis title"
                value={doc.title}
                onChange={(v) => set("title", v)}
              />
              <Field label="Grant program and edition">
                <select
                  className={selectClass}
                  value={doc.programId}
                  onChange={(e) => {
                    const p = getBcaProfile(e.target.value)!;
                    setDoc({
                      ...doc,
                      programId: p.id,
                      programVersion: p.version,
                      priceYear: p.priceYear,
                      discountRatePct: p.discountRatePct,
                      costConvention: p.costConvention,
                    });
                  }}
                >
                  {BCA_PROFILES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="No Build case"
                multiline
                value={doc.noBuildDescription}
                onChange={(v) => set("noBuildDescription", v)}
              />
              <Field
                label="Build alternative"
                multiline
                value={doc.alternative}
                onChange={(v) => set("alternative", v)}
              />
              <Field
                label="Study geography and affected users"
                multiline
                value={doc.geography}
                onChange={(v) => set("geography", v)}
              />
              <Field
                label="Why this program and edition apply"
                multiline
                value={doc.applicability}
                onChange={(v) => set("applicability", v)}
              />
            </div>
            {profile && (
              <aside className="space-y-2 rounded-lg bg-card p-4">
                <h3 className="font-semibold">{profile.version}</h3>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {profile.requirements.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <p className="text-sm">{profile.caution}</p>
                {profile.controllingSource && (
                  <a
                    className="mr-4 text-sm underline"
                    href={profile.controllingSource}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Read the controlling program guidance
                  </a>
                )}
                {profile.source && (
                  <a
                    className="text-sm underline"
                    href={profile.source}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Read the method source
                  </a>
                )}
              </aside>
            )}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(
                [
                  "priceYear",
                  "discountYear",
                  "startYear",
                  "openingYear",
                  "endYear",
                  "discountRatePct",
                ] as const
              ).map((k) => (
                <NumberField
                  key={k}
                  label={
                    {
                      priceYear: "Constant-dollar year",
                      discountYear: "Discount epoch year",
                      startYear: "First analysis year",
                      openingYear: "Opening year",
                      endYear: "Last analysis year",
                      discountRatePct: "Real discount rate (%)",
                    }[k]
                  }
                  value={doc[k]}
                  onChange={(v) => set(k, v ?? 0)}
                />
              ))}
            </div>
            <Field label="BCR cost convention">
              <select
                className={selectClass}
                value={doc.costConvention}
                onChange={(e) =>
                  set(
                    "costConvention",
                    e.target.value as BcaDocument["costConvention"],
                  )
                }
              >
                <option value="capital-only">
                  USDOT: capital denominator; O&M and residual in numerator
                </option>
                <option value="all-costs">
                  Cal-B/C state: all incremental costs in denominator
                </option>
              </select>
            </Field>
            <Field
              label="Method, timing and departures from guidance"
              multiline
              value={doc.methodology}
              onChange={(v) => set("methodology", v)}
            />
            <p className="text-sm text-muted-foreground">
              Changing the program does not convert existing dollar values or
              re-estimate benefits. Review every stream. End-of-year discounting
              uses year minus the discount epoch; amounts in the epoch are
              undiscounted.
            </p>
          </>
        )}
        {tab === "Evidence" && (
          <>
            <h2 className="text-xl font-semibold">
              Track sources and missing values
            </h2>
            <section className="space-y-3 rounded border p-4">
              <h3 className="font-semibold">Reuse project model comparisons</h3>
              <p className="text-sm">
                The newest 100 ready comparisons are considered. Each demand
                method remains separate. Importing adds its daily VMT pair and
                source identifiers; annualization and monetary values remain
                blank until supported.
              </p>
              {modelReadFailed ? (
                <p role="alert">
                  Model evidence could not be read. This is not a finding that
                  no models exist.
                </p>
              ) : models.length ? (
                models.map((m) => (
                  <div
                    key={`${m.snapshotId}-${m.result.method}`}
                    className="space-y-2 border-t py-3"
                  >
                    <p>
                      {m.label}: {m.result.methodLabel}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      No Build: {m.result.baseline.claimStatus ?? "unassessed"}.
                      Build: {m.result.build.claimStatus ?? "unassessed"}.
                    </p>
                    <button
                      className={buttonClass}
                      onClick={() => {
                        try {
                          setDoc(importBcaModelEvidence(doc, m));
                          setNotice(
                            "Copied one method's daily VMT pair. Complete the missing inputs and inspect its source limitations.",
                          );
                        } catch (e) {
                          setNotice(
                            e instanceof Error ? e.message : "Import failed",
                          );
                        }
                      }}
                    >
                      Import this method&apos;s VMT
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-sm">
                  No ready guided model comparison is available for this
                  project. Create a comparison in Scenarios, or use documented
                  external evidence.
                </p>
              )}
            </section>
            <p className="text-sm">
              Use actual counts, crash reports, agency forecasts, cost estimates
              and hazard evidence. A source reference is not proof of
              suitability. Describe its period, geography, units and limitations.
            </p>
            {doc.evidence.map((s, index) => {
              const patch = (change: Partial<BcaEvidence>) =>
                set(
                  "evidence",
                  doc.evidence.map((v, i) =>
                    i === index ? { ...v, ...change } : v,
                  ),
                );
              return (
                <section key={s.id} className="space-y-4 rounded-lg border p-4">
                  <div className="flex flex-wrap justify-between gap-2">
                    <h3 className="font-semibold">{s.title || "New source"}</h3>
                    <button
                      className={buttonClass}
                      onClick={() =>
                        set(
                          "evidence",
                          doc.evidence.filter((v) => v.id !== s.id),
                        )
                      }
                    >
                      Remove source
                    </button>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Source title"
                      value={s.title}
                      onChange={(v) => patch({ title: v })}
                    />
                    <Field label="Evidence status">
                      <select
                        className={selectClass}
                        value={s.status}
                        onChange={(e) =>
                          patch({
                            status: e.target.value as BcaEvidence["status"],
                          })
                        }
                      >
                        {[
                          "documented",
                          "assumption",
                          "missing",
                          "model-screening",
                        ].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </Field>
                    <Field
                      label="URL, document id or retained file reference"
                      value={s.reference}
                      onChange={(v) => patch({ reference: v })}
                    />
                    <Field
                      label="Page, table, cell or record locator"
                      value={s.locator}
                      onChange={(v) => patch({ locator: v })}
                    />
                    <NumberField
                      label="Observation or parameter year"
                      value={s.observedYear}
                      onChange={(v) => patch({ observedYear: v })}
                    />
                    <Field
                      label="Responsible person"
                      value={s.owner}
                      onChange={(v) => patch({ owner: v })}
                    />
                    <Field label="Needed by">
                      <input
                        type="date"
                        className={selectClass}
                        value={s.dueDate}
                        onChange={(e) => patch({ dueDate: e.target.value })}
                      />
                    </Field>
                    <Field
                      label="Method, units and coverage"
                      multiline
                      value={s.method}
                      onChange={(v) => patch({ method: v })}
                    />
                    <Field
                      label="Limitations and unresolved questions"
                      multiline
                      value={s.limitation}
                      onChange={(v) => patch({ limitation: v })}
                    />
                  </div>
                </section>
              );
            })}
            <button
              className={buttonClass}
              onClick={() =>
                set("evidence", [
                  ...doc.evidence,
                  {
                    id: crypto.randomUUID(),
                    title: "",
                    reference: "",
                    locator: "",
                    observedYear: null,
                    status: "missing",
                    method: "",
                    limitation: "",
                    owner: "",
                    dueDate: "",
                  },
                ])
              }
            >
              Add source or data gap
            </button>
          </>
        )}
        {tab === "Benefits and costs" && (
          <>
            <h2 className="text-xl font-semibold">
              Enter incremental quantities and costs
            </h2>
            <p className="text-sm">
              Use full project costs, not just the grant request. Annual
              quantities need an annualization factor of 1. Keep benefits from
              the same effect from appearing twice. For resilience, enter
              expected annual losses from a documented hazard analysis, not the
              full loss from a single event.
            </p>
            <BcaQuantityBuilder doc={doc} onChange={setDoc} />
            {doc.flows.map((flow) => (
              <BcaFlowEditor
                key={flow.id}
                flow={flow}
                doc={doc}
                onChange={(next) =>
                  set(
                    "flows",
                    doc.flows.map((f) => (f.id === flow.id ? next : f)),
                  )
                }
                onDocument={setDoc}
                onRemove={() =>
                  set(
                    "flows",
                    doc.flows.filter((f) => f.id !== flow.id),
                  )
                }
              />
            ))}
            <div className="flex flex-wrap gap-2">
              <button
                className={buttonClass}
                onClick={() =>
                  set("flows", [
                    ...doc.flows,
                    newBcaFlow(doc, "benefit", crypto.randomUUID()),
                  ])
                }
              >
                Add benefit stream
              </button>
              <button
                className={buttonClass}
                onClick={() =>
                  set("flows", [
                    ...doc.flows,
                    newBcaFlow(doc, "cost", crypto.randomUUID()),
                  ])
                }
              >
                Add cost stream
              </button>
            </div>
            <Field
              label="Benefits not monetized"
              multiline
              value={doc.qualitativeBenefits}
              onChange={(v) => set("qualitativeBenefits", v)}
            />
            <Field
              label="Excluded effects and costs, with reasons"
              multiline
              value={doc.exclusions}
              onChange={(v) => set("exclusions", v)}
            />
          </>
        )}
        {tab === "Results and review" && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(
                [
                  "benefitLowPct",
                  "benefitHighPct",
                  "costLowPct",
                  "costHighPct",
                  "alternateDiscountRatePct",
                ] as const
              ).map((k) => (
                <NumberField
                  key={k}
                  label={
                    {
                      benefitLowPct: "Lower benefits change (%)",
                      benefitHighPct: "Higher benefits change (%)",
                      costLowPct: "Lower costs change (%)",
                      costHighPct: "Higher costs change (%)",
                      alternateDiscountRatePct: "Alternative discount rate (%)",
                    }[k]
                  }
                  value={doc.sensitivity[k]}
                  onChange={(v) =>
                    set("sensitivity", { ...doc.sensitivity, [k]: v ?? 0 })
                  }
                />
              ))}
            </div>
            <Field
              label="Basis for sensitivity ranges"
              multiline
              value={doc.sensitivity.rationale}
              onChange={(v) =>
                set("sensitivity", { ...doc.sensitivity, rationale: v })
              }
            />
            <Field
              label="Analyst review notes and unresolved decisions"
              multiline
              value={doc.reviewNotes}
              onChange={(v) => set("reviewNotes", v)}
            />
            {parsed.success && <BcaResults doc={parsed.data} />}
          </>
        )}
      </fieldset>
      {tab === "Saved versions" && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Retained project versions</h2>
          <p className="text-sm">
            Each save retains its author and complete values. Loading a version
            creates a local draft; it never replaces the original. Results
            recompute with the current engine.
          </p>
          <button
            className={buttonClass}
            disabled={busy}
            onClick={() => void history()}
          >
            Refresh history
          </button>
          {versions.map((v) => (
            <div className="space-y-2 rounded border p-4" key={v.id}>
              <p className="font-medium">
                {new Date(v.created_at).toLocaleString("en-US")}
              </p>
              <p className="break-all text-xs">
                Author {v.created_by}; analysis SHA-256 {v.inputHash}
              </p>
              <button
                className={buttonClass}
                disabled={!!pending || busy}
                onClick={() => {
                  const p = bcaDocumentSchema.safeParse(v.document_json);
                  if (!p.success || p.data.projectId !== projectId) {
                    setNotice(
                      "This retained document is invalid or uses an unsupported schema. It was not loaded.",
                    );
                    return;
                  }
                  setDoc(p.data);
                  setTab(tabs[0]);
                  setNotice("Loaded a retained version as a local draft.");
                }}
              >
                Load this version
              </button>
            </div>
          ))}
          {!versions.length && !busy && (
            <p>
              No versions loaded. A failed read does not establish that no saved
              work exists.
            </p>
          )}
          {more && (
            <button
              className={buttonClass}
              disabled={busy}
              onClick={() => void history(true)}
            >
              Load older versions
            </button>
          )}
        </section>
      )}
      {confirmDialog}
    </section>
  );
}
