"""``quarantine`` command: restricted, content-addressed copy of the untouched sources.

Layout (directories 0700, files 0600)::

    QDIR/
      manifest.json            sha256 -> original relative path(s)   (RESTRICTED)
      README-RESTRICTED.txt
      objects/ab/<sha256>.<ext> untouched source bytes
      uid-key, uid-map.json    created later by `extract` (DICOM UID key / map)

The manifest contains original paths (which may contain identifiers). QDIR must stay
local: never commit it, never put it in a cloud-synced folder, never upload it.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

from ingest.analysis import QUARANTINE_FORMAT, load_quarantine_manifest
from ingest.detect import detect_type
from ingest.util import (
    IngestError,
    copy_private,
    ensure_private_dir,
    is_within,
    iter_source_files,
    location_warnings,
    sha256_file,
    tool_info,
    utc_now_iso,
    write_private_bytes,
    write_private_json,
)

NOTICE = """RESTRICTED - UNTOUCHED TEACHING SOURCES

This directory holds exact copies of the case owner's source files, named by SHA-256,
and manifest.json, which maps each digest to its ORIGINAL RELATIVE PATH. File names,
slide text and pixels may contain patient identifiers.

  * Keep it on this computer only. Do not commit it to git, do not place it in a
    cloud-synced folder (Dropbox, OneDrive, iCloud, Google Drive, Box ...), do not
    upload it or send any of it to an external AI service or cloud tool.
  * Directories are 0700 and files 0600; do not loosen these permissions.
  * Delete it securely when the teaching cases have been approved and imported.
"""


def _ext(path: Path) -> str:
    ext = path.suffix.lower().lstrip(".")
    return ext if re.fullmatch(r"[a-z0-9]{1,8}", ext) else "bin"


def enforce_permissions(qdir: Path) -> None:
    for dirpath, dirnames, filenames in os.walk(qdir):
        os.chmod(dirpath, 0o700)
        for name in filenames:
            p = Path(dirpath) / name
            if not p.is_symlink():
                os.chmod(p, 0o600)


def run_quarantine(src_dir: Path, qdir: Path, progress=None) -> dict[str, Any]:
    src_dir, qdir = Path(src_dir), Path(qdir)
    if not src_dir.is_dir():
        raise IngestError("SRC_DIR does not exist or is not a directory")
    if is_within(qdir, src_dir):
        raise IngestError("--quarantine must not be inside SRC_DIR")
    if is_within(src_dir, qdir):
        raise IngestError("SRC_DIR must not be inside the quarantine directory")
    if qdir.exists() and any(qdir.iterdir()) and load_quarantine_manifest(qdir) is None:
        raise IngestError("--quarantine exists, is not empty and is not a sim-ingest quarantine")
    ensure_private_dir(qdir)
    ensure_private_dir(qdir / "objects")
    manifest = load_quarantine_manifest(qdir) or {
        "format": QUARANTINE_FORMAT,
        "createdAt": utc_now_iso(),
        "tool": tool_info(),
        "warning": "RESTRICTED: maps digests to original file paths that may contain identifiers. Keep local; never commit, sync or upload.",
        "files": {},
    }
    files, skipped = iter_source_files(src_dir)
    stats = {"copied": 0, "alreadyPresent": 0, "repaired": 0, "files": len(files), "skipped": skipped}
    now = utc_now_iso()
    for n, path in enumerate(files, start=1):
        if progress:
            progress(f"[{n}/{len(files)}] quarantining")
        rel = path.relative_to(src_dir).as_posix()
        sha = sha256_file(path)
        stored = Path("objects") / sha[:2] / f"{sha}.{_ext(path)}"
        entry = manifest["files"].get(sha)
        if entry:
            stored = Path(entry["storedAs"])
        target = qdir / stored
        if target.is_file() and sha256_file(target) == sha:
            stats["alreadyPresent"] += 1
        else:
            if target.exists():
                stats["repaired"] += 1
            written = copy_private(path, target)
            if written != sha:
                raise IngestError(f"source {sha[:16]} changed while it was being copied; re-run")
            stats["copied"] += 1
        if entry is None:
            entry = {
                "originalRelativePaths": [],
                "storedAs": stored.as_posix(),
                "byteSize": path.stat().st_size,
                "detectedType": detect_type(target),
                "addedAt": now,
            }
            manifest["files"][sha] = entry
        if rel not in entry["originalRelativePaths"]:
            entry["originalRelativePaths"].append(rel)
    manifest["updatedAt"] = now
    write_private_json(qdir / "manifest.json", manifest)
    write_private_bytes(qdir / "README-RESTRICTED.txt", NOTICE.encode("utf-8"))
    enforce_permissions(qdir)
    stats["warnings"] = location_warnings(qdir)
    stats["objects"] = len(manifest["files"])
    return stats


def read_manifest(qdir: Path) -> dict[str, Any]:
    manifest = load_quarantine_manifest(qdir)
    if manifest is None:
        raise IngestError("not a sim-ingest quarantine directory (manifest.json missing); run `quarantine` first")
    return manifest
