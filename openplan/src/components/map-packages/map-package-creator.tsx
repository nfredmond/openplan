"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GuidedFlow, GuidedFlowRow, useGuidedFlow, type GuidedFlowStep } from "@/components/ui/guided-flow";
import { ConnectComputer } from "@/components/map-packages/connect-computer";
import { MAP_PACKAGE_DELIVERABLE_LABELS, MAP_PACKAGE_DELIVERABLES, type MapPackageDeliverable } from "@/lib/map-packages/catalog";
import { safeUploadFileName } from "@/lib/map-packages/presentation";

export type MapPackageCreatorProject = { id: string; name: string };
export type MapPackageCreatorOpportunity = { id: string; title: string; projectId: string | null };
export type MapPackageCreatorConnection = { id: string; projectId: string; label: string; status: string };

type Values = {
  projectId: string;
  deliverable: MapPackageDeliverable;
  fundingOpportunityId: string;
  source: "agent" | "upload";
  connectionId: string;
  file: File | null;
  title: string;
  client: string;
  request: string;
  practice: boolean;
};

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : "request_failed");
  return payload ?? {};
}

const ERRORS: Record<string, string> = {
  map_package_runner_not_ready: "That computer connection cannot build map packages. Connect it as Claude Code.",
  map_package_connection_required: "Choose a computer connected to this project.",
  map_package_access_denied: "You cannot add map packages to this project.",
  map_package_file_too_large: "That file is larger than this deployment accepts.",
  map_package_file_missing: "The file did not finish uploading. Try again.",
};

/**
 * Start a map package: which project, what it is for, who makes it, and what
 * the agent should know. Claude Fable 5.1 builds it on the planner's own
 * computer, or the planner adds a package they already have.
 */
export function MapPackageCreator({ workspaceId, workspaceName, projects, opportunities, connections, initialProjectId, initialOpportunityId, startOpen }: {
  workspaceId: string;
  workspaceName: string;
  projects: MapPackageCreatorProject[];
  opportunities: MapPackageCreatorOpportunity[];
  connections: MapPackageCreatorConnection[];
  initialProjectId: string | null;
  initialOpportunityId: string | null;
  startOpen?: boolean;
}) {
  const router = useRouter();
  const [newConnections, setNewConnections] = useState<MapPackageCreatorConnection[]>([]);
  // Null until the planner opens or closes the setup panel. It must stay open
  // after "Connect this computer", which is when its commands appear.
  const [setupOpen, setSetupOpen] = useState<boolean | null>(null);
  const allConnections = useMemo(() => [...connections, ...newConnections], [connections, newConnections]);
  const startProject = projects.some(project => project.id === initialProjectId) ? initialProjectId! : projects[0]?.id ?? "";
  const startOpportunity = opportunities.some(item => item.id === initialOpportunityId) ? initialOpportunityId! : "";

  const steps = useMemo<GuidedFlowStep<Values>[]>(() => [
    {
      id: "project",
      title: "Which project are the maps for?",
      fields: [{ name: "projectId", label: "a project", required: true }],
      render: flow => (
        <GuidedFlowRow flow={flow} name="projectId" label="Project">
          <select className="module-select" {...flow.text("projectId")} onChange={event => flow.setValues({ projectId: event.target.value, connectionId: "", fundingOpportunityId: "" })}>
            {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </GuidedFlowRow>
      ),
    },
    {
      id: "purpose",
      title: "What are they for?",
      fields: [{ name: "deliverable", label: "what the maps are for", required: true }, { name: "fundingOpportunityId", label: "a grant application" }],
      render: flow => {
        const forProject = opportunities.filter(item => item.projectId === flow.values.projectId || item.id === flow.values.fundingOpportunityId);
        return (
          <>
            <GuidedFlowRow flow={flow} name="deliverable" label="Deliverable">
              <select className="module-select" {...flow.text("deliverable")}>
                {MAP_PACKAGE_DELIVERABLES.map(key => <option key={key} value={key}>{MAP_PACKAGE_DELIVERABLE_LABELS[key]}</option>)}
              </select>
            </GuidedFlowRow>
            <GuidedFlowRow flow={flow} name="fundingOpportunityId" label="Grant application (optional)">
              <select className="module-select" {...flow.text("fundingOpportunityId")} disabled={forProject.length === 0}>
                <option value="">{forProject.length ? "None" : "None for this project"}</option>
                {forProject.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </GuidedFlowRow>
          </>
        );
      },
    },
    {
      id: "maker",
      title: "Who makes the package?",
      fields: [{ name: "source", label: "who makes it", required: true }],
      render: flow => (
        <GuidedFlowRow flow={flow} name="source" label="Made by" hint={flow.values.source === "agent" ? "Claude Fable 5.1 runs the transportation GIS skill on your computer. It can take several hours." : undefined}>
          <select className="module-select" {...flow.text("source")}>
            <option value="agent">Claude Fable 5.1 on my computer</option>
            <option value="upload">I already have a package (ZIP)</option>
          </select>
        </GuidedFlowRow>
      ),
    },
    {
      id: "computer",
      title: "Which computer?",
      when: values => values.source === "agent",
      fields: [{ name: "connectionId", label: "a computer", required: true, requiredMessage: "Choose a connected computer, or connect this one." }],
      render: flow => {
        const forProject = allConnections.filter(item => item.projectId === flow.values.projectId);
        return (
          <>
            <GuidedFlowRow flow={flow} name="connectionId" label="Computer">
              <select className="module-select" {...flow.text("connectionId")} disabled={forProject.length === 0}>
                <option value="">{forProject.length ? "Choose a computer" : "No computer connected to this project"}</option>
                {forProject.map(item => <option key={item.id} value={item.id}>{item.label} · {item.status.replaceAll("_", " ")}</option>)}
              </select>
            </GuidedFlowRow>
            <details className="text-sm" open={setupOpen ?? forProject.length === 0} onToggle={event => setSetupOpen(event.currentTarget.open)}>
              <summary className="cursor-pointer font-medium">Connect a computer</summary>
              <div className="mt-2">
                <ConnectComputer workspaceId={workspaceId} projectId={flow.values.projectId} onConnected={id => {
                  setSetupOpen(true);
                  setNewConnections(current => [...current, { id, projectId: flow.values.projectId, label: "This computer", status: "awaiting_connector" }]);
                  flow.setValue("connectionId", id);
                }} />
              </div>
            </details>
          </>
        );
      },
    },
    {
      id: "file",
      title: "Which package?",
      when: values => values.source === "upload",
      fields: [{ name: "file", label: "a ZIP file", required: true }],
      render: flow => (
        <GuidedFlowRow flow={flow} name="file" label="Package ZIP">
          <input {...flow.fieldProps("file")} type="file" accept=".zip,application/zip" className="block text-sm"
            onChange={event => flow.setValue("file", event.target.files?.[0] ?? null)} />
        </GuidedFlowRow>
      ),
    },
    {
      id: "details",
      title: "Name it",
      fields: [{ name: "title", label: "a name", required: true }],
      check: values => (values.source === "agent" && !values.client.trim() ? { field: "client", message: "Say whose name goes on the maps." } : null),
      render: flow => (
        <>
          <GuidedFlowRow flow={flow} name="title" label="Name">
            <Input {...flow.text("title")} maxLength={200} />
          </GuidedFlowRow>
          {flow.values.source === "agent" ? (
            <>
              <GuidedFlowRow flow={flow} name="client" label="Whose name goes on the maps">
                <Input {...flow.text("client")} maxLength={200} />
              </GuidedFlowRow>
              <GuidedFlowRow flow={flow} name="request" label="Anything the agent should know (optional)">
                <Textarea {...flow.text("request")} maxLength={4000} placeholder="Figures you need, the program's map requirements, data to use." />
              </GuidedFlowRow>
              <label className="flex items-start gap-2 text-sm">
                <input {...flow.fieldProps("practice")} type="checkbox" checked={flow.values.practice} onChange={event => flow.setValue("practice", event.target.checked)} />
                Practice run (every map says so)
              </label>
            </>
          ) : null}
        </>
      ),
    },
  ], [allConnections, opportunities, projects, setupOpen, workspaceId]);

  const flow = useGuidedFlow<Values>({
    id: "make-map-package",
    title: "Make maps",
    submitLabel: "Start",
    initialValues: {
      projectId: startProject, deliverable: startOpportunity ? "grant_application" : "general", fundingOpportunityId: startOpportunity,
      source: "agent", connectionId: "", file: null,
      title: `${projects.find(project => project.id === startProject)?.name ?? "Project"} maps`.slice(0, 200),
      client: workspaceName.slice(0, 200), request: "", practice: false,
    },
    steps,
    onSubmit: async values => {
      const common = { requestId: crypto.randomUUID(), workspaceId, projectId: values.projectId, title: values.title.trim(),
        deliverable: values.deliverable, fundingOpportunityId: values.fundingOpportunityId || null };
      try {
        if (values.source === "agent") {
          const saved = await postJson("/api/map-packages", { ...common, source: "agent", connectionId: values.connectionId,
            client: values.client.trim(), request: values.request, practice: values.practice });
          router.push(`/maps/${(saved.package as { id: string }).id}`);
          return;
        }
        const file = values.file!;
        const saved = await postJson("/api/map-packages", { ...common, source: "upload", fileName: safeUploadFileName(file.name), bytes: file.size });
        const packageId = (saved.package as { id: string }).id;
        const put = await fetch((saved.upload as { url: string }).url, { method: "PUT", headers: { "content-type": "application/zip", "x-upsert": "false" }, body: file });
        if (!put.ok && put.status !== 400 && put.status !== 409) throw new Error("map_package_file_missing");
        await postJson(`/api/map-packages/${packageId}/upload`, { action: "complete" });
        router.push(`/maps/${packageId}`);
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        return ERRORS[code] ?? "The package could not be started. Try again.";
      }
    },
  });

  // Opened from a project or a grant application: go straight to the questions, once.
  const opened = useRef(false);
  const { open } = flow;
  useEffect(() => {
    if (startOpen && !opened.current && projects.length > 0) { opened.current = true; open(); }
  }, [open, projects.length, startOpen]);

  if (projects.length === 0) return null;
  return (
    <>
      <Button type="button" onClick={flow.open}>Make maps</Button>
      <GuidedFlow flow={flow} />
    </>
  );
}
