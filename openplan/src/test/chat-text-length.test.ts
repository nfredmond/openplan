import { describe, expect, it } from "vitest";
import { chatText } from "@/lib/assistant/chat-text-length";
import { chatDraftSchema } from "@/lib/assistant/provider-chat-task";

const emoji = "😀"; // one code point, two UTF-16 units

describe("chat text limits match the installed database's UTF-16 count", () => {
  it("counts each supplementary character as two units at the limit", () => {
    const question = chatText(1, 2000);
    expect(question.safeParse("a".repeat(2000)).success).toBe(true);
    expect(question.safeParse("a".repeat(2001)).success).toBe(false);
    expect(question.safeParse(emoji.repeat(1000)).success).toBe(true);
    // 1,001 code points pass Zod 4.6's own max(2000) but are 2,002 units to the database.
    expect(question.safeParse(emoji.repeat(1001)).success).toBe(false);
    expect(question.safeParse("").success).toBe(false);
  });

  it("trims before counting, as the database trims draft titles and notes", () => {
    const title = chatText(1, 160, { trim: true });
    expect(title.safeParse(`  ${emoji.repeat(80)}  `).success).toBe(true);
    expect(title.safeParse(emoji.repeat(81)).success).toBe(false);
    expect(title.safeParse("   ").success).toBe(false);
  });

  it("applies to the draft schema the approval path validates", () => {
    const draft = { projectId: "00000000-0000-4000-8000-000000000001", title: "Synthetic", submittalType: "other", notes: "" };
    expect(chatDraftSchema.safeParse(draft).success).toBe(true);
    expect(chatDraftSchema.safeParse({ ...draft, title: emoji.repeat(81) }).success).toBe(false);
    expect(chatDraftSchema.safeParse({ ...draft, notes: emoji.repeat(2000) }).success).toBe(true);
    expect(chatDraftSchema.safeParse({ ...draft, notes: emoji.repeat(2001) }).success).toBe(false);
  });
});
