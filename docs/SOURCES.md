# Source registry

Facts that affect product behaviour or public claims are tracked with their source, access date, applicable cohort or version, and verification strength. All research was done on **2026-11-15** from a build environment whose network allowlist blocked most official sites. Nothing in this registry was confirmed against a live official page.

| Registry | Covers | Verification method and limits |
|---|---|---|
| [sources/board_sources.md](sources/board_sources.md) | ABR DR oral exam (format, cohort, 68–72 scale, pass rule, images, scope); RCPSC DR applied exam (station table, format, GRS approach); unresolved conflicts; `sourceRegistry` entries referenced by the profiles | Search-engine snippets restricted to official domains; S2/S1/P codes. Official pages were not fetched |
| [sources/speech_providers.md](sources/speech_providers.md) | Deepgram streaming ASR and Aura TTS, ElevenLabs TTS with timestamps, the browser Web Speech API (recognition and synthesis boundaries), latency and privacy notes | Search excerpts of vendor documentation; [V]/[V?]/[S]/[U] tags. JSON examples were rebuilt from documented field names |
| [sources/platform_docs.md](sources/platform_docs.md) | Anthropic SDK structured output, Gemini Interactions API and Gemini 4 Hydrogen (§6), Stripe API version and webhook typings, Next.js 16, Fastify, Drizzle, Supabase JWT verification, Cornerstone3D, DICOM confidentiality profile | Package typings and READMEs from npm/PyPI ([PKG]), vendor documentation sources on GitHub ([DOC-SRC]), search snippets |

## Hosts to allow for direct verification

Add these to the cloud environment's network allowlist, then re-fetch the URLs in each registry:

- Boards: `www.theabr.org`, `www.royalcollege.ca` (possibly also `theabr.org`, `royalcollege.ca` and `news.royalcollege.ca`)
- Speech: `developers.deepgram.com`, `elevenlabs.io`, `developer.mozilla.org`
- Platform: `docs.stripe.com`, `nextjs.org`, `www.cornerstonejs.org`, `supabase.com`, `dicom.nema.org`

## Rules

- Public copy describes board facts as "publicly described" and keeps the independence disclaimer until the owner verifies them. See [EXAM_PROFILES.md](EXAM_PROFILES.md) §4.
- Rows marked paraphrase (P) are never shown to users as quotes.
- Board-owned images and confidential examination content are never copied into the case bank, even when publicly accessible.
- Model IDs, prices and provider settings are configuration, not code constants. Recheck them against current provider documentation before trusting any cost report.
