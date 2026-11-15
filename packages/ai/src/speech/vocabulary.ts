/**
 * General neuroradiology vocabulary for ASR keyterm assistance (spec §9). It is a FIXED,
 * case-independent list: it must never be generated from, or extended with, the current
 * case's answer key, which would bias recognition toward the expected answer. The version
 * is recorded with every transcript.
 */
export const NEURO_VOCABULARY_VERSION = "neuro-vocab@2026-11-15.1";

export const NEURO_VOCABULARY: readonly string[] = [
  "hyperdense", "hypodense", "hypodensity", "hyperintense", "hypointense", "isointense", "FLAIR", "DWI", "ADC",
  "SWI", "susceptibility", "gadolinium", "enhancement", "ring-enhancing", "leptomeningeal", "pachymeningeal", "dural",
  "subdural", "epidural", "subarachnoid", "intraparenchymal", "intraventricular", "hydrocephalus", "herniation",
  "midline shift", "mass effect", "vasogenic", "cytotoxic", "infarct", "ischemia", "penumbra", "thrombectomy",
  "thrombolysis", "M1", "M2", "ICA", "basilar", "vertebral", "circle of Willis", "aneurysm", "arteriovenous",
  "dural venous sinus", "venous thrombosis", "glioma", "glioblastoma", "astrocytoma", "oligodendroglioma",
  "meningioma", "schwannoma", "metastasis", "lymphoma", "abscess", "encephalitis", "demyelination",
  "multiple sclerosis", "periventricular", "juxtacortical", "infratentorial", "supratentorial", "cerebellopontine",
  "pituitary", "sella", "suprasellar", "pineal", "corpus callosum", "basal ganglia", "thalamus", "insula",
  "cervical", "thoracic", "lumbar", "conus", "cauda equina", "myelopathy", "syrinx", "spondylodiscitis",
  "discitis", "osteomyelitis", "spinal stenosis", "foraminal", "intramedullary", "intradural", "extradural",
  "retropharyngeal", "parapharyngeal", "parotid", "submandibular", "cholesteatoma", "paraganglioma",
  "nasopharyngeal", "lymphadenopathy", "CT angiography", "CTA", "MRA", "perfusion", "spectroscopy",
];
