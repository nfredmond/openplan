import type { StatusTone } from "@/lib/ui/status";
import type { MapPackageState } from "./catalog";

const MAP_PACKAGE_STATE_LABELS: Record<MapPackageState, string> = {
  queued: "Waiting for your computer",
  running: "Building",
  uploading: "Uploading",
  ready: "Ready",
  failed: "Failed",
  cancelled: "Stopped",
  interrupted: "Interrupted",
};

const MAP_PACKAGE_STATE_TONES: Record<MapPackageState, StatusTone> = {
  queued: "info",
  running: "info",
  uploading: "info",
  ready: "success",
  failed: "danger",
  cancelled: "neutral",
  interrupted: "warning",
};

export function mapPackageStateLabel(state: string): string {
  return MAP_PACKAGE_STATE_LABELS[state as MapPackageState] ?? state;
}

export function mapPackageStateTone(state: string): StatusTone {
  return MAP_PACKAGE_STATE_TONES[state as MapPackageState] ?? "neutral";
}

const FAILURE_SENTENCES: Record<string, string> = {
  cancelled_by_user: "Someone stopped this package.",
  connection_revoked: "The computer connection was revoked, so the run stopped.",
  connection_removed: "The computer connection was removed, so the run stopped.",
  requester_removed: "The person who asked for this package left the workspace, so it stopped.",
  map_package_attempt_expired: "The computer stopped checking in for ten minutes, so the run was ended. The folder stays on that computer.",
  map_package_connector_restarted: "The connector restarted while the agent was working. The run was not started again; its folder stays on that computer.",
  map_package_connector_stopped: "The connector was stopped while the agent was working. Its folder stays on that computer.",
  map_package_agent_failed: "The agent stopped without finishing. Its folder and session log stay on that computer.",
  map_package_max_turns: "The agent reached its step limit before finishing. Its folder stays on that computer.",
  map_package_timeout: "The run passed twelve hours and was stopped. Its folder stays on that computer.",
  map_package_zip_missing: "The agent finished, but no package ZIP was found in its build folder.",
  map_package_other_model_used: "A model other than Claude Fable 5.1 took part, so the package was not accepted. It stays on that computer.",
  map_package_model_changed: "Claude Code started a different model, so the run was stopped.",
  map_package_api_key_billing: "Claude Code was set to bill an API key instead of the subscription, so the run was stopped.",
};

export function mapPackageFailureSentence(code: string | null): string {
  if (!code) return "The run ended without a reason on record.";
  return FAILURE_SENTENCES[code] ?? `The run ended (${code.replaceAll("_", " ")}).`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/** The ZIP name a browser upload is stored under: the file's own name, made safe. */
export function safeUploadFileName(name: string): string {
  const base = name.replace(/\.zip$/i, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._-]+/, "").slice(0, 150);
  return `${base || "map_package"}.zip`;
}
