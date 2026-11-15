"""Synthetic test corpus. Everything is generated at test time; no real patient data.

File names deliberately look like identifiers (they must never leak into outputs).
"""

from __future__ import annotations

import hashlib
import io
import struct
import zlib
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pytest
from PIL import Image, ImageDraw, ImageFilter
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.util import Inches
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.encaps import encapsulate
from pydicom.uid import ExplicitVRLittleEndian, JPEGBaseline8Bit, MRImageStorage, SecondaryCaptureImageStorage

from ingest.cli import main as cli_main

UID_ROOT = "1.2.826.0.1.3680043.8.498."


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def brain_image(seed: int, size: int = 256) -> Image.Image:
    """Synthetic, textured 'cross-section' (distinct per seed)."""
    rng = np.random.default_rng(seed)
    img = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(img)
    m1, m2 = size * 30 // 256, size * 45 // 256
    d.ellipse((m1, m1 * 2 // 3, size - m1, size - m1 * 2 // 3), fill=90)
    d.ellipse((m2, m2 * 3 // 4, size - m2, size - m2 * 3 // 4), fill=130)
    lo, hi = size * 70 // 256, size - size * 70 // 256
    for _ in range(14):
        x, y = rng.integers(lo, hi, 2)
        r = int(rng.integers(max(2, size * 5 // 256), max(3, size * 25 // 256)))
        d.ellipse((x - r, y - r, x + r, y + r), fill=int(rng.integers(40, 230)))
    arr = np.asarray(img, dtype=np.float64) + rng.normal(0, 6, (size, size))
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1))


def png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def jpeg_bytes(img: Image.Image, quality: int = 90, **kw) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, **kw)
    return buf.getvalue()


def tiff_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="TIFF")
    return buf.getvalue()


# ---------------------------------------------------------------------------
# PPTX
# ---------------------------------------------------------------------------


def build_deck_a(path: Path, img_a: bytes, img_b: bytes, tif_c: bytes) -> None:
    prs = Presentation()
    # slide 1: picture + arrow over it + identifiers in slide text and notes
    s1 = prs.slides.add_slide(prs.slide_layouts[5])
    s1.shapes.title.text = "Case 1"
    s1.shapes.add_picture(io.BytesIO(img_a), Inches(1), Inches(1.5), Inches(4), Inches(4))
    s1.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, Inches(2), Inches(3), Inches(1), Inches(0.5))
    tb = s1.shapes.add_textbox(Inches(5.5), Inches(1.5), Inches(3), Inches(1))
    tb.text_frame.text = "Name: Test Person, MRN 12345678"
    s1.notes_slide.notes_text_frame.text = "DOB: 1970-01-02. Referred from Example General Hospital."
    # slide 2: distinct picture, cropped on the slide (non-destructive crop)
    s2 = prs.slides.add_slide(prs.slide_layouts[6])
    pic2 = s2.shapes.add_picture(io.BytesIO(img_b), Inches(1), Inches(1), Inches(4), Inches(4))
    pic2.crop_left = 0.15
    # slide 3: text only
    s3 = prs.slides.add_slide(prs.slide_layouts[1])
    s3.shapes.title.text = "Differential diagnosis"
    s3.placeholders[1].text = "Abscess versus necrotic tumour"
    # slide 4: TIFF picture (browser cannot display) with an opaque black box over a corner
    s4 = prs.slides.add_slide(prs.slide_layouts[6])
    s4.shapes.add_picture(io.BytesIO(tif_c), Inches(1), Inches(1), Inches(4), Inches(4))
    box = s4.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(1), Inches(1), Inches(1.2), Inches(0.4))
    box.fill.solid()
    box.fill.fore_color.rgb = RGBColor(0, 0, 0)
    prs.save(str(path))


def build_deck_b(path: Path, img_a: bytes, img_a_jpeg: bytes) -> None:
    prs = Presentation()
    s1 = prs.slides.add_slide(prs.slide_layouts[6])
    s1.shapes.add_picture(io.BytesIO(img_a), Inches(1), Inches(1), Inches(4), Inches(4))
    s1.notes_slide.notes_text_frame.text = "Teaching point: ring enhancement."
    s2 = prs.slides.add_slide(prs.slide_layouts[6])
    s2.shapes.add_picture(io.BytesIO(img_a_jpeg), Inches(1), Inches(1), Inches(4), Inches(4))
    prs.save(str(path))


# ---------------------------------------------------------------------------
# PDF (hand-written so the embedded JPEG stream bytes are known exactly)
# ---------------------------------------------------------------------------


def _pdf(objects: list[bytes], info_obj: int) -> bytes:
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R /Info {info_obj} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def _stream(entries: str, data: bytes) -> bytes:
    return f"<< {entries} /Length {len(data)} >>\nstream\n".encode() + data + b"\nendstream"


def build_pdf(path: Path, jpeg: bytes, jw: int, jh: int, raw_gray: bytes, fw: int, fh: int) -> None:
    content1 = b"BT /F1 12 Tf 72 720 Td (Accession: AB123456) Tj ET\nq 200 0 0 200 100 400 cm /Im1 Do Q\n"
    content2 = (
        b"q 200 0 0 200 100 400 cm /Im2 Do Q\n"
        b"2 w 0 0 1 RG 120 420 m 250 550 l S\n"  # arrow-like line over the image
        b"0 g 110 560 60 30 re f\n"  # opaque box over the image (possible redaction)
    )
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 9 0 R >> /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>",
        _stream("", content1),
        _stream(f"/Type /XObject /Subtype /Image /Width {jw} /Height {jh} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /DCTDecode", jpeg),
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im2 8 0 R >> >> /Contents 7 0 R >>",
        _stream("", content2),
        _stream(f"/Type /XObject /Subtype /Image /Width {fw} /Height {fh} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode", zlib.compress(raw_gray)),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Author (Lecturer) /Title (Patient name: Jane Roe) >>",
    ]
    path.write_bytes(_pdf(objects, info_obj=10))


# ---------------------------------------------------------------------------
# DICOM
# ---------------------------------------------------------------------------


def mr_slice(k: int, z: float, instance_number: int, sop_uid: str, ref_sop: str, uids: dict[str, str]) -> Dataset:
    ds = Dataset()
    ds.SOPClassUID = MRImageStorage
    ds.SOPInstanceUID = sop_uid
    ds.StudyInstanceUID = uids["study"]
    ds.SeriesInstanceUID = uids["series"]
    ds.FrameOfReferenceUID = uids["for"]
    ds.PatientName = "Doe^Jane"
    ds.PatientID = "MRN0012345"
    ds.PatientBirthDate = "19700102"
    ds.PatientSex = "F"
    ds.PatientAge = "053Y"
    ds.OtherPatientIDs = "OLD123"
    ds.PatientAddress = "1 Main Street"
    ds.InstitutionName = "Example General Hospital"
    ds.InstitutionAddress = "2 Hospital Road"
    ds.ReferringPhysicianName = "Smith^John"
    ds.PerformingPhysicianName = "Jones^Amy"
    ds.OperatorsName = "Tech^Bob"
    ds.StationName = "MR01"
    ds.DeviceSerialNumber = "SN12345"
    ds.AccessionNumber = "ACC998877"
    ds.StudyID = "S1"
    ds.StudyDate = "20240115"
    ds.StudyTime = "101500"
    ds.SeriesDate = "20240115"
    ds.AcquisitionDate = "20240115"
    ds.ContentDate = "20240115"
    ds.StudyDescription = "MRI BRAIN Jane Doe"
    ds.SeriesDescription = "AX T2"
    ds.ProtocolName = "Dr Smith brain protocol"
    ds.ContrastBolusAgent = "Gadolinium"
    ds.Modality = "MR"
    ds.Manufacturer = "ACME"
    ds.BodyPartExamined = "HEAD"
    ds.SeriesNumber = 2
    ds.InstanceNumber = instance_number
    ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
    ds.ImagePositionPatient = [-28.8, -28.8, z]
    ds.PixelSpacing = [0.9, 0.9]
    ds.SliceThickness = 5
    ds.WindowCenter = 300
    ds.WindowWidth = 600
    ds.RescaleSlope = 1
    ds.RescaleIntercept = 0
    ds.BurnedInAnnotation = "NO"
    ds.Rows = 64
    ds.Columns = 64
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.BitsAllocated = 16
    ds.BitsStored = 12
    ds.HighBit = 11
    ds.PixelRepresentation = 0
    arr = ((np.arange(64 * 64).reshape(64, 64) % 200) + k * 500).astype(np.uint16)
    ds.PixelData = arr.tobytes()
    ds.add_new((0x0011, 0x0010), "LO", "ACME 1.0")
    ds.add_new((0x0011, 0x1001), "LO", "secret-patient-hash")
    ref = Dataset()
    ref.ReferencedSOPClassUID = MRImageStorage
    ref.ReferencedSOPInstanceUID = ref_sop
    ds.ReferencedImageSequence = [ref]
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = MRImageStorage
    meta.MediaStorageSOPInstanceUID = sop_uid
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    meta.SourceApplicationEntityTitle = "HOSP_PACS"
    ds.file_meta = meta
    return ds


def jpeg_dicom(path: Path) -> None:
    img = brain_image(9, 64)
    frame = jpeg_bytes(img, 90)
    ds = Dataset()
    ds.SOPClassUID = SecondaryCaptureImageStorage
    ds.SOPInstanceUID = UID_ROOT + "9001"
    ds.StudyInstanceUID = UID_ROOT + "9002"
    ds.SeriesInstanceUID = UID_ROOT + "9003"
    ds.PatientName = "Black^Joe"
    ds.PatientID = "PID777"
    ds.Modality = "OT"
    ds.SeriesNumber = 7
    ds.InstanceNumber = 1
    ds.Rows = 64
    ds.Columns = 64
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.BitsAllocated = 8
    ds.BitsStored = 8
    ds.HighBit = 7
    ds.PixelRepresentation = 0
    ds.PixelData = encapsulate([frame])
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = SecondaryCaptureImageStorage
    meta.MediaStorageSOPInstanceUID = ds.SOPInstanceUID
    meta.TransferSyntaxUID = JPEGBaseline8Bit
    ds.file_meta = meta
    ds.save_as(str(path), enforce_file_format=True)


def emf_bytes() -> bytes:
    header = struct.pack(
        "<II4i4i4sIIIHHIII2i2i",
        1, 108, 0, 0, 99, 99, 0, 0, 2000, 2000, b" EMF", 0x10000, 128, 2, 1, 0, 0, 0, 0, 1024, 768, 320, 240,
    )
    header += b"\x00" * (108 - len(header))
    eof = struct.pack("<IIIII", 14, 20, 0, 16, 20)
    return header + eof


def animated_gif() -> bytes:
    frames = [brain_image(20 + i, 96).convert("P") for i in range(3)]
    buf = io.BytesIO()
    frames[0].save(buf, format="GIF", save_all=True, append_images=frames[1:], duration=100, loop=0)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Corpus + pipeline fixtures
# ---------------------------------------------------------------------------


@dataclass
class Corpus:
    root: Path
    src: Path
    files: dict[str, Path] = field(default_factory=dict)
    media: dict[str, bytes] = field(default_factory=dict)
    dicom: dict[str, object] = field(default_factory=dict)

    def sid(self, key: str) -> str:
        return sha(self.files[key].read_bytes())[:16]


def build_corpus(root: Path) -> Corpus:
    src = root / "SRC"
    src.mkdir(parents=True)
    c = Corpus(root=root, src=src)
    img_a = png_bytes(brain_image(1))
    img_b = png_bytes(brain_image(2))
    tif_c = tiff_bytes(brain_image(4, 128))
    img_a_jpeg = jpeg_bytes(brain_image(1).resize((200, 200), Image.Resampling.LANCZOS), 85)
    c.media.update(img_a=img_a, img_b=img_b, tif_c=tif_c, img_a_jpeg=img_a_jpeg)

    c.files["deck_a"] = src / "Smith_John_MRN12345678_lecture.pptx"
    build_deck_a(c.files["deck_a"], img_a, img_b, tif_c)
    (src / "talks").mkdir()
    c.files["deck_b"] = src / "talks" / "Doe-Jane-followup-talk.pptx"
    build_deck_b(c.files["deck_b"], img_a, img_a_jpeg)

    tif16 = Image.fromarray((np.asarray(brain_image(5, 96), dtype=np.uint16) * 200).astype(np.uint16))
    c.media["tif16"] = tiff_bytes(tif16)
    c.files["tiff"] = src / "Roe_Richard_scan.tif"
    c.files["tiff"].write_bytes(c.media["tif16"])

    exif = Image.Exif()
    exif[0x013B] = "Photographer Name"
    exif[0x0132] = "2024:01:15 10:00:00"
    gps = exif.get_ifd(0x8825)
    gps[1] = "N"
    gps[2] = (43.0, 39.0, 0.0)
    c.media["phone_jpeg"] = jpeg_bytes(brain_image(11, 160).convert("RGB"), 90, exif=exif)
    c.files["phone"] = src / "IMG_Brown_phone.jpg"
    c.files["phone"].write_bytes(c.media["phone_jpeg"])

    pdf_img = brain_image(6, 128)
    c.media["pdf_jpeg"] = jpeg_bytes(pdf_img, 88)
    flate_img = brain_image(7, 120)
    c.media["pdf_flate_raw"] = flate_img.tobytes()
    c.files["pdf"] = src / "Lecture_Notes_Patient_Brown.pdf"
    build_pdf(c.files["pdf"], c.media["pdf_jpeg"], 128, 128, c.media["pdf_flate_raw"], 120, 120)

    c.files["emf"] = src / "diagram_Smith_figure.emf"
    c.files["emf"].write_bytes(emf_bytes())
    c.files["gif"] = src / "cine_Green_loop.gif"
    c.files["gif"].write_bytes(animated_gif())
    c.files["video"] = src / "clip_Green_run.mp4"
    c.files["video"].write_bytes(b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 64)

    mr_dir = src / "Doe_Jane_MR"
    mr_dir.mkdir()
    uids = {"study": UID_ROOT + "1001", "series": UID_ROOT + "1002", "for": UID_ROOT + "1003"}
    zs = [0.0, 5.0, 10.0, 15.0]
    instance_numbers = [3, 1, 4, 2]  # InstanceNumber order differs from geometric order
    sops = [UID_ROOT + f"20{k}" for k in range(4)]
    for k in reversed(range(4)):
        ds = mr_slice(k, zs[k], instance_numbers[k], sops[k], sops[0], uids)
        path = mr_dir / f"IM_Doe_{k:04d}.dcm"
        ds.save_as(str(path), enforce_file_format=True)
        c.files[f"mr{k}"] = path
    c.dicom.update(uids=uids, sops=sops, zs=zs, instance_numbers=instance_numbers)

    jdir = src / "Jpeg_Series_Patient_Black"
    jdir.mkdir()
    c.files["jpeg_dicom"] = jdir / "IM1.dcm"
    jpeg_dicom(c.files["jpeg_dicom"])

    (src / ".DS_Store").write_bytes(b"junk")
    c.files["rights"] = root / "rights.csv"
    tif_sha = sha(c.media["tif16"])[:12]
    c.files["rights"].write_text(
        "match,commercialUseStatus,note\n"
        "Smith_John_MRN12345678_lecture.pptx,cleared,own lecture\n"
        f"{tif_sha},restricted,journal figure\n",
        encoding="utf-8",
    )
    c.files["institutions"] = root / "institutions.txt"
    c.files["institutions"].write_text("# local institutions\nExample General Hospital\n", encoding="utf-8")
    return c


@dataclass
class Pipeline:
    corpus: Corpus
    qdir: Path
    out: Path
    deriv: Path
    inventory: dict
    derivatives: dict


@pytest.fixture(scope="session")
def corpus(tmp_path_factory) -> Corpus:
    return build_corpus(tmp_path_factory.mktemp("corpus"))


@pytest.fixture(scope="session")
def pipeline(corpus: Corpus) -> Pipeline:
    import json

    root = corpus.root
    qdir, out, deriv = root / "QDIR", root / "OUT", root / "DERIV"
    assert cli_main(["-q", "quarantine", str(corpus.src), "--quarantine", str(qdir)]) == 0
    assert cli_main([
        "-q", "inventory", str(corpus.src), "--out", str(out),
        "--rights-map", str(corpus.files["rights"]), "--institutions", str(corpus.files["institutions"]),
    ]) == 0
    assert cli_main([
        "-q", "extract", str(qdir), "--out", str(deriv), "--render-png", "--no-ocr",
        "--institutions", str(corpus.files["institutions"]),
    ]) == 0
    inventory = json.loads((out / "inventory.json").read_text())
    derivatives = json.loads((deriv / "derivatives.json").read_text())
    return Pipeline(corpus, qdir, out, deriv, inventory, derivatives)


def find_row(inventory: dict, source_id: str, locator: str) -> dict:
    for row in inventory["rows"]:
        if row["sourceFileId"] == source_id and row["locator"] == locator:
            return row
    raise AssertionError(f"row {source_id} {locator} not found")


def dicom_row(inventory: dict, modality: str) -> dict:
    rows = [r for r in inventory["rows"] if r["kind"] == "dicom_series" and r["modalityHint"] == modality]
    assert len(rows) == 1, rows
    return rows[0]
