import type { PromptClass } from "@sim/contracts";

/**
 * Approved neutral examiner phrase bank (owner-approvable, versioned). In exam mode the
 * examiner may only speak approved case questions, approved fact replies, reveal
 * announcements, and these phrases. None contain praise, hints or clinical content.
 */
export const NEUTRAL_PHRASE_BANK_VERSION = "neutral-phrases@2026-11-15.1";

export type NeutralPhraseId =
  | "n_opening_generic"
  | "n_take_your_time"
  | "n_anything_further"
  | "n_please_continue"
  | "n_clarify_repeat"
  | "n_clarify_side"
  | "n_clarify_term"
  | "n_unavailable_generic"
  | "n_next_case"
  | "n_case_concluded"
  | "n_time_up_case"
  | "n_time_up_station"
  | "n_station_complete"
  | "n_new_images"
  | "n_technical_image"
  | "n_technical_resume"
  | "n_practice_paused"
  | "n_practice_resumed";

export type NeutralPhrase = {
  id: NeutralPhraseId;
  purpose: string;
  text: string;
  promptClass: PromptClass;
  /** Whether the live examiner model may select it (others are controller-only). */
  selectableByModel: boolean;
  modes: ReadonlyArray<"exam" | "practice" | "owner_preview">;
};

const ALL = ["exam", "practice", "owner_preview"] as const;
const PRACTICE = ["practice", "owner_preview"] as const;

export const NEUTRAL_PHRASES: readonly NeutralPhrase[] = [
  { id: "n_opening_generic", purpose: "Generic opening invitation if a case has no opening question", text: "Please take a look at the images and tell me what you see.", promptClass: "neutral", selectableByModel: false, modes: ALL },
  { id: "n_take_your_time", purpose: "Candidate is pausing to think", text: "Take your time.", promptClass: "neutral", selectableByModel: true, modes: ALL },
  { id: "n_anything_further", purpose: "Candidate appears to have finished; invite any additions", text: "Is there anything further you would like to add?", promptClass: "neutral", selectableByModel: true, modes: ALL },
  { id: "n_please_continue", purpose: "Candidate stopped mid-thought", text: "Please continue.", promptClass: "neutral", selectableByModel: true, modes: ALL },
  { id: "n_clarify_repeat", purpose: "Speech was unclear; ask to repeat the last point", text: "Sorry, could you repeat that last point?", promptClass: "neutral", selectableByModel: true, modes: ALL },
  { id: "n_clarify_side", purpose: "Laterality was ambiguous or inaudible", text: "Could you clarify which side you are referring to?", promptClass: "neutral", selectableByModel: true, modes: ALL },
  { id: "n_clarify_term", purpose: "A term was unclear or inaudible", text: "Could you clarify the term you just used?", promptClass: "neutral", selectableByModel: true, modes: ALL },
  { id: "n_unavailable_generic", purpose: "Requested information has no approved reply", text: "That information isn't available for this case.", promptClass: "neutral", selectableByModel: true, modes: ALL },
  { id: "n_next_case", purpose: "Close the case and move to the next one", text: "Thank you. Let's move on to the next case.", promptClass: "neutral", selectableByModel: false, modes: ALL },
  { id: "n_case_concluded", purpose: "Close the final case", text: "Thank you. That concludes this case.", promptClass: "neutral", selectableByModel: false, modes: ALL },
  { id: "n_time_up_case", purpose: "Case time guidance exceeded", text: "Thank you, we need to move on now.", promptClass: "neutral", selectableByModel: false, modes: ALL },
  { id: "n_time_up_station", purpose: "Station time expired", text: "Thank you. That is the end of the examination.", promptClass: "neutral", selectableByModel: false, modes: ALL },
  { id: "n_station_complete", purpose: "All cases completed", text: "Thank you. That completes this session.", promptClass: "neutral", selectableByModel: false, modes: ALL },
  { id: "n_new_images", purpose: "Default announcement when new images are shown", text: "Here are some additional images.", promptClass: "neutral", selectableByModel: false, modes: ALL },
  { id: "n_technical_image", purpose: "An image failed to display", text: "I'm sorry, we are having trouble displaying that image.", promptClass: "neutral", selectableByModel: false, modes: ALL },
  { id: "n_technical_resume", purpose: "Resuming after a technical pause", text: "Thank you for waiting. Let's continue.", promptClass: "neutral", selectableByModel: false, modes: ALL },
  { id: "n_practice_paused", purpose: "Practice pause", text: "We'll pause here. Resume whenever you're ready.", promptClass: "neutral", selectableByModel: false, modes: PRACTICE },
  { id: "n_practice_resumed", purpose: "Practice resume", text: "Let's continue.", promptClass: "neutral", selectableByModel: false, modes: PRACTICE },
];

export function neutralPhrase(id: NeutralPhraseId): NeutralPhrase {
  const p = NEUTRAL_PHRASES.find((x) => x.id === id);
  if (!p) throw new Error(`unknown neutral phrase ${id}`);
  return p;
}

/** Words that must never appear in examiner speech during exam mode (praise/feedback). */
export const EXAM_MODE_FORBIDDEN_WORDS = ["good", "great", "excellent", "correct", "right answer", "well done", "wrong", "incorrect", "perfect"];
