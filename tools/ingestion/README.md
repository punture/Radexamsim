# sim-ingest: restricted teaching-case ingestion and de-identification

`sim-ingest` is a local command-line tool for the case owner (a radiologist). It works on
the owner's own approved teaching files (PPTX lecture decks, image files, PDFs and
de-identified DICOM) and produces four things:

1. an **inventory** of every slide, page, image and series, with privacy and quality hints;
2. a **quarantine**: an untouched, SHA-256-named copy of the sources in a restricted directory;
3. **derivatives**: original embedded images, lossless conversions and de-identified DICOM;
4. a **case import package** (`sim-case-import@1`) that the web app's owner console imports as a **DRAFT** case.

The tool never approves anything. It can only set a package's privacy status to
`checked` (the automated checks ran and found nothing high-severity) or leave it in
`quarantine`. The owner approves privacy and commercial rights in the app.

## Privacy workflow

```
quarantine  ->  automated checks (inventory, extract)  ->  owner review  ->  package  ->  import as DRAFT
```

1. **Quarantine first.** `quarantine` copies the untouched sources into `QDIR` (directories
   0700, files 0600). Files are named by SHA-256. `QDIR/manifest.json` maps each digest to the
   original relative path, so the manifest itself contains identifiers.
   **QDIR must stay on this computer.** Do not put it in a git repository, a cloud-synced
   folder (Dropbox, OneDrive, iCloud, Google Drive, Box) or any upload. The tool warns if
   QDIR sits inside a git working tree that does not ignore it, or under a known sync folder.
   The repository `.gitignore` already ignores `quarantine/`, `source-assets/` and
   `tools/ingestion/out/`, so keep working directories under those names.
2. **Automated checks.** `inventory` and `extract` flag identifier-like text, embedded
   metadata, cropped or covered pictures, burned-in text risk, DICOM residual risks and
   recognisable-feature risk. They **flag, never fix**: no inpainting, no cropping, no
   defacing, no synthesised pixels.
3. **Owner review.** Open the derivatives and read every finding. Automated checks help;
   they do **not** prove de-identification. Check pixels yourself for burned-in names, dates,
   MRNs and institution names, and decide on faces and other recognisable features.
4. **Package and import.** `package` builds the DRAFT import for one suggested case family.
   Only then import it in the owner console.

Rules that always apply:

- **Never send raw sources** (QDIR, SRC_DIR, inventories made with `--include-source-text`)
  to any external AI service, cloud tool, chat assistant or e-mail. Run everything locally.
- **OCR is not proof.** There is no OCR unless `tesseract` is installed. Without it every
  image carries the finding *"pixel text not checked"*. With it, a clean OCR result still
  does not prove that there is no burned-in text.
- **Recognisable features.** Head-and-neck CT/MR series (or series whose body part is not
  stated) are flagged *"recognizable features risk"* for an owner decision. Severity is high
  for volumetric series of 20+ slices with a slice thickness of 3 mm or less (or unknown),
  where facial surface reconstruction is possible. Nothing is defaced or edited. Colour
  images are flagged as possible clinical photographs. Faces in photographs are **not** detected.
- **De-identification and commercial permission are separate.** The rights map only sets
  `commercialUseStatus` (`cleared|restricted|unresolved`). It never affects privacy status,
  and privacy status never implies rights.
- **No original file names or raw text in outputs.** The inventory, derivatives and package
  use opaque source ids (the first 16 hex characters of the SHA-256 of the exact source
  bytes) and generated labels such as `Deck 877f6886 slide 1: 1 image(s)`. Raw slide or page
  text and original paths are written only with `--include-source-text`. A package built with
  it is always `quarantine`.
- Terminal output uses source ids only. `--debug` shows library warnings and tracebacks,
  which may contain paths or values, so keep that output local too.

## Installation

Requires Python 3.13. Run from `tools/ingestion`:

```bash
python3.13 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/pip install --no-deps -e .     # makes `python -I -m ingest` work from any directory
```

Optional: install `tesseract` (for example `apt-get install tesseract-ocr`) to enable OCR
of pixel text. Nothing else is downloaded or contacted at run time. The tool makes no
network calls.

Run the tool with Python's **isolated mode** (`-I`). The inputs are untrusted, and isolated
mode stops Python from importing modules from the current directory or from `PYTHON*`
environment variables. Every file the tool writes is private (umask 077).

```bash
PY=tools/ingestion/.venv/bin/python
$PY -I -m ingest --help
```

## Commands

Exit codes: `0` success, `1` usage or data error (message on stderr), `2` bad arguments,
`3` unexpected internal error (re-run with `--debug`).

### 1. `quarantine SRC_DIR --quarantine QDIR`

```bash
$PY -I -m ingest quarantine ~/teaching/raw --quarantine ~/teaching/quarantine
```

This copies every regular file in `SRC_DIR` byte for byte to `QDIR/objects/ab/<sha256>.<ext>`
and verifies each copy against its hash. It writes `QDIR/manifest.json`
(`sim-ingest-quarantine@1`: sha256 → `originalRelativePaths`, `storedAs`, `byteSize`,
`detectedType`) and `README-RESTRICTED.txt`. Symlinks are never followed. Hidden files and
OS clutter (`.DS_Store`, `Thumbs.db`, `~$` lock files) are skipped and counted. Re-running
is idempotent: existing objects are re-verified and new files are added. QDIR may not be
inside SRC_DIR, or the other way round.

### 2. `inventory SRC_DIR --out OUT_DIR [--rights-map rights.csv] [--institutions names.txt] [--include-source-text]`

```bash
$PY -I -m ingest inventory ~/teaching/quarantine --out ~/teaching/out/inventory \
    --rights-map ~/teaching/rights.csv --institutions ~/teaching/institutions.txt
```

`SRC_DIR` can be the original folder or the quarantine. The ids are identical either way,
because they come from the content hash. The command writes `OUT_DIR/inventory.json`
(`sim-ingest-inventory@1`) and `OUT_DIR/inventory.csv`, with **one row per PPTX slide,
image file, PDF page, DICOM series or cine clip**. Each row has:

| field | meaning |
|---|---|
| `sourceFileId` | SHA-256 prefix of the source file. For a DICOM series, the prefix of the hash of its sorted member digests; members are listed in `memberSourceFileIds` |
| `kind`, `locator` | `pptx_slide` / `image_file` / `pdf_page` / `dicom_series` / `cine_clip`; `slide 12`, `page 3`, `series 2`, `image 1`, `clip 1`, `slide 4 video 1` |
| `label` | generated, sanitised label (never slide text or file names) |
| `imageCount`, `dimensions`, `images[]` | per image: sha256, format, size, bit depth, dHash/aHash, notes, fidelity notes |
| `modalityHint` | DICOM `Modality`; otherwise `null` |
| `qualityHints` | `minDimension`, `bits`, `lossy`, `lowResolution` (< 256 px) |
| `teachingAnnotations` | PPTX: `true` when arrows, lines, callouts, outline shapes, ink or text labels overlap a picture. PDF: vector strokes, text or markup annotations over an image. `null` when unknown |
| `identifierFindings` | `[{severity, location, finding, category, scope}]`; values are never quoted |
| `commercialUseStatus` | from the rights map, else `unresolved` |
| `missingMaterial` | e.g. linked (not embedded) pictures, EMF/WMF not convertible, unsupported transfer syntax, possible missing slices, videos not packaged |
| `suggestedCaseFamilyId` | duplicate-detection family (below); `null` for rows without images |

**Identifier patterns** run over slide text, speaker notes, comments, alt text, custom shape
names, chart and SmartArt text, hyperlinks, document properties, PDF page text, annotations
and metadata, image metadata (EXIF, XMP, PNG text, comments) and DICOM text attributes. They
look for `Name:`-style labels, MRN, health-card and patient-ID labels, 6-12 digit numbers,
phone- or health-card-like grouped numbers, DOB labels and dates, accession labels and
accession-like ids, e-mail addresses, postal codes, ages over 89, honorific + name,
`Dr X`, institution-like names, and the names listed in `--institutions` (one per line, `#`
comments allowed).

**Other checks:**

- **PPTX.** A picture that is cropped on the slide gets a high finding: crops are
  non-destructive, so the extracted original contains the hidden regions. An opaque shape
  over a picture also gets a high finding, as a possible redaction box. Hidden slides,
  embedded OLE objects, linked pictures, flips, rotations and recolouring are reported too.
  Pictures in masters and layouts (logos) are not extracted.
- **PDF.** Images are placed by tracking the content-stream CTM. Opaque rectangles drawn over
  an image, unapplied `/Redact` annotations and filled annotations count as possible
  redaction boxes (high).
- **Images.** Embedded metadata is flagged: GPS is high; author or owner names, serial
  numbers, capture dates and free text are medium. A corner burned-in-text heuristic (not OCR)
  runs on every image, and colour images are flagged as possible photographs.
- **DICOM.** The inventory lists identifying attributes present in the source (they are
  removed by `extract`), private attributes, `BurnedInAnnotation`, recognisable-feature risk
  and display/geometry validation.

**Suggested case families.** A dHash and an aHash (256 bits each) are computed with Pillow on
every decodable image. Rows join the same family when they share identical image bytes, a
near-identical image (dHash ≤ 14 and aHash ≤ 24 bits apart, aspect ratio within 5%), the
same DICOM study, or the same real DICOM PatientID. Placeholders such as `ANONYMOUS` never
link cases. Grouping uses union-find, so families are transitive and **never split**. Tiny or
blank images, and any image repeated on more than 6 rows (logos, decorations), are ignored
for grouping. Family ids look like `fam-0123456789ab`. They are deterministic for a given set
of inputs, but adding sources can merge families and change an id, so always package from the
current inventory.

**Rights map** (`--rights-map`, CSV with header `match,commercialUseStatus[,note]`).
`match` is a SHA-256 or sourceFileId prefix (8+ hex characters) or a glob over the original
relative path or file name. When several rows match, the most restrictive status wins
(`restricted` > `unresolved` > `cleared`). Paths and notes are read locally and never written
out.

```csv
match,commercialUseStatus,note
lectures/2019/*.pptx,cleared,own cases
3f9a2b1c4d5e6f70,restricted,journal figure
```

`--include-source-text` adds `sourceText` to the rows and `originalRelativePaths` to the
sources. Treat that inventory as quarantine-level material.

### 3. `extract QDIR --out DERIV_DIR [--render-png] [--strip-metadata] [--uid-key FILE] [--institutions FILE] [--no-ocr] [--force]`

```bash
$PY -I -m ingest extract ~/teaching/quarantine --out ~/teaching/out/derivatives --render-png
```

This runs only on a quarantine (it checks `manifest.json` and re-verifies every hash).
It writes derivative files under `DERIV_DIR/files/<sourceFileId>/<locator>/` and
`DERIV_DIR/derivatives.json` (`sim-ingest-derivatives@1`):

- `derivatives[]`: one entry per output file, with `sourceFileId`, `locator`, `method`
  (`original_embedded|format_converted|dicom_export`), `sha256`, `mimeType`, `width`,
  `height`, `byteSize`, `notes`, plus `imageIndex`, `frameIndex`, `variant`, `file` and
  `originalSha256`.
- `groups[]`: one per future asset (`still|stack|cine|dicom_stack`, or `video`, which is not
  packaged), with findings, `preservesDiagnosticContent`, `burnedInAnnotationsPresent`,
  DICOM display metadata and a de-identification report (attribute keywords and counts only).
- `rejected[]`: everything that could not be produced, with a clear reason.

How each kind of image is handled:

- **Browser-displayable originals** (PNG, JPEG, single-frame WebP) are written **byte for
  byte**. The SHA-256 equals the PPTX `ppt/media/*` part or the PDF `DCTDecode` stream.
- **Other rasters** (TIFF, BMP, GIF, JPEG 2000, AVIF, PDF Flate/LZW/CCITT/inline streams)
  are converted to PNG with Pillow. There is no resampling or cropping, 16-bit greyscale and
  ICC profiles are kept, and an EXIF orientation is applied by lossless transpose. Animated
  GIF/PNG/WebP become `cine` frames and multi-page TIFF becomes a `stack`. Conversions that
  cannot be bit-exact (CMYK, 16-bit-per-channel colour TIFF) say so and set
  `preservesDiagnosticContent=false`. Float images are rejected.
- **EMF/WMF** cannot be rasterised on Linux or macOS (Pillow renders them only on Windows).
  They are reported in `rejected` and `missingMaterial` and never faked. Export them to PNG
  from PowerPoint and re-run.
- **Video** (MP4/MOV/AVI/WMV/WebM, embedded or standalone) is copied as original bytes for
  the owner, but it is not packaged and its frames are not checked.
- **DICOM** is validated, de-identified (see below) and written as new `.dcm` files with
  untouched pixel data. The tool checks that the PixelData hash is unchanged and that
  `PatientIdentityRemoved=YES` is present after writing. A series is sorted by the projection
  of `ImagePositionPatient` onto the slice normal when orientation and positions are
  consistent. Otherwise it falls back to `InstanceNumber` with `geometryValidated=false`.
  Non-uniform spacing (possible missing slices) and gantry tilt are noted.
  `--render-png` adds 8-bit PNG frames made with the first `WindowCenter/WindowWidth` and the
  linear VOI function from PS3.3 C.11.2.1.2 (full range if there is no window). These are
  labelled **rendered derivatives**, with `preservesDiagnosticContent=false`.
- **OCR.** If `tesseract` is on `PATH` and `--no-ocr` is not given, the first, middle and
  last frame of each asset are OCR'd. OCR text stays in memory and only pattern findings are
  recorded. Without tesseract every asset gets *"pixel text not checked"* (medium).
- **`--strip-metadata`** removes EXIF/XMP/comment segments from original JPEG and text or
  eXIf chunks from original PNG, losslessly. Compressed image data and decoded pixels stay
  identical, which the tool verifies. The SHA-256 changes and `originalSha256` keeps the
  source digest. The tool refuses when an EXIF orientation would be lost.

The DICOM UID key is `QDIR/uid-key`, created as 32 random bytes with mode 0600 (override
with `--uid-key`). The original → new UID map is saved in `QDIR/uid-map.json` (0600). Both
are restricted and must stay with the quarantine.

### 4. `package --family FAMILY_ID --inventory OUT_DIR/inventory.json --derivatives DERIV_DIR/derivatives.json --out PKG_DIR [...]`

```bash
$PY -I -m ingest package --family fam-760dad4fe3db \
    --inventory ~/teaching/out/inventory/inventory.json \
    --derivatives ~/teaching/out/derivatives/derivatives.json \
    --out ~/teaching/out/packages/abscess-01 \
    --diagnosis "Pyogenic cerebral abscess" --basis "Aspiration culture" --truth-status confirmed
```

This writes `PKG_DIR/case-import.json`, copies the frames to `PKG_DIR/frames/aN/<index>.<ext>`
(re-verifying every SHA-256) and writes a deterministic `PKG_DIR.zip` next to it, with
`case-import.json` at the zip root. Options:

- `--case-id SLUG` (default `case-<family hash>`).
- `--title TEXT`, `--diagnosis` and `--basis` are pattern-checked: an identifier-like owner
  title is flagged and keeps the package in quarantine.
- `--include-rendered-png` also packages DICOM PNG renderings as a separate `stack`.
- `--include-source-text` puts raw text in `teachingText` and forces `quarantine`. The
  inventory must have been made with the same flag.
- `--force` rebuilds an existing package.
- `--family` may be repeated to merge whole families into one case. Families are never split.

The package format (validated before writing):

```json
{
  "format": "sim-case-import@1",
  "caseId": "case-760dad4fe3db",
  "caseFamilyId": "fam-760dad4fe3db",
  "internalTitle": "Draft case fam-760dad4fe3db (3 source references, 3 assets)",
  "sourceDiagnosis": "string|null", "diagnosticBasis": "string|null",
  "truthStatus": "confirmed|probable|differential_only|null",
  "sourceReferences": [{"id": "src-1", "kind": "pptx_slide", "sourceFileId": "877f6886068f0d32",
                        "locator": "slide 1", "description": "Deck 877f6886 slide 1: 1 image(s), teaching annotations"}],
  "assets": [{"id": "a1", "kind": "still|stack|cine|dicom_stack", "modality": "CT|...|other",
              "neutralLabel": "Image 1 (to be labelled by owner)", "sequence": null, "plane": null, "contrast": null,
              "frames": [{"index": 0, "file": "frames/a1/0.png", "mimeType": "image/png", "width": 256, "height": 256,
                          "sha256": "64-hex", "byteSize": 24748}],
              "derivation": {"sourceReferenceId": "src-1", "method": "original_embedded", "notes": "...",
                             "preservesDiagnosticContent": true, "burnedInAnnotationsPresent": false},
              "dicom": null}],
  "teachingText": null,
  "privacyFindings": [{"severity": "medium", "location": "src-1 slide 1 text", "finding": "..."}],
  "privacyStatus": "checked|quarantine",
  "notes": "..."
}
```

`dicom` (only on `dicom_stack` assets) is `{transferSyntaxUid, photometricInterpretation,
rows, columns, bitsAllocated, rescaleSlope, rescaleIntercept, pixelSpacing|null,
sliceThickness|null, imageOrientationPatient|null, sortedBy, geometryValidated,
windowPresets[{label, center, width}]}`. Non-DICOM modality is `other`, and `sequence`,
`plane` and `contrast` are `null`: the owner labels them.

**Privacy status:** `checked` only if no high-severity finding remains **and** source text is
excluded. Otherwise it is `quarantine`. Findings carry into the package as follows:

- Findings about image or DICOM content (crops, overlays, metadata kept in original bytes,
  OCR, burned-in flags, recognisable features, residual DICOM text) keep their severity.
- Findings in slide or page text, notes or document properties are downgraded when the text
  is excluded: high becomes medium ("check the images for the same identifiers"), medium and
  low become low.
- Source-only findings already resolved by processing (for example DICOM PHI attributes,
  which were removed) are replaced by the de-identification report.

## Case-per-folder archives (intake helper)

When the source has one folder per case (for example key-image exports: case folder, then
export folder, then study folder, then images), `scripts/intake_by_folder.py` runs quarantine,
inventory and extract, then builds one draft package per case folder. It does this by merging
the families whose sources live in that folder; families are never split.

```bash
tools/ingestion/.venv/bin/python -I tools/ingestion/scripts/intake_by_folder.py \
    --src ~/Downloads/intake.zip --batch quarantine/box-batch-1
```

Folder labels become the draft's internal title and the owner's provisional diagnosis label,
with digit runs of 5 or more removed (possible record numbers). Output shows only case numbers,
labels, image counts and finding counts. Packages with high findings stay `quarantine`, and the
owner console refuses to import them until the findings are resolved.

### Fetching a Box folder into quarantine

`scripts/box_fetch_folder.py --folder-id ID --dest quarantine/<batch>/src` downloads a Box folder
tree's image, DICOM, PPTX and PDF files into a git-ignored quarantine source directory. It
keeps the folder layout, checks each file against Box's SHA-1, and prints counts only. It
authenticates with a Box access token: either one the session's network proxy injects, or
`BOX_ACCESS_TOKEN`.

## Supported formats

| input | handling |
|---|---|
| `.pptx`, `.pptm`, `.potx`, `.ppsx` | slides, notes, comments, original `ppt/media` pictures (including grouped and image-filled shapes), embedded videos |
| PNG, JPEG, WebP | original bytes |
| TIFF, BMP, GIF, JPEG 2000, AVIF | lossless PNG |
| PDF (unencrypted, or empty password) | DCT streams as original JPEG; Flate/LZW/RunLength/CCITT/inline/JPX as lossless PNG |
| DICOM Part 10 (or raw `.dcm` with core attributes) | transfer syntaxes **1.2.840.10008.1.2 (Implicit VR Little Endian)** and **1.2.840.10008.1.2.1 (Explicit VR Little Endian)** only; PhotometricInterpretation MONOCHROME1, MONOCHROME2, RGB (8-bit); BitsAllocated 8 or 16 |
| MP4/MOV/AVI/WMV/WebM | inventory row (`cine_clip`) and original copy; not packaged |

Rejected with a clear reason: legacy `.ppt/.doc/.xls` (convert to `.pptx` locally),
Word/Excel files, zip archives (unpack first), EMF/WMF, HEIC, SVG, encrypted PDFs, JBIG2
streams, DICOMDIR, non-image DICOM (SR, presentation states, encapsulated documents, RT),
and compressed, deflated or big-endian DICOM. For DICOM, decompress the quarantined copy with
a trusted local tool such as dcmtk `dcmdjpeg` or `gdcmconv --raw`, then re-run.

## DICOM de-identification: documented subset of PS3.15 Annex E

This is a **subset** of the Basic Application Level Confidentiality Profile (Table E.1-1). It
does **not** claim conformance to the full profile or to any option, so no
`DeidentificationMethodCodeSequence` is written. Actions apply at every nesting level,
including inside sequences.

| action | attributes |
|---|---|
| **Z** blank (zero length) | PatientName, PatientID, PatientBirthDate, PatientSex, ReferringPhysicianName, AccessionNumber, StudyID, StudyDate, StudyTime, ContentDate, ContentTime, ContentCreatorName |
| **X** remove: patient | ClinicalTrial* subject/site/sponsor attributes, PatientBirthTime, OtherPatientIDs(+Sequence), OtherPatientNames, PatientBirthName, PatientMotherBirthName, MedicalRecordLocator, PatientAddress, PatientTelephoneNumbers, PatientTelecomInformation, MilitaryRank, BranchOfService, CountryOfResidence, RegionOfResidence, EthnicGroup, Occupation, PatientReligiousPreference, PatientInsurancePlanCodeSequence, PatientPrimaryLanguageCodeSequence, IssuerOfPatientID(+QualifiersSequence), PatientAge, PatientSize, PatientWeight, AdditionalPatientHistory, PatientComments, MedicalAlerts, Allergies, SmokingStatus, PregnancyStatus, LastMenstrualDate, PatientState, SpecialNeeds, ResponsiblePerson(+Role), ResponsibleOrganization, ReferencedPatientSequence, ReferencedPatientPhotoSequence, PatientTransportArrangements, PatientInstitutionResidence |
| **X** remove: people | ReferringPhysicianAddress/TelephoneNumbers/IdentificationSequence, ConsultingPhysicianName(+IdentificationSequence), PerformingPhysicianName(+IdentificationSequence), NameOfPhysiciansReadingStudy(+IdentificationSequence), PhysiciansOfRecord(+IdentificationSequence), OperatorsName, OperatorIdentificationSequence, RequestingPhysician, ScheduledPerformingPhysicianName(+IdentificationSequence), HumanPerformerName/Organization, PersonName/Address/TelephoneNumbers/IdentificationCodeSequence, ReviewerName, VerifyingObserverName/Sequence/IdentificationCodeSequence, AuthorObserverSequence, ParticipantSequence, DistributionName/Address, Interpretation* people attributes |
| **X** remove: institution, device, location | InstitutionName, InstitutionAddress, InstitutionCodeSequence, InstitutionalDepartmentName, InstitutionalDepartmentTypeCodeSequence, StationName, DeviceSerialNumber, DetectorID, PlateID, GantryID, CassetteID, DeviceLabel, SoftwareVersions, PerformedStationName, PerformedLocation, PerformedStationAETitle, ScheduledStationName/AETitle, ScheduledProcedureStepLocation, StationAETitle, RetrieveAETitle, ModifyingDeviceID/Manufacturer |
| **X** remove: visit, order, request | AdmissionID, IssuerOfAdmissionIDSequence, ServiceEpisodeID/Description, CurrentPatientLocation, AdmittingDiagnosesDescription/CodeSequence, DischargeDiagnosisDescription, VisitComments, RouteOfAdmissions, RequestedProcedureID, PerformedProcedureStepID, ScheduledProcedureStepID, Placer/FillerOrderNumberImagingServiceRequest, OrderEnteredBy, OrderEntererLocation, OrderCallbackPhoneNumber, ReasonForTheRequestedProcedure, ReasonForStudy, RequestedProcedureComments, ImagingServiceRequestComments, StudyComments, RequestAttributesSequence, ReferencedStudySequence, ReferencedPerformedProcedureStepSequence, InterpretationText/ID, ResultsID(+Issuer), InterpretationIDIssuer |
| **X** remove: descriptors and content | StudyDescription, PerformedProcedureStepDescription, RequestedProcedureDescription, ScheduledProcedureStepDescription, ImageComments, AcquisitionComments, DerivationDescription, FrameComments, AcquisitionDeviceProcessingDescription, IdentifyingComments, TextComments, Topic*, ContributionDescription, TimezoneOffsetFromUTC, IconImageSequence, ContentSequence, DigitalSignaturesSequence, OriginalAttributesSequence, DataSetTrailingPadding |
| **X** remove: generic | **all private attributes**; public attributes unknown to the DICOM data dictionary; overlay groups 60xx and curve groups 50xx; group-length elements; every other DA/DT/TM attribute (Series/Acquisition dates and times and so on); the original file meta (rebuilt) and the 128-byte preamble (zeroed) |
| kept only if vocabulary-checked | SeriesDescription, ProtocolName: kept only when every token is an acquisition term (e.g. `AX T2 FLAIR`); otherwise removed |
| **U** replace UIDs | every UI value that is not a standard `1.2.840.10008.*` UID and not a class/syntax UID (StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID, FrameOfReferenceUID, ReferencedSOPInstanceUID, ...), via `2.25.<HMAC-SHA256(key, uid) as a UUID>`. The mapping is consistent across files and runs for the same key, so references remain valid |
| set | PatientIdentityRemoved=`YES`; DeidentificationMethod (what was done, including "Pixel data NOT modified"); LongitudinalTemporalInformationModified=`REMOVED` |
| kept | pixel data and display/geometry/acquisition attributes (Modality, BodyPartExamined, Rows/Columns, Bits*, PhotometricInterpretation, PixelSpacing, SliceThickness, ImagePosition/OrientationPatient, Rescale*, Window*, SeriesNumber, InstanceNumber, Manufacturer, sequence parameters, ...) |

After de-identification the tool re-scans every output and reports:

- **high**: a remaining private attribute, a listed attribute that is still present, a
  non-empty person name, identifier patterns in a retained text attribute,
  `BurnedInAnnotation=YES`, or `RecognizableVisualFeatures=YES`;
- **medium**: a remaining date or time, any retained free-text attribute that still contains
  text (for example `ContrastBolusAgent`), or `BurnedInAnnotation` not stated for screen
  capture or ultrasound;
- **low**: an informational summary of what was removed.

## Limitations

- **Automated checks are heuristics.** Names without a label ("John Smith") are not detected
  in free text, the corner-text heuristic is not OCR, and OCR (when installed) misses text.
- **No OCR without tesseract**, and pixel text is never removed. Burned-in annotations stay
  in derivatives until the owner replaces or rejects the image.
- **No face detection or defacing.** Clinical photographs, tattoos and 3D-renderable head
  volumes need an owner decision.
- **EMF/WMF cannot be converted** on this platform, and the tool does not fake them.
- **Compressed DICOM transfer syntaxes are not supported** (JPEG, JPEG-LS, JPEG 2000, RLE,
  HTJ2K, MPEG, deflate), and neither are big-endian, YBR/palette colour, float pixel data or
  BitsAllocated other than 8 or 16.
- **Enhanced multi-frame DICOM** is exported as one file per instance. Per-frame geometry is
  not validated (`sortedBy=instance_number`, `geometryValidated=false`).
- The de-identification is a documented **subset** of PS3.15 Annex E. Known dictionary
  attributes that are not in the tables above are kept and re-scanned (free text is flagged),
  not removed.
- **PDF:** overlays are detected only for rectangles and paths in the page content stream and
  for annotations. Soft masks and `/Decode` arrays are noted but not applied to extracted
  JPEGs. Encrypted PDFs and JBIG2 images are rejected.
- **PPTX:** pictures in masters and layouts, slide backgrounds, chart or table cell fills,
  SmartArt pictures and fallback images are not extracted (they are counted in notes).
  Embedded OLE objects are not inspected. Crops, flips, rotations and recolouring are reported,
  not applied.
- **Video** is not decoded, checked or packaged (`sim-case-import@1` frames are image or DICOM
  only).
- Hidden files and folders (names starting with `.`) in SRC_DIR are skipped.

## Tests

```bash
cd tools/ingestion && .venv/bin/pytest
```

The tests build synthetic inputs at run time and never use real patient data. They create
two PPTX decks (a PNG with an arrow over it, identifiers in slide text and notes, a cropped
picture, a TIFF with an opaque box, and an identical plus a resized JPEG copy in a second
deck), a hand-written PDF (an original JPEG stream, a Flate image with a line and a box drawn
over it), a 16-bit TIFF, a JPEG with EXIF GPS, an EMF, an animated GIF, a fake MP4, a 4-slice
MR series with PHI, a private block, nested references and shuffled InstanceNumbers, and a
JPEG-compressed DICOM.

They check:

- identifier findings;
- identical SHA-256 for embedded originals;
- lossless conversions;
- quarantine permissions and manifest;
- DICOM PHI and private-tag removal, consistent UID replacement and PatientIdentityRemoved;
- geometric sorting and fallbacks;
- rejection of unsupported transfer syntaxes;
- the package format, through an independent validator in `tests/test_package.py`;
- privacy status rules;
- that no original file name appears in `inventory.json`, `inventory.csv`, `derivatives.json`
  or `case-import.json`.

## Layout

```
tools/ingestion/
  README.md  requirements.txt  pyproject.toml
  ingest/    __main__.py cli.py               command line
             quarantine.py inventory.py extract.py package.py   the four commands
             analysis.py detect.py model.py util.py              enumeration, type detection, data model
             pptx_reader.py pdf_reader.py images.py ocr.py       format readers and image checks
             dicom_deid.py dicom_series.py                       DICOM de-identification, validation, sorting
             phi.py families.py rights.py schema.py              patterns, duplicates, rights map, package validator
  tests/     conftest.py (synthetic corpus) and test_*.py
```
