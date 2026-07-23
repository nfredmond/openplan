import { describe, expect, it } from "vitest";
import {
  ASSISTANT_CHAT_MAX_KB_EXCERPTS,
  buildAssistantChatSystemPrompt,
  renderKnowledgeBaseExcerptLines,
} from "@/lib/assistant/chat-context";
import type { AssistantContext } from "@/lib/assistant/context";
import type { KnowledgeBaseExcerpt } from "@/lib/knowledge-base/retrieval";

// The "run" context kind is the simplest to construct (no operations summary).
const RUN_CONTEXT = {
  kind: "run",
  workspace: { id: "ws-1", name: "Test Workspace" },
  run: { title: "Corridor Run", createdAt: "2026-01-01", metrics: {}, summary: null, queryText: null },
  baselineRun: null,
} as unknown as AssistantContext;

function excerpt(over: Partial<KnowledgeBaseExcerpt> = {}): KnowledgeBaseExcerpt {
  return {
    chunkId: "c",
    documentId: "d",
    documentTitle: "Nevada County 2045 RTP",
    docKind: "rtp",
    pageFrom: 12,
    pageTo: 12,
    chunkIndex: 0,
    snippet: "Pedestrian safety is the top corridor priority.",
    rank: 0.5,
    ...over,
  };
}

describe("renderKnowledgeBaseExcerptLines", () => {
  it("renders title, page, and snippet", () => {
    const [line] = renderKnowledgeBaseExcerptLines([excerpt()]);
    expect(line).toBe('- "Nevada County 2045 RTP" (p. 12): Pedestrian safety is the top corridor priority.');
  });

  it("caps the number of excerpts", () => {
    const many = Array.from({ length: 9 }, (_, i) => excerpt({ documentTitle: `Doc ${i}` }));
    expect(renderKnowledgeBaseExcerptLines(many)).toHaveLength(ASSISTANT_CHAT_MAX_KB_EXCERPTS);
  });
});

describe("buildAssistantChatSystemPrompt KB integration", () => {
  it("always carries the uploaded-document honesty instruction", () => {
    const prompt = buildAssistantChatSystemPrompt(RUN_CONTEXT);
    expect(prompt).toContain("attribute each to its document by title");
    expect(prompt).toContain("not independently verified");
  });

  it("appends a KB excerpts section when excerpts are provided", () => {
    const prompt = buildAssistantChatSystemPrompt(RUN_CONTEXT, { knowledgeBaseExcerpts: [excerpt()] });
    // The section header is distinct from the instruction line, which also
    // mentions "KNOWLEDGE BASE EXCERPTS".
    expect(prompt).toContain("KNOWLEDGE BASE EXCERPTS (uploaded documents");
    expect(prompt).toContain("Nevada County 2045 RTP");
    expect(prompt).toContain("Pedestrian safety is the top corridor priority.");
  });

  it("omits the KB section when there are no excerpts", () => {
    const prompt = buildAssistantChatSystemPrompt(RUN_CONTEXT, { knowledgeBaseExcerpts: [] });
    expect(prompt).not.toContain("KNOWLEDGE BASE EXCERPTS (uploaded documents");
  });
});
