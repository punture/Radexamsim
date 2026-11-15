import type { ResponsePattern } from "../types";

/**
 * Patterns for the fictional fixture fx-ring-lesion (differential-only truth: the displayed
 * images do not establish one histology). Pending owner approval.
 */
const C = (text: string) => ({ kind: "candidate" as const, text });
const Q = (questionId: string, interruptedAtChar?: number) => ({ kind: "question" as const, questionId, ...(interruptedAtChar !== undefined ? { interruptedAtChar } : {}) });
const caseId = "fx-ring-lesion";
const allDemonstrated = {
  "r-lesion": { status: ["demonstrated" as const] },
  "r-laterality": { status: ["demonstrated" as const] },
  "r-ddx": { status: ["demonstrated" as const] },
  "r-next": { status: ["demonstrated" as const] },
  "r-no-overcommit": { status: ["demonstrated" as const] },
};

export const RING_PATTERNS: ResponsePattern[] = [
  {
    id: "ring.strong.a",
    caseId,
    level: "strong",
    description: "Complete description, appropriate differential with stated uncertainty, reasoned next imaging.",
    tags: [],
    turns: [
      Q("q-open"),
      C("Axial post-contrast T1 and FLAIR images show a solitary ring-enhancing lesion in the right frontal lobe with surrounding vasogenic edema."),
      C("The differential includes high-grade glioma such as glioblastoma, a solitary metastasis, and abscess; lymphoma is less likely. These cannot be distinguished on these images alone."),
      Q("q-next"),
      C("Diffusion-weighted imaging would help most, since restricted diffusion in the cavity would favor abscess; perfusion imaging and MR spectroscopy can help separate high-grade glioma from metastasis."),
    ],
    expected: { elements: { ...allDemonstrated, "r-next": { status: ["demonstrated"], prompting: "standard_question" } }, global: ["strong", "exceptional"], unsafeCriteria: [], mustNotPass: false },
  },
  {
    id: "ring.satisfactory.a",
    caseId,
    level: "satisfactory",
    description: "Correct essentials reached through the standard questions.",
    tags: ["accepted_alternative"],
    turns: [
      Q("q-open"),
      C("There is a rim-enhancing mass in the right frontal lobe with edema around it."),
      Q("q-ddx"),
      C("Glioblastoma or metastasis. An abscess is also possible. It's hard to say which on these images."),
      Q("q-next"),
      C("I would want diffusion-weighted imaging."),
    ],
    expected: {
      elements: {
        ...allDemonstrated,
        "r-ddx": { status: ["demonstrated"], prompting: "standard_question" },
        "r-next": { status: ["demonstrated", "partially_demonstrated"], prompting: "standard_question" },
        "r-no-overcommit": { status: ["demonstrated", "partially_demonstrated"] },
      },
      global: ["meets_expected", "strong"],
      unsafeCriteria: [],
      mustNotPass: false,
    },
  },
  {
    id: "ring.borderline.a",
    caseId,
    level: "borderline",
    description: "Minimal description and an inadequate differential.",
    tags: [],
    turns: [
      Q("q-open"),
      C("There's an enhancing lesion in the right frontal area."),
      Q("q-ddx"),
      C("Probably a tumor."),
      Q("q-next"),
      C("Maybe advanced MRI."),
    ],
    expected: {
      elements: {
        "r-lesion": { status: ["partially_demonstrated", "demonstrated"] },
        "r-laterality": { status: ["demonstrated"] },
        "r-ddx": { status: ["partially_demonstrated", "not_demonstrated"] },
        "r-next": { status: ["demonstrated", "partially_demonstrated"] },
        "r-no-overcommit": { status: ["not_demonstrated", "partially_demonstrated"] },
      },
      global: ["below_expected"],
      unsafeCriteria: [],
      mustNotPass: true,
    },
  },
  {
    id: "ring.poor.a",
    caseId,
    level: "poor",
    description: "Wrong side, certain single histology, no further work-up.",
    tags: ["unsafe", "laterality"],
    turns: [
      Q("q-open"),
      C("There is a lesion on the left side of the brain."),
      Q("q-ddx"),
      C("This is definitely a glioblastoma. Nothing else fits."),
      Q("q-next"),
      C("No further imaging is needed; it should go straight to surgery."),
    ],
    expected: {
      elements: {
        "r-lesion": { status: ["partially_demonstrated", "not_demonstrated"] },
        "r-laterality": { status: ["incorrect"] },
        "r-ddx": { status: ["incorrect"] },
        "r-next": { status: ["incorrect"] },
        "r-no-overcommit": { status: ["incorrect"] },
      },
      global: ["unsafe"],
      unsafeCriteria: ["places the lesion in the left hemisphere", "commits to a single histological diagnosis as certain", "recommends no further workup"],
      mustNotPass: true,
    },
  },
  {
    id: "ring.uncertainty.a",
    caseId,
    level: "uncertainty",
    description: "A leading consideration with explicitly stated uncertainty (accepted alternative).",
    tags: ["accepted_alternative", "uncertainty"],
    turns: [
      Q("q-open"),
      C("There is a ring-enhancing lesion in the right frontal lobe with surrounding edema."),
      Q("q-ddx"),
      C("My leading consideration would be a high-grade glioma, though metastasis and abscess remain in the differential; the differential remains open without further imaging or tissue."),
      Q("q-next"),
      C("Perfusion imaging and diffusion-weighted imaging."),
    ],
    expected: { elements: allDemonstrated, global: ["meets_expected", "strong"], unsafeCriteria: [], mustNotPass: false },
  },
  {
    id: "ring.edge.interrupted",
    caseId,
    level: "edge_case",
    description: "The candidate barges in after 10 characters of the next-imaging question; it was not delivered, so the answer is spontaneous.",
    tags: ["tts_interrupted"],
    turns: [
      Q("q-open"),
      C("Solitary ring-enhancing lesion in the right frontal lobe with vasogenic edema. Differential: high-grade glioma, metastasis or abscess, which cannot be distinguished on these images."),
      Q("q-next", 10),
      C("Diffusion-weighted imaging would help most."),
    ],
    expected: {
      elements: { ...allDemonstrated, "r-next": { status: ["demonstrated"], prompting: "spontaneous" } },
      global: ["strong", "meets_expected"],
      unsafeCriteria: [],
      mustNotPass: false,
    },
  },
];
