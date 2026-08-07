"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  buildComponentPlan,
  deriveBbox,
  requestSizeProblems,
  type ConnectorInsert,
  type CorridorInsert,
  type UploadPlan,
  type ZoneInsert,
} from "@/app/(app)/models/_components/network-package-upload-plan";

/**
 * THE IN-APP WAY TO PUT A NETWORK INTO OPENPLAN.
 *
 * Six API routes — create a package, add a version, QA the nodes and links, and
 * create zones, corridors and connectors — shipped complete, authorized and
 * audited, and nothing in the product called any of them. The panel above this
 * form told a planner to drive them by hand: "Ingest is API-only for now."
 * That sentence was honest, and it was also the whole defect. A transportation
 * platform whose network basis can only be loaded with curl has no network
 * basis for anyone who does not write curl, which is nearly every planner this
 * product exists for.
 *
 * WHAT IT DOES, IN ORDER, AND WHY THE ORDER MATTERS.
 *
 *   1. POST /api/network-packages                     (only when creating one)
 *   2. POST /api/network-packages/{id}/versions
 *   3. POST .../versions/{versionId}/ingest           nodes + links, QA-checked
 *   4. POST .../zones        one request per feature
 *   5. POST .../corridors    one request per feature
 *   6. POST .../connectors   one request per feature, after zones exist
 *
 * Connectors come last because `network_connectors.zone_id` is a NOT NULL
 * foreign key to a uuid the database assigns; the only way to know it is to
 * have created the zone first and kept the row the API returned.
 *
 * EVERY FILE IS VALIDATED BEFORE THE FIRST REQUEST. See the plan module beside
 * this file: a value the database's CHECK constraints would reject stops the
 * upload while nothing has been written, instead of stranding a half-populated
 * version that nobody can tell apart from a complete one.
 *
 * WHEN SOMETHING FAILS PART-WAY, IT SAYS WHAT EXISTS. The steps below are a
 * live ledger, not a spinner. A planner whose corridors failed on request 412
 * is told the package name and version that were created and how many rows
 * landed, because the alternative — "upload failed" — leaves them guessing
 * whether to retry into a duplicate.
 *
 * WHAT IT DOES NOT CLAIM. Ingest does not store the network it validates. This
 * form repeats that where the file inputs are, rather than letting a passing QA
 * report imply the geometry was kept.
 */

export type NetworkPackageOption = {
  id: string;
  name: string;
};

type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

type Step = {
  key: string;
  label: string;
  status: StepStatus;
  detail?: string;
};

const NEW_PACKAGE = "__new__";

const STEP_TONE: Record<StepStatus, "neutral" | "info" | "success" | "warning" | "danger"> = {
  pending: "neutral",
  running: "info",
  done: "success",
  failed: "danger",
  skipped: "neutral",
};

type PostResult<T> = { ok: true; data: T } | { ok: false; message: string };

/**
 * One place where an HTTP answer becomes a sentence. A 413 carries the byte
 * ceiling the deployment actually enforces, so it is reported from the response
 * rather than from a copy of the constant that could drift away from the route.
 */
async function post<T>(url: string, body: unknown): Promise<PostResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: "Could not reach OpenPlan. Nothing further was sent." };
  }

  const payload = (await response.json().catch(() => null)) as
    | (Record<string, unknown> & { error?: string; maxBytes?: number })
    | null;

  if (!response.ok) {
    if (response.status === 413 && typeof payload?.maxBytes === "number") {
      const megabytes = (payload.maxBytes / (1024 * 1024)).toFixed(1);
      return {
        ok: false,
        message: `The request was larger than this deployment accepts (${megabytes} MB per request). The form weighs every request before sending it, so reaching this means the ceiling is lower than the one it checked against — ask whoever operates this deployment what it is set to.`,
      };
    }
    return {
      ok: false,
      message: payload?.error ?? `The request failed with status ${response.status}.`,
    };
  }

  return { ok: true, data: (payload ?? {}) as T };
}

function readFile(file: File | null): Promise<string | null> {
  return file ? file.text() : Promise.resolve(null);
}

/**
 * The panel's counts are server-rendered, so they are stale the moment this
 * form finishes. `router.refresh()` is the usual answer and is deliberately NOT
 * used: it would make the whole panel — including the empty state that renders
 * before a workspace has any package — depend on an app-router context, which
 * is a dependency the panel does not otherwise have. The reload is offered as a
 * control instead, AFTER the step ledger has been read, because a page that
 * refreshes itself out from under a planner takes away the only record of what
 * an upload actually created.
 */
function reloadForUpdatedCounts() {
  if (typeof window !== "undefined") window.location.reload();
}

export function NetworkPackageUploadForm({
  workspaceId,
  packages,
  maxRequestBytes,
}: {
  workspaceId: string;
  packages: NetworkPackageOption[];
  /**
   * The body ceiling the routes enforce, handed down from the server component
   * rather than imported here. `BODY_LIMITS` lives beside `NextResponse` in
   * `@/lib/http/body-limit`, and importing that module into a "use client" file
   * would pull `next/server` into the browser bundle. Passing the number keeps
   * ONE source of truth — the same constant the routes read — without the
   * client reaching for a server module, and without a copied literal here that
   * could drift away from the limit actually enforced.
   */
  maxRequestBytes: number;
}) {
  const [open, setOpen] = useState(false);
  const [packageChoice, setPackageChoice] = useState<string>(NEW_PACKAGE);
  const [packageName, setPackageName] = useState("");
  const [packageDescription, setPackageDescription] = useState("");
  const [regionCode, setRegionCode] = useState("");
  const [versionName, setVersionName] = useState("");
  const [crs, setCrs] = useState("");

  const [nodesFile, setNodesFile] = useState<File | null>(null);
  const [linksFile, setLinksFile] = useState<File | null>(null);
  const [zonesFile, setZonesFile] = useState<File | null>(null);
  const [corridorsFile, setCorridorsFile] = useState<File | null>(null);
  const [connectorsFile, setConnectorsFile] = useState<File | null>(null);

  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [qaSummary, setQaSummary] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const creatingPackage = packageChoice === NEW_PACKAGE;

  function setStep(key: string, status: StepStatus, detail?: string) {
    setSteps((current) =>
      current.map((step) => (step.key === key ? { ...step, status, detail } : step))
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setProblems([]);
    setFailure(null);
    setQaSummary(null);
    setDone(false);

    if (creatingPackage && !packageName.trim()) {
      setProblems(["Name the package. It is how this network is identified everywhere else in OpenPlan."]);
      return;
    }
    if (!versionName.trim()) {
      setProblems(["Name the version. Every upload creates a new version so an earlier one stays readable."]);
      return;
    }
    if (!nodesFile || !linksFile) {
      setProblems([
        "Both a nodes file and a links file are required. Ingest QA fails a version that is missing either, so sending one alone only records a failure.",
      ]);
      return;
    }

    setBusy(true);

    try {
      const [nodesText, linksText, zonesText, corridorsText, connectorsText] = await Promise.all([
        readFile(nodesFile),
        readFile(linksFile),
        readFile(zonesFile),
        readFile(corridorsFile),
        readFile(connectorsFile),
      ]);

      let nodes: unknown;
      let links: unknown;
      try {
        nodes = JSON.parse(nodesText ?? "");
        links = JSON.parse(linksText ?? "");
      } catch {
        setProblems(["The nodes or links file is not valid JSON, so nothing was sent."]);
        setBusy(false);
        return;
      }

      /**
       * KEYED ON THE FILE, NOT ON ITS CONTENTS. An empty file reads as `""`,
       * and treating that as "no file was chosen" made the step ledger say
       * "No zones file." to a planner looking at the zones file they had just
       * attached. The file is passed through instead, and the parser reports
       * what is actually true of it.
       */
      const plan: UploadPlan = buildComponentPlan({
        zones: zonesFile ? { label: zonesFile.name, text: zonesText ?? "" } : null,
        corridors: corridorsFile ? { label: corridorsFile.name, text: corridorsText ?? "" } : null,
        connectors: connectorsFile ? { label: connectorsFile.name, text: connectorsText ?? "" } : null,
      });

      const ingestBody = { nodes, links, ...(crs.trim() ? { crs: crs.trim() } : {}) };

      // Every request this upload will make, weighed against the ceiling the
      // routes enforce, while nothing has been written.
      const oversize = requestSizeProblems(
        [
          { label: "The nodes and links QA request", body: ingestBody },
          ...plan.zones.map((zone, index) => ({ label: `Zone ${index + 1}`, body: zone })),
          ...plan.corridors.map((corridor) => ({
            label: `Corridor "${corridor.corridor_name}"`,
            body: corridor,
          })),
        ],
        maxRequestBytes
      );

      if (plan.problems.length > 0 || oversize.length > 0) {
        setProblems([...plan.problems, ...oversize]);
        setBusy(false);
        return;
      }

      const plannedSteps: Step[] = [
        {
          key: "package",
          label: creatingPackage ? "Create the package" : "Use the selected package",
          status: "pending",
        },
        { key: "version", label: `Create version "${versionName.trim()}"`, status: "pending" },
        { key: "ingest", label: "QA-check the nodes and links", status: "pending" },
        {
          key: "zones",
          label: `Create ${plan.zones.length.toLocaleString()} zone${plan.zones.length === 1 ? "" : "s"}`,
          status: plan.zones.length ? "pending" : "skipped",
          detail: plan.zones.length ? undefined : "No zones file.",
        },
        {
          key: "corridors",
          label: `Create ${plan.corridors.length.toLocaleString()} corridor${
            plan.corridors.length === 1 ? "" : "s"
          }`,
          status: plan.corridors.length ? "pending" : "skipped",
          detail: plan.corridors.length ? undefined : "No corridors file.",
        },
        {
          key: "connectors",
          label: `Create ${plan.connectors.length.toLocaleString()} connector${
            plan.connectors.length === 1 ? "" : "s"
          }`,
          status: plan.connectors.length ? "pending" : "skipped",
          detail: plan.connectors.length ? undefined : "No connectors file.",
        },
      ];
      setSteps(plannedSteps);

      // 1. The package.
      let packageId = packageChoice;
      if (creatingPackage) {
        setStep("package", "running");
        const created = await post<{ data?: { id?: string } }>("/api/network-packages", {
          workspace_id: workspaceId,
          name: packageName.trim(),
          description: packageDescription.trim() || null,
          region_code: regionCode.trim() || null,
          bbox: deriveBbox([nodes, links]),
        });
        if (!created.ok) {
          setStep("package", "failed", created.message);
          setFailure("Nothing was created.");
          return;
        }
        const newId = created.data?.data?.id;
        if (!newId) {
          setStep("package", "failed", "The package was created but its id was not returned, so the upload cannot continue.");
          setFailure("The package may exist. Reload this page before retrying so it can be selected instead of created again.");
          return;
        }
        packageId = newId;
        setStep("package", "done", `Package "${packageName.trim()}" created.`);
      } else {
        setStep("package", "done", packages.find((entry) => entry.id === packageId)?.name ?? "Selected package.");
      }

      // 2. The version.
      setStep("version", "running");
      const version = await post<{ data?: { id?: string } }>(
        `/api/network-packages/${packageId}/versions`,
        { version_name: versionName.trim(), status: "draft" }
      );
      if (!version.ok) {
        setStep("version", "failed", version.message);
        setFailure(
          creatingPackage
            ? `The package "${packageName.trim()}" was created and is now empty. Reload and select it rather than creating a second one.`
            : "No version was created, so the selected package is unchanged."
        );
        return;
      }
      const versionId = version.data?.data?.id;
      if (!versionId) {
        setStep("version", "failed", "The version was created but its id was not returned.");
        setFailure("Reload this page to see what exists before retrying.");
        return;
      }
      setStep("version", "done");

      const versionBase = `/api/network-packages/${packageId}/versions/${versionId}`;

      // 3. Ingest — QA only. The route validates and discards the geometry.
      setStep("ingest", "running");
      const ingest = await post<{ status?: string; qa_report?: { summary?: Record<string, unknown> }; message?: string }>(
        `${versionBase}/ingest`,
        ingestBody
      );
      if (!ingest.ok) {
        setStep("ingest", "failed", ingest.message);
        setFailure(
          `Version "${versionName.trim()}" exists but holds no QA report, and no zones, corridors or connectors were sent.`
        );
        return;
      }

      /**
       * THE VERDICT IS READ, NEVER ASSUMED. `status` decides whether real zone,
       * corridor and connector rows get attached to this version, so a response
       * that does not carry one of the three verdicts is a verdict that could
       * not be READ — which is a different fact from a network that passed, and
       * must not be treated as one. Defaulting it to "recorded" and carrying on
       * would load components onto a basis whose QA outcome nobody knows.
       */
      const qaStatus = ingest.data?.status;
      if (qaStatus !== "pass" && qaStatus !== "warn" && qaStatus !== "fail") {
        setStep("ingest", "failed", "The QA response did not state a pass, warn or fail verdict.");
        setFailure(
          `Version "${versionName.trim()}" exists and the QA check ran, but its verdict could not be read from the response, so no zones, corridors or connectors were sent. Open the version to read the QA report it recorded before uploading again.`
        );
        return;
      }

      // The counts are shown only when they are actually there. "0 passed, 0
      // warnings, 0 failures" invented from an absent summary reads as a real
      // QA result, and a planner has no way to tell it from one.
      const summary = ingest.data?.qa_report?.summary;
      const counted = (key: string): number | null => {
        const value = summary?.[key];
        return typeof value === "number" ? value : null;
      };
      const passed = counted("passed");
      const warnings = counted("warnings");
      const failures = counted("failures");
      const qaLine =
        passed !== null && warnings !== null && failures !== null
          ? `QA ${qaStatus} — ${passed} passed, ${warnings} warnings, ${failures} failures.`
          : `QA ${qaStatus} — the response carried no check counts, so none are shown.`;
      setQaSummary(`${qaLine} ${ingest.data?.message ?? ""}`.trim());
      setStep("ingest", qaStatus === "fail" ? "failed" : "done", qaLine);

      // A failing QA report is recorded on the version and the version is left
      // as a draft. Loading components onto a network the QA report says is
      // broken would attach real rows to a basis nobody should model against.
      if (qaStatus === "fail") {
        setFailure(
          "The network did not pass QA, so the version was left as a draft and no zones, corridors or connectors were created. Fix the issues named in the QA report and upload a new version."
        );
        return;
      }

      // 4. Zones, keeping the external id -> row id map connectors need.
      const zoneIdByExternalId = new Map<string, string>();
      if (plan.zones.length > 0) {
        setStep("zones", "running", `0 of ${plan.zones.length.toLocaleString()} created.`);
        for (let index = 0; index < plan.zones.length; index += 1) {
          const zone: ZoneInsert = plan.zones[index];
          const result = await post<{ id?: string; zone_id_external?: string | null }>(
            `${versionBase}/zones`,
            zone
          );
          if (!result.ok) {
            setStep("zones", "failed", `${index.toLocaleString()} created, then: ${result.message}`);
            setFailure(
              `Version "${versionName.trim()}" holds ${index.toLocaleString()} of ${plan.zones.length.toLocaleString()} zones. Corridors and connectors were not sent.`
            );
            return;
          }
          if (result.data?.id && zone.zone_id_external) {
            zoneIdByExternalId.set(zone.zone_id_external, result.data.id);
          }
          if ((index + 1) % 25 === 0 || index + 1 === plan.zones.length) {
            setStep(
              "zones",
              "running",
              `${(index + 1).toLocaleString()} of ${plan.zones.length.toLocaleString()} created.`
            );
          }
        }
        setStep("zones", "done", `${plan.zones.length.toLocaleString()} created.`);
      }

      // 5. Corridors.
      if (plan.corridors.length > 0) {
        setStep("corridors", "running", `0 of ${plan.corridors.length.toLocaleString()} created.`);
        for (let index = 0; index < plan.corridors.length; index += 1) {
          const corridor: CorridorInsert = plan.corridors[index];
          const result = await post<{ id?: string }>(`${versionBase}/corridors`, corridor);
          if (!result.ok) {
            setStep("corridors", "failed", `${index.toLocaleString()} created, then: ${result.message}`);
            setFailure(
              `Version "${versionName.trim()}" holds ${index.toLocaleString()} of ${plan.corridors.length.toLocaleString()} corridors. Connectors were not sent.`
            );
            return;
          }
          if ((index + 1) % 25 === 0 || index + 1 === plan.corridors.length) {
            setStep(
              "corridors",
              "running",
              `${(index + 1).toLocaleString()} of ${plan.corridors.length.toLocaleString()} created.`
            );
          }
        }
        setStep("corridors", "done", `${plan.corridors.length.toLocaleString()} created.`);
      }

      // 6. Connectors, resolved against the zones this upload just created.
      if (plan.connectors.length > 0) {
        setStep("connectors", "running", `0 of ${plan.connectors.length.toLocaleString()} created.`);
        for (let index = 0; index < plan.connectors.length; index += 1) {
          const connector: ConnectorInsert = plan.connectors[index];
          const zoneId = zoneIdByExternalId.get(connector.zoneExternalId);
          if (!zoneId) {
            setStep(
              "connectors",
              "failed",
              `${index.toLocaleString()} created, then zone "${connector.zoneExternalId}" could not be matched to a zone this upload created.`
            );
            setFailure(
              `Version "${versionName.trim()}" holds ${index.toLocaleString()} of ${plan.connectors.length.toLocaleString()} connectors.`
            );
            return;
          }
          const { zoneExternalId: _ignored, ...fields } = connector;
          const result = await post<{ id?: string }>(`${versionBase}/connectors`, {
            ...fields,
            zone_id: zoneId,
          });
          if (!result.ok) {
            setStep("connectors", "failed", `${index.toLocaleString()} created, then: ${result.message}`);
            setFailure(
              `Version "${versionName.trim()}" holds ${index.toLocaleString()} of ${plan.connectors.length.toLocaleString()} connectors.`
            );
            return;
          }
          if ((index + 1) % 25 === 0 || index + 1 === plan.connectors.length) {
            setStep(
              "connectors",
              "running",
              `${(index + 1).toLocaleString()} of ${plan.connectors.length.toLocaleString()} created.`
            );
          }
        }
        setStep("connectors", "done", `${plan.connectors.length.toLocaleString()} created.`);
      }

      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-5">
        <Button type="button" size="sm" onClick={() => setOpen(true)}>
          Upload a network package
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="mt-5 space-y-5 rounded-lg border border-border/70 bg-background/60 p-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Upload a network package</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Nodes and links are QA-checked and their geometry is not retained — the QA report and manifest are
          what the version keeps. The zones, corridors and connectors this workspace can model against are
          created from the optional files below, one record per feature.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Package</span>
          <select
            aria-label="Package"
            value={packageChoice}
            onChange={(event) => setPackageChoice(event.target.value)}
            className="mt-1 w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-sm"
          >
            <option value={NEW_PACKAGE}>Create a new package</option>
            {packages.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Version name</span>
          <span className="text-xs text-muted-foreground">
            Every upload creates a new version, so an earlier network stays readable.
          </span>
          <input
            aria-label="Version name"
            value={versionName}
            onChange={(event) => setVersionName(event.target.value)}
            placeholder="2026 base year"
            className="mt-1 w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-sm"
          />
        </label>

        {creatingPackage ? (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">Package name</span>
              <input
                aria-label="Package name"
                value={packageName}
                onChange={(event) => setPackageName(event.target.value)}
                placeholder="Regional highway and transit network"
                className="mt-1 w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-sm"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">Region code (optional)</span>
              <span className="text-xs text-muted-foreground">
                Your agency&apos;s own code for the area this network covers. OpenPlan stores it as you type it.
              </span>
              <input
                aria-label="Region code"
                value={regionCode}
                onChange={(event) => setRegionCode(event.target.value)}
                className="mt-1 w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-sm"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="font-medium text-foreground">Description (optional)</span>
              <textarea
                aria-label="Package description"
                value={packageDescription}
                onChange={(event) => setPackageDescription(event.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-sm"
              />
            </label>
          </>
        ) : null}

        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-foreground">Coordinate reference system (optional)</span>
          <span className="text-xs text-muted-foreground">
            Recorded on the version manifest exactly as you declare it. OpenPlan does not verify it and does
            not reproject the network.
          </span>
          <input
            aria-label="Coordinate reference system"
            value={crs}
            onChange={(event) => setCrs(event.target.value)}
            placeholder="EPSG:4326"
            className="mt-1 w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="text-sm font-medium text-foreground">Network files</legend>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Nodes GeoJSON</span>
          <span className="text-xs text-muted-foreground">
            Checked for features, geometry and duplicate ids. Not stored.
          </span>
          <input
            aria-label="Nodes GeoJSON"
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            onChange={(event) => setNodesFile(event.target.files?.[0] ?? null)}
            className="mt-1 text-sm file:me-3 file:rounded-md file:border file:border-border/70 file:bg-background file:px-3 file:py-1.5 file:text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Links GeoJSON</span>
          <span className="text-xs text-muted-foreground">
            Checked for geometry and for speed or capacity attributes. Not stored.
          </span>
          <input
            aria-label="Links GeoJSON"
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            onChange={(event) => setLinksFile(event.target.files?.[0] ?? null)}
            className="mt-1 text-sm file:me-3 file:rounded-md file:border file:border-border/70 file:bg-background file:px-3 file:py-1.5 file:text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Zones GeoJSON (optional)</span>
          <span className="text-xs text-muted-foreground">
            Every zone needs a <code>zone_id</code>, <code>taz</code> or <code>id</code> property.
            That is the value OpenPlan attaches trips to, so a file without one loads but connects to
            nothing.
          </span>
          <input
            aria-label="Zones GeoJSON"
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            onChange={(event) => setZonesFile(event.target.files?.[0] ?? null)}
            className="mt-1 text-sm file:me-3 file:rounded-md file:border file:border-border/70 file:bg-background file:px-3 file:py-1.5 file:text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Corridors GeoJSON (optional)</span>
          <span className="text-xs text-muted-foreground">
            Every corridor needs a <code>corridor_name</code> or <code>name</code> property, so it can
            be told apart from the others.
          </span>
          <input
            aria-label="Corridors GeoJSON"
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            onChange={(event) => setCorridorsFile(event.target.files?.[0] ?? null)}
            className="mt-1 text-sm file:me-3 file:rounded-md file:border file:border-border/70 file:bg-background file:px-3 file:py-1.5 file:text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-foreground">Connectors GeoJSON (optional)</span>
          <span className="text-xs text-muted-foreground">
            Stored. Each feature names the zone it attaches to, so a zones file must be uploaded with it.
          </span>
          <input
            aria-label="Connectors GeoJSON"
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            onChange={(event) => setConnectorsFile(event.target.files?.[0] ?? null)}
            className="mt-1 text-sm file:me-3 file:rounded-md file:border file:border-border/70 file:bg-background file:px-3 file:py-1.5 file:text-sm"
          />
        </label>
      </fieldset>

      {problems.length > 0 ? (
        <div role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-100">
          <p className="font-semibold">Nothing was sent. Fix these first:</p>
          <ul className="mt-1 list-disc space-y-1 ps-4">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {steps.length > 0 ? (
        <ol className="space-y-1.5 text-xs">
          {steps.map((step) => (
            <li key={step.key} className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={STEP_TONE[step.status]}>{step.status}</StatusBadge>
              <span className="font-medium text-foreground">{step.label}</span>
              {step.detail ? <span className="text-muted-foreground">{step.detail}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}

      {qaSummary ? <p className="text-xs text-muted-foreground">{qaSummary}</p> : null}

      {failure ? (
        <div role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-900 dark:text-red-100">
          {failure}
        </div>
      ) : null}

      {done ? (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-900 dark:text-emerald-100">
          <span>
            Upload complete. The counts above this form were read before it ran, so they still show the
            workspace as it was.
          </span>
          <Button type="button" size="xs" variant="outline" onClick={reloadForUpdatedCounts}>
            Reload the counts
          </Button>
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Uploading…" : "Upload network package"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
