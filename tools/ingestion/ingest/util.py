"""Small shared helpers: hashing, slugs, restricted file writes, timestamps."""

from __future__ import annotations

import contextlib
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Iterator

from ingest import TOOL_NAME, __version__

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,79}$")
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
SOURCE_ID_LEN = 16

PRIVATE_DIR_MODE = 0o700
PRIVATE_FILE_MODE = 0o600

# Operating-system clutter that is never treated as a teaching source.
JUNK_NAMES = {".ds_store", "thumbs.db", "desktop.ini", "icon\r"}

CLOUD_SYNC_MARKERS = (
    "dropbox",
    "onedrive",
    "google drive",
    "googledrive",
    "icloud drive",
    "iclouddrive",
    "mobile documents",
    "box sync",
    "pcloud drive",
    "nextcloud",
    "owncloud",
    "sync.com",
)


class IngestError(Exception):
    """A user-facing error. The message must never contain original file names."""


def tool_info() -> dict[str, str]:
    return {"name": TOOL_NAME, "version": __version__}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def source_id(sha: str) -> str:
    """Opaque source id: a prefix of the SHA-256 of the exact source bytes."""
    return sha[:SOURCE_ID_LEN]


def short_hash(text: str, n: int = 12) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:n]


def slugify(text: str, max_len: int = 80, fallback: str = "item") -> str:
    s = re.sub(r"[^a-z0-9_-]+", "-", str(text).lower())
    s = re.sub(r"-{2,}", "-", s)
    s = re.sub(r"^[^a-z0-9]+", "", s)
    s = s[:max_len].rstrip("-_")
    if not s or not SLUG_RE.match(s):
        return fallback
    return s


def is_slug(text: object) -> bool:
    return isinstance(text, str) and bool(SLUG_RE.match(text))


def utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def locator_number(locator: str) -> int:
    m = re.search(r"(\d+)", locator or "")
    return int(m.group(1)) if m else 0


@contextlib.contextmanager
def restrictive_umask() -> Iterator[None]:
    old = os.umask(0o077)
    try:
        yield
    finally:
        os.umask(old)


def ensure_private_dir(path: Path) -> Path:
    path = Path(path)
    path.mkdir(mode=PRIVATE_DIR_MODE, parents=True, exist_ok=True)
    os.chmod(path, PRIVATE_DIR_MODE)
    return path


def write_private_bytes(path: Path, data: bytes) -> None:
    """Atomically write ``data`` to ``path`` with mode 0600 (temp file + rename)."""
    path = Path(path)
    ensure_private_dir(path.parent)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=".part")
    try:
        os.fchmod(fd, PRIVATE_FILE_MODE)
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(tmp)
        raise
    os.chmod(path, PRIVATE_FILE_MODE)


def json_dumps(obj: Any) -> str:
    return json.dumps(obj, indent=2, ensure_ascii=False) + "\n"


def write_private_json(path: Path, obj: Any) -> None:
    write_private_bytes(path, json_dumps(obj).encode("utf-8"))


def copy_private(src: Path, dst: Path) -> str:
    """Copy ``src`` to ``dst`` (mode 0600, atomic); return SHA-256 of the bytes written."""
    dst = Path(dst)
    ensure_private_dir(dst.parent)
    h = hashlib.sha256()
    fd, tmp = tempfile.mkstemp(dir=dst.parent, prefix=".tmp-", suffix=".part")
    try:
        os.fchmod(fd, PRIVATE_FILE_MODE)
        with os.fdopen(fd, "wb") as out, open(src, "rb") as inp:
            for chunk in iter(lambda: inp.read(1 << 20), b""):
                h.update(chunk)
                out.write(chunk)
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, dst)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(tmp)
        raise
    os.chmod(dst, PRIVATE_FILE_MODE)
    return h.hexdigest()


def is_within(child: Path, parent: Path) -> bool:
    try:
        Path(child).resolve().relative_to(Path(parent).resolve())
        return True
    except ValueError:
        return False


def is_junk_name(name: str) -> bool:
    low = name.lower()
    return (
        low in JUNK_NAMES
        or name.startswith(".")
        or name.startswith("~$")
        or name.endswith((".tmp", ".part"))
    )


def iter_source_files(root: Path) -> tuple[list[Path], dict[str, int]]:
    """Regular files under ``root`` in a stable order; symlinks and OS clutter are skipped.

    Symlinks are never followed so a source tree cannot pull files from elsewhere.
    """
    root = Path(root)
    files: list[Path] = []
    skipped = {"symlinks": 0, "hidden_or_junk": 0, "special": 0}
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        keep_dirs = []
        for d in sorted(dirnames):
            full = Path(dirpath) / d
            if full.is_symlink():
                skipped["symlinks"] += 1
            elif d.startswith(".") or d == "__MACOSX":
                skipped["hidden_or_junk"] += 1
            else:
                keep_dirs.append(d)
        dirnames[:] = keep_dirs
        for name in sorted(filenames):
            full = Path(dirpath) / name
            if full.is_symlink():
                skipped["symlinks"] += 1
                continue
            if is_junk_name(name):
                skipped["hidden_or_junk"] += 1
                continue
            if not full.is_file():
                skipped["special"] += 1
                continue
            files.append(full)
    files.sort(key=lambda p: p.relative_to(root).as_posix())
    return files, skipped


def location_warnings(path: Path) -> list[str]:
    """Warn when a restricted directory sits in a cloud-sync folder or an un-ignored git tree."""
    warnings: list[str] = []
    resolved = Path(path).resolve()
    lowered = [part.lower() for part in resolved.parts]
    if any(marker in part for part in lowered for marker in CLOUD_SYNC_MARKERS):
        warnings.append(
            "the directory appears to be inside a cloud-sync folder; restricted material must stay local"
        )
    git_root = None
    for parent in [resolved, *resolved.parents]:
        if (parent / ".git").exists():
            git_root = parent
            break
    if git_root is not None:
        try:
            res = subprocess.run(
                ["git", "-C", str(git_root), "check-ignore", "-q", str(resolved)],
                capture_output=True,
                timeout=20,
                check=False,
            )
            if res.returncode == 1:
                warnings.append(
                    "the directory is inside a git working tree and is NOT git-ignored; add it to .gitignore"
                )
            elif res.returncode not in (0, 1):
                warnings.append("the directory is inside a git working tree; could not confirm it is git-ignored")
        except (OSError, subprocess.SubprocessError):
            warnings.append("the directory is inside a git working tree; could not confirm it is git-ignored")
    return warnings
