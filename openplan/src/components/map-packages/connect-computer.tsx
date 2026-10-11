"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Setup = { connectionId: string } & Record<string, unknown>;

/**
 * Connect the planner's own computer to one project so it can build map
 * packages. This is the same personal, revocable connection Planner Agent
 * uses: the browser creates it, the file goes to the planner, and the
 * connector on their computer runs with their own Claude Code sign-in.
 */
export function ConnectComputer({ workspaceId, projectId, onConnected }: {
  workspaceId: string;
  projectId: string;
  onConnected?: (connectionId: string) => void;
}) {
  const [label, setLabel] = useState("My computer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/assistant/providers/connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, projectId, label: label.trim(), provider: "claude", authMode: "claude_subscription" }),
      });
      const payload = (await response.json().catch(() => null)) as { setup?: Setup; error?: string } | null;
      if (!response.ok || !payload?.setup) throw new Error(payload?.error ?? "connection_failed");
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload.setup, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "openplan-connection.json";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSetup(payload.setup);
      onConnected?.(payload.setup.connectionId);
    } catch {
      setError("The connection could not be created. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (setup) {
    const folder = `~/.openplan-maps/${setup.connectionId.slice(0, 8)}`;
    return (
      <div className="space-y-2 text-sm">
        <p>The connection file downloaded. Keep it private. On that computer, from your OpenPlan folder:</p>
        <pre className="whitespace-pre-wrap break-all rounded border border-border bg-muted/40 p-3 text-xs leading-5">{[
          "cd workers/planner_agent_connector",
          `node connector.mjs configure --config ${folder}/connection.json --setup ~/Downloads/openplan-connection.json --binary "$(command -v claude)" --profile ~/.claude`,
          `node connector.mjs maps-check --config ${folder}/connection.json`,
          `node connector.mjs maps --config ${folder}/connection.json`,
        ].join("\n")}</pre>
        <p className="text-muted-foreground">Leave the last command running. Packages build one at a time.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 text-sm">
      <p>This needs Linux with Claude Code signed in to a Claude subscription, and QGIS 3.34 or later.</p>
      <label className="block">
        <span className="text-muted-foreground">Computer name</span>
        <Input value={label} maxLength={120} onChange={event => setLabel(event.target.value)} />
      </label>
      <Button type="button" variant="outline" disabled={busy || !label.trim()} onClick={() => void connect()}>
        {busy ? "Connecting…" : "Connect this computer"}
      </Button>
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    </div>
  );
}
