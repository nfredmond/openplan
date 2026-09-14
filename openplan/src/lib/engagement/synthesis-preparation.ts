import { z } from "zod";
import type { SynthesisSourceSnapshot } from "./synthesis-sources";

const definitionSchema = z.object({
  categories: z.array(z.object({ id: z.string(), label: z.string() })),
  questions: z.array(z.object({ id: z.string(), category_id: z.string().nullable().optional() })),
});
type ContextState = "retained" | "uncategorized" | "definition_unavailable" | "question_unavailable" | "category_unavailable";
export type SynthesisSourceId = `item:${string}` | `answer:${string}`;
export type SynthesisPreparationGroup = {
  id: string;
  versionId: string | null;
  categoryId: string | null;
  questionId: string | null;
  questionType: string | null;
  label: string | null;
  context: ContextState;
  sourceIds: SynthesisSourceId[];
};

/** Prepare the complete verified private snapshot. This counts membership, not themes or sentiment. */
export function prepareSynthesisSource(snapshot: SynthesisSourceSnapshot, sourceSha256: string) {
  const definitions = new Map(snapshot.definitions.map(entry => {
    const definition = definitionSchema.parse(JSON.parse(entry.definitionText));
    return [entry.id, {
      categories: new Map(definition.categories.map(category => [category.id, category])),
      questions: new Map(definition.questions.map(question => [question.id, question])),
    }];
  }));
  const sessions = new Map(snapshot.sessions.map(session => [session.id, session]));
  const answeredSessions = new Set<string>();
  const sourceIds = new Set<SynthesisSourceId>();
  const categories = new Map<string, SynthesisPreparationGroup>();
  const questions = new Map<string, SynthesisPreparationGroup>();
  let comments = 0, replies = 0;

  function include(sourceId: SynthesisSourceId) {
    if (sourceIds.has(sourceId)) throw new Error("Duplicate preparation source membership");
    sourceIds.add(sourceId);
  }
  function category(versionId: string | null, categoryId: string | null, questionMissing = false) {
    const definition = versionId ? definitions.get(versionId) : undefined;
    const retainedCategory = categoryId ? definition?.categories.get(categoryId) : undefined;
    const context: ContextState = !definition ? "definition_unavailable" : questionMissing ? "question_unavailable"
      : !categoryId ? "uncategorized" : !retainedCategory ? "category_unavailable" : "retained";
    return { versionId, categoryId, questionId: null, questionType: null, label: retainedCategory?.label ?? null, context };
  }
  function add(groups: Map<string, SynthesisPreparationGroup>, metadata: Omit<SynthesisPreparationGroup, "id" | "sourceIds">, sourceId: SynthesisSourceId) {
    const id = JSON.stringify([metadata.versionId, metadata.categoryId, metadata.questionId, metadata.questionType, metadata.label, metadata.context]);
    const group = groups.get(id) ?? { ...metadata, id, sourceIds: [] };
    group.sourceIds.push(sourceId);
    groups.set(id, group);
  }
  for (const item of snapshot.items) {
    const sourceId: SynthesisSourceId = `item:${item.id}`;
    include(sourceId);
    if (item.parent_item_id) replies++; else comments++;
    add(categories, category(item.configuration_version_id, item.category_id), sourceId);
  }
  for (const answer of snapshot.answers) {
    const sourceId: SynthesisSourceId = `answer:${answer.id}`;
    include(sourceId);
    const session = sessions.get(answer.session_id);
    if (!session) throw new Error("Preparation answer session is missing");
    answeredSessions.add(session.id);
    const versionId = session.configuration_version_id;
    const definition = versionId ? definitions.get(versionId) : undefined;
    const question = answer.question_id ? definition?.questions.get(answer.question_id) : undefined;
    add(categories, category(versionId, question?.category_id ?? null, !question), sourceId);
    add(questions, {
      versionId, categoryId: question?.category_id ?? null, questionId: answer.question_id,
      questionType: answer.question_type, label: answer.question_prompt_snapshot,
      context: !definition ? "definition_unavailable" : !question ? "question_unavailable" : "retained",
    }, sourceId);
  }
  if (snapshot.counts.items !== comments + replies || snapshot.counts.answers !== snapshot.answers.length
    || snapshot.counts.sessions !== sessions.size) throw new Error("Preparation source counts differ");
  const sorted = (groups: Map<string, SynthesisPreparationGroup>) => [...groups.values()]
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map(group => ({ ...group, sourceIds: group.sourceIds.sort() }));
  return {
    algorithmVersion: 1 as const,
    source: { requestId: snapshot.requestId, campaignId: snapshot.campaignId, workspaceId: snapshot.workspaceId, sha256: sourceSha256 },
    interpretation: "not_assessed" as const,
    counts: { comments, replies, answers: snapshot.answers.length, contributions: sourceIds.size,
      sessions: sessions.size, sessionsWithoutSelectedAnswers: sessions.size - answeredSessions.size },
    categoryGroups: sorted(categories), questionGroups: sorted(questions),
  };
}
