import { adjudicatorPrompt, assessorPrompt, extractorPrompt } from "./assessment";
import { caseAuthorPrompt, clinicalCriticPrompt, rubricCriticPrompt } from "./authoring";
import { examinerPrompt } from "./examiner";
import { feedbackWriterPrompt, learningPlanPrompt } from "./feedback";

/**
 * Prompt registry (spec §15). Each entry versions its input schema, output schema, model
 * defaults and template together. Every model call records promptId + promptVersion.
 */
export const PROMPTS = {
  case_author: caseAuthorPrompt,
  clinical_critic: clinicalCriticPrompt,
  rubric_critic: rubricCriticPrompt,
  live_examiner: examinerPrompt,
  evidence_extractor: extractorPrompt,
  assessor_a: assessorPrompt("assessor_a"),
  assessor_b: assessorPrompt("assessor_b"),
  adjudicator: adjudicatorPrompt,
  feedback_writer: feedbackWriterPrompt,
  learning_plan: learningPlanPrompt,
} as const;

export function promptVersions(): Record<string, string> {
  return Object.fromEntries(Object.entries(PROMPTS).map(([k, v]) => [k, v.version]));
}
