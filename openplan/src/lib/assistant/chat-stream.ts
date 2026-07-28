import type { AssistantChatProposal } from "@/lib/assistant/chat-tools";

/**
 * Pure client-side parser for the Planner Agent chat stream.
 *
 * The chat route streams the AI SDK UI-message protocol: SSE frames of
 * `data: {json}` terminated by `data: [DONE]`. This module reduces those
 * frames to a small, UI-shaped event union so the copilot never touches the
 * wire format directly. It is deliberately DOM-free and network-free — it
 * consumes any ReadableStream<Uint8Array> — so it unit-tests without a
 * browser.
 *
 * The protocol carries an explicit `error` frame. That is what fixes the old
 * plain-text-stream wart where an upstream model failure before the first
 * token ended the stream as an empty body with no explanation.
 */

export type ChatStreamEvent =
  | { type: "text-delta"; text: string }
  | { type: "tool-start"; toolCallId: string; toolName: string }
  | {
      type: "tool-result";
      toolCallId: string;
      toolName: string | null;
      ok: boolean;
      output?: unknown;
      errorText?: string;
    }
  | { type: "proposal"; toolCallId: string; proposal: AssistantChatProposal }
  | { type: "error"; errorText: string }
  | { type: "finish"; metadata?: unknown };

/**
 * Structural check for a proposal payload riding a tool result. Kept local
 * (rather than importing the server-side guard) so the client bundle never
 * pulls the tools module, which reaches into server-only code.
 */
function isProposalOutput(value: unknown): value is AssistantChatProposal {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.status === "proposed" &&
    typeof candidate.kind === "string" &&
    typeof candidate.description === "string" &&
    Boolean(candidate.payload) &&
    typeof candidate.payload === "object"
  );
}

type UiChunkLike = {
  type?: unknown;
  id?: unknown;
  delta?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  input?: unknown;
  output?: unknown;
  errorText?: unknown;
  messageMetadata?: unknown;
};

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Extract the JSON payloads from one SSE frame (the text between two blank
 * lines). Returns the parsed chunks; `[DONE]` yields a `done: true` marker.
 */
function parseSseFrame(frame: string): { done: boolean; chunks: UiChunkLike[] } {
  const chunks: UiChunkLike[] = [];
  for (const rawLine of frame.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice("data:".length).trim();
    if (payload === "[DONE]") {
      return { done: true, chunks };
    }
    try {
      const parsed = JSON.parse(payload) as UiChunkLike;
      if (parsed && typeof parsed === "object") chunks.push(parsed);
    } catch {
      // A malformed frame is dropped rather than crashing the stream —
      // the reducer stays permissive so one bad frame cannot kill a reply.
    }
  }
  return { done: false, chunks };
}

/**
 * Consume a Planner Agent chat response body as an async iterable of
 * {@link ChatStreamEvent}. Frames split across network chunks are
 * reassembled; a dangling partial frame at end-of-stream is dropped.
 */
export async function* consumeAssistantChatStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<ChatStreamEvent, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const toolNamesById = new Map<string, string>();
  const startedToolCallIds = new Set<string>();
  let buffer = "";

  function* reduce(chunk: UiChunkLike): Generator<ChatStreamEvent> {
    switch (chunk.type) {
      case "text-delta": {
        const text = asString(chunk.delta);
        if (text) yield { type: "text-delta", text };
        return;
      }
      case "tool-input-start":
      case "tool-input-available": {
        const toolCallId = asString(chunk.toolCallId);
        const toolName = asString(chunk.toolName);
        if (!toolCallId || !toolName) return;
        toolNamesById.set(toolCallId, toolName);
        if (!startedToolCallIds.has(toolCallId)) {
          startedToolCallIds.add(toolCallId);
          yield { type: "tool-start", toolCallId, toolName };
        }
        return;
      }
      case "tool-output-available": {
        const toolCallId = asString(chunk.toolCallId) ?? "";
        const toolName = toolNamesById.get(toolCallId) ?? null;
        if (isProposalOutput(chunk.output)) {
          yield { type: "proposal", toolCallId, proposal: chunk.output };
          return;
        }
        const status =
          chunk.output && typeof chunk.output === "object"
            ? (chunk.output as Record<string, unknown>).status
            : undefined;
        yield {
          type: "tool-result",
          toolCallId,
          toolName,
          ok: status !== "error",
          output: chunk.output,
        };
        return;
      }
      case "tool-input-error":
      case "tool-output-error": {
        const toolCallId = asString(chunk.toolCallId) ?? "";
        yield {
          type: "tool-result",
          toolCallId,
          toolName: toolNamesById.get(toolCallId) ?? asString(chunk.toolName),
          ok: false,
          errorText: asString(chunk.errorText) ?? "Tool call failed.",
        };
        return;
      }
      case "error": {
        yield { type: "error", errorText: asString(chunk.errorText) ?? "The Planner Agent stream reported an error." };
        return;
      }
      case "finish": {
        yield { type: "finish", metadata: chunk.messageMetadata };
        return;
      }
      default:
        return;
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const { done: sawDone, chunks } = parseSseFrame(frame);
        for (const chunk of chunks) {
          yield* reduce(chunk);
        }
        if (sawDone) return;
        boundary = buffer.indexOf("\n\n");
      }
    }

    // End of stream: flush any decoder tail, then parse a final complete
    // frame if one arrived without a trailing blank line. A partial frame
    // that never completed is dropped — never thrown.
    buffer += decoder.decode();
    if (buffer.trim()) {
      const { chunks } = parseSseFrame(buffer);
      for (const chunk of chunks) {
        yield* reduce(chunk);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

const TOOL_ACTIVITY_COUNT_FIELDS = [
  "excerptCount",
  "projectCount",
  "opportunityCount",
  "reportCount",
  "operationCount",
  "programCount",
] as const;

const TOOL_ACTIVITY_LABELS: Record<string, { noun: string; verb?: string; fixed?: string }> = {
  search_knowledge_base: { noun: "document excerpt", verb: "Searched" },
  get_surface_context: { noun: "surface", fixed: "Read: another workspace surface" },
  list_projects: { noun: "project" },
  list_funding_opportunities: { noun: "funding opportunity" },
  list_reports: { noun: "report" },
  list_pending_operations: { noun: "pending operation" },
  get_grant_program_catalog: { noun: "grant program" },
};

function pluralize(noun: string, count: number): string {
  if (count === 1) return noun;
  if (noun.endsWith("y")) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}

/**
 * Compact chip label for a completed tool call, e.g.
 * "Looked up: 3 funding opportunities" or "Proposed: create funding opportunity".
 */
export function describeAssistantChatToolActivity(toolName: string, output?: unknown): string {
  if (toolName.startsWith("propose_")) {
    return `Proposed: ${toolName.slice("propose_".length).replace(/_/g, " ")}`;
  }

  const label = TOOL_ACTIVITY_LABELS[toolName];
  if (!label) {
    return toolName.replace(/_/g, " ");
  }
  if (label.fixed) {
    return label.fixed;
  }

  let count: number | null = null;
  if (output && typeof output === "object") {
    for (const field of TOOL_ACTIVITY_COUNT_FIELDS) {
      const value = (output as Record<string, unknown>)[field];
      if (typeof value === "number") {
        count = value;
        break;
      }
    }
  }

  const verb = label.verb ?? "Looked up";
  if (count === null) {
    return `${verb}: ${pluralize(label.noun, 2)}`;
  }
  return `${verb}: ${count} ${pluralize(label.noun, count)}`;
}
