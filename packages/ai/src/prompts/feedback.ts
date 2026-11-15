import { z } from "zod";
import type { PromptDefinition } from "../llm/runner";

/**
 * Feedback writer and learning-plan explainer. Both receive only SUPPORTED, adjudicated
 * facts; their output is validated so it cannot introduce new quotes, findings, cases or
 * certainty that the assessment does not support. Deterministic text is used when the
 * model is unavailable or its output fails validation.
 */

export const FeedbackWriterInput = z.object({
  caseLabel: z.string(),
  ratingDisplay: z.string().nullable(),
  provisional: z.boolean(),
  withheldReason: z.string().nullable(),
  uncertaintyReasons: z.array(z.string()),
  strengths: z.array(z.object({ construct: z.string(), quote: z.string(), prompting: z.string().nullable() })),
  issues: z.array(z.object({ construct: z.string(), severity: z.string(), status: z.string(), whatHappened: z.string(), whyItMatters: z.string() })),
  technicalLimitations: z.array(z.string()),
});
export type FeedbackWriterInput = z.infer<typeof FeedbackWriterInput>;

export const FeedbackWriterOutput = z.object({ overallSummary: z.string() });
export type FeedbackWriterOutput = z.infer<typeof FeedbackWriterOutput>;

export const feedbackWriterPrompt: PromptDefinition<FeedbackWriterInput, FeedbackWriterOutput> = {
  id: "feedback_writer",
  version: "feedback_writer@2026-11-15.1",
  role: "feedback_writer",
  inputSchema: FeedbackWriterInput,
  schemaName: "feedback_summary",
  buildOutputSchema: () => FeedbackWriterOutput,
  defaults: { effort: "medium", maxTokens: 4000, timeoutMs: 60_000, maxAttempts: 2, maxSchemaRepairs: 1 },
  render: (input) => ({
    system: `You write the short overall assessment at the top of a radiology oral-exam debrief.

Write 2–4 plain sentences (at most 90 words) addressed to the learner ("you"):
- Use only the facts provided. Do not add findings, diagnoses, quotes, scores, percentages or pass/fail predictions.
- Name the most important strength and the most consequential issue.
- If the result is provisional or withheld, or there are uncertainty reasons or technical limitations, state that plainly. Never make an uncertain result sound decisive.
- Direct and respectful. No generic praise, no humiliation, no exclamation marks.`,
    user: JSON.stringify(input),
  }),
};

/** Validation that the writer stayed within the supplied facts. */
export function validateFeedbackSummary(text: string, input: FeedbackWriterInput): string[] {
  const problems: string[] = [];
  const words = text.trim().split(/\s+/).length;
  if (words > 110) problems.push("summary too long");
  if (/%|\bpercent\b/i.test(text)) problems.push("mentions percentages");
  if (/\b(you (will|would) (pass|fail)|pass(ed)? the (exam|board)|probability)\b/i.test(text)) problems.push("makes outcome predictions");
  const quoted = [...text.matchAll(/["“]([^"”]{4,})["”]/g)].map((m) => m[1]!.trim().toLowerCase());
  const allowed = input.strengths.map((s) => s.quote.toLowerCase());
  for (const q of quoted) if (!allowed.some((a) => a.includes(q))) problems.push(`unsupported quote: ${q.slice(0, 40)}`);
  if ((input.provisional || input.withheldReason || input.uncertaintyReasons.length > 0) && !/(provisional|uncertain|withheld|not (yet )?(able|possible)|could not|unclear|review)/i.test(text)) {
    problems.push("does not state the uncertainty");
  }
  if (/!/.test(text)) problems.push("exclamation mark");
  return problems;
}

export const LearningPlanExplainerInput = z.object({
  focusSkills: z.array(z.string()),
  skillSummaries: z.array(z.object({ skill: z.string(), statement: z.string(), observations: z.number() })),
  items: z.array(z.object({ title: z.string(), kind: z.string(), description: z.string() })),
});
export type LearningPlanExplainerInput = z.infer<typeof LearningPlanExplainerInput>;
export const LearningPlanExplainerOutput = z.object({ explanation: z.string() });

export const learningPlanPrompt: PromptDefinition<LearningPlanExplainerInput, z.infer<typeof LearningPlanExplainerOutput>> = {
  id: "learning_plan",
  version: "learning_plan@2026-11-15.1",
  role: "learning_plan",
  inputSchema: LearningPlanExplainerInput,
  schemaName: "learning_plan_explanation",
  buildOutputSchema: () => LearningPlanExplainerOutput,
  defaults: { effort: "low", maxTokens: 3000, timeoutMs: 45_000, maxAttempts: 2, maxSchemaRepairs: 1 },
  render: (input) => ({
    system: `Explain a learner's practice plan in at most 100 words. The plan items and skill statements were chosen by deterministic rules; do not add, remove or rename activities, do not mention specific diagnoses or cases, and do not predict exam outcomes. Treat a single weak attempt as a signal, not a stable trait.`,
    user: JSON.stringify(input),
  }),
};
