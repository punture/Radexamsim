"""Optional OCR of pixel text via a locally installed ``tesseract`` binary.

There is no OCR unless tesseract is installed. OCR is a HELP, not proof: a clean OCR
result does not prove there is no burned-in text. OCR text is never written anywhere;
only pattern findings (without the matched values) are reported.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from ingest.model import Finding
from ingest.phi import scan_text

PIXEL_TEXT_NOT_CHECKED = "pixel text not checked: tesseract (OCR) is not installed"


def tesseract_path() -> str | None:
    return shutil.which("tesseract")


def ocr_status(enabled: bool = True) -> dict[str, object]:
    path = tesseract_path() if enabled else None
    if not enabled:
        return {"available": False, "engine": None, "note": "pixel text not checked: OCR disabled (--no-ocr)"}
    if not path:
        return {"available": False, "engine": None, "note": PIXEL_TEXT_NOT_CHECKED}
    version = "tesseract"
    try:
        res = subprocess.run([path, "--version"], capture_output=True, text=True, timeout=20, check=False)
        first = (res.stdout or res.stderr).strip().splitlines()
        if first:
            version = first[0][:60]
    except (OSError, subprocess.SubprocessError):
        pass
    return {
        "available": True,
        "engine": version,
        "note": "OCR run on derivative images; OCR is not proof that no burned-in text exists",
    }


def run_ocr(image_bytes: bytes, suffix: str = ".png", timeout: int = 120) -> str | None:
    """OCR one image. Returns the text (kept in memory only) or None if OCR failed."""
    path = tesseract_path()
    if not path:
        return None
    with tempfile.TemporaryDirectory(prefix="sim-ingest-ocr-") as tmp:
        os.chmod(tmp, 0o700)
        img_path = Path(tmp) / f"frame{suffix}"
        fd = os.open(img_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(image_bytes)
        env = dict(os.environ, OMP_THREAD_LIMIT="1")
        try:
            res = subprocess.run(
                [path, str(img_path), "stdout", "--psm", "11"],
                capture_output=True,
                timeout=timeout,
                check=False,
                env=env,
            )
        except (OSError, subprocess.SubprocessError):
            return None
        if res.returncode != 0:
            return None
        return res.stdout.decode("utf-8", errors="replace")


def ocr_findings(text: str | None, location: str, institutions: list[str] | tuple[str, ...] = ()) -> list[Finding]:
    if text is None:
        return [Finding("medium", location, "OCR failed on this image; pixel text not checked", "ocr", "content")]
    found = scan_text(text, location, institutions=institutions, scope="content", category="ocr", what="OCR pixel text")
    for f in found:
        if f.severity != "low":
            f.severity = "high"  # identifier-like text burned into pixels
    words = re.findall(r"[A-Za-z0-9]{3,}", text)
    if found:
        return found
    if len(words) >= 2:
        return [
            Finding(
                "medium",
                location,
                f"OCR detected text in pixels ({len(words)} word-like tokens): possible burned-in annotation",
                "ocr",
                "content",
            )
        ]
    return [Finding("low", location, "OCR found no text (OCR is not proof that no burned-in text exists)", "ocr", "content")]
