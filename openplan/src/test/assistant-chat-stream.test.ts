import { describe, expect, it } from "vitest";

import {
  consumeAssistantChatStream,
  describeAssistantChatToolActivity,
  type ChatStreamEvent,
} from "@/lib/assistant/chat-stream";

function encodeChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function sseFrames(parts: Array<Record<string, unknown> | "[DONE]">): string {
  return parts.map((part) => (part === "[DONE]" ? "data: [DONE]\n\n" : `data: ${JSON.stringify(part)}\n\n`)).join("");
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const event of consumeAssistantChatStream(stream)) {
    events.push(event);
  }
  return events;
}

describe("consumeAssistantChatStream", () => {
  it("reduces a plain text reply to text-delta events plus finish", async () => {
    const body = encodeChunks([
      sseFrames([
        { type: "start" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Hello " },
        { type: "text-delta", id: "t1", delta: "planner." },
        { type: "text-end", id: "t1" },
        { type: "finish" },
        "[DONE]",
      ]),
    ]);

    const events = await collect(body);

    expect(events).toEqual([
      { type: "text-delta", text: "Hello " },
      { type: "text-delta", text: "planner." },
      { type: "finish", metadata: undefined },
    ]);
  });

  it("tracks tool calls: start once per id, result with the resolved tool name", async () => {
    const body = encodeChunks([
      sseFrames([
        { type: "start" },
        { type: "tool-input-start", toolCallId: "call-1", toolName: "list_funding_opportunities" },
        { type: "tool-input-available", toolCallId: "call-1", toolName: "list_funding_opportunities", input: {} },
        {
          type: "tool-output-available",
          toolCallId: "call-1",
          output: { status: "ok", opportunityCount: 3, opportunities: [] },
        },
        { type: "finish" },
        "[DONE]",
      ]),
    ]);

    const events = await collect(body);

    expect(events).toEqual([
      { type: "tool-start", toolCallId: "call-1", toolName: "list_funding_opportunities" },
      {
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "list_funding_opportunities",
        ok: true,
        output: { status: "ok", opportunityCount: 3, opportunities: [] },
      },
      { type: "finish", metadata: undefined },
    ]);
  });

  it("emits a proposal event when a tool output carries a proposed action", async () => {
    const proposal = {
      status: "proposed",
      kind: "create_funding_opportunity",
      payload: { kind: "create_funding_opportunity", title: "SS4A Implementation" },
      approval: "approval_required",
      description: "Creates a new funding opportunity record in this workspace.",
    };
    const body = encodeChunks([
      sseFrames([
        { type: "tool-input-start", toolCallId: "call-2", toolName: "propose_create_funding_opportunity" },
        { type: "tool-output-available", toolCallId: "call-2", output: proposal },
        { type: "finish" },
        "[DONE]",
      ]),
    ]);

    const events = await collect(body);

    expect(events[1]).toEqual({ type: "proposal", toolCallId: "call-2", proposal });
  });

  it("carries explicit error frames (the empty-body wart fix)", async () => {
    const body = encodeChunks([
      sseFrames([{ type: "start" }, { type: "error", errorText: "upstream model failed" }, "[DONE]"]),
    ]);

    const events = await collect(body);

    expect(events).toEqual([{ type: "error", errorText: "upstream model failed" }]);
  });

  it("marks tool-output-error results as failed", async () => {
    const body = encodeChunks([
      sseFrames([
        { type: "tool-input-start", toolCallId: "call-3", toolName: "list_projects" },
        { type: "tool-output-error", toolCallId: "call-3", errorText: "boom" },
        { type: "finish" },
        "[DONE]",
      ]),
    ]);

    const events = await collect(body);

    expect(events[1]).toEqual({
      type: "tool-result",
      toolCallId: "call-3",
      toolName: "list_projects",
      ok: false,
      errorText: "boom",
    });
  });

  it("reassembles a frame that is split across network chunks", async () => {
    const frame = `data: ${JSON.stringify({ type: "text-delta", id: "t1", delta: "split frame" })}\n\n`;
    const splitAt = Math.floor(frame.length / 2);
    const body = encodeChunks([frame.slice(0, splitAt), frame.slice(splitAt), sseFrames([{ type: "finish" }, "[DONE]"])]);

    const events = await collect(body);

    expect(events).toEqual([
      { type: "text-delta", text: "split frame" },
      { type: "finish", metadata: undefined },
    ]);
  });

  it("drops a dangling truncated frame at end-of-stream without throwing", async () => {
    const body = encodeChunks([
      sseFrames([{ type: "text-delta", id: "t1", delta: "kept" }]),
      'data: {"type":"text-delta","id":"t1","del', // truncated, never completed
    ]);

    const events = await collect(body);

    expect(events).toEqual([{ type: "text-delta", text: "kept" }]);
  });

  it("parses a final complete frame even when the stream ends without a blank line", async () => {
    const body = encodeChunks([
      sseFrames([{ type: "text-delta", id: "t1", delta: "body" }]),
      `data: ${JSON.stringify({ type: "finish" })}`,
    ]);

    const events = await collect(body);

    expect(events).toEqual([
      { type: "text-delta", text: "body" },
      { type: "finish", metadata: undefined },
    ]);
  });

  it("skips malformed frames instead of crashing the reply", async () => {
    const body = encodeChunks([
      "data: not-json-at-all\n\n",
      sseFrames([{ type: "text-delta", id: "t1", delta: "still fine" }, { type: "finish" }, "[DONE]"]),
    ]);

    const events = await collect(body);

    expect(events).toEqual([
      { type: "text-delta", text: "still fine" },
      { type: "finish", metadata: undefined },
    ]);
  });

  it("passes finish messageMetadata through", async () => {
    const body = encodeChunks([
      sseFrames([{ type: "finish", messageMetadata: { costWarning: { thresholdUsd: 0.5 } } }, "[DONE]"]),
    ]);

    const events = await collect(body);

    expect(events).toEqual([{ type: "finish", metadata: { costWarning: { thresholdUsd: 0.5 } } }]);
  });
});

describe("describeAssistantChatToolActivity", () => {
  it("labels lookups with counts", () => {
    expect(
      describeAssistantChatToolActivity("list_funding_opportunities", { status: "ok", opportunityCount: 3 })
    ).toBe("Looked up: 3 funding opportunities");
    expect(describeAssistantChatToolActivity("list_projects", { status: "ok", projectCount: 1 })).toBe(
      "Looked up: 1 project"
    );
    expect(describeAssistantChatToolActivity("search_knowledge_base", { status: "ok", excerptCount: 2 })).toBe(
      "Searched: 2 document excerpts"
    );
  });

  it("labels proposals and unknown tools sensibly", () => {
    expect(describeAssistantChatToolActivity("propose_create_funding_opportunity")).toBe(
      "Proposed: create funding opportunity"
    );
    expect(describeAssistantChatToolActivity("get_surface_context")).toBe("Read: another workspace surface");
    expect(describeAssistantChatToolActivity("some_future_tool")).toBe("some future tool");
  });
});
