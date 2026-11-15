"""Duplicate detection and suggested case families.

Rows (slides/pages/images/series) are joined into one family when they share an identical
image (same SHA-256), a near-identical image (perceptual dHash + aHash with an aspect-ratio
check), or the same DICOM study/patient. Union-find makes the grouping transitive, so a
family is never split. Low-information images (blank, tiny) and images repeated on many
rows (logos, decorations) are ignored for grouping so they cannot merge unrelated cases.
"""

from __future__ import annotations

from collections import defaultdict

from ingest.images import hamming
from ingest.model import ImageInfo, Unit
from ingest.util import short_hash

DHASH_MAX = 14  # of 256 bits
AHASH_MAX = 24  # of 256 bits
ASPECT_TOLERANCE = 0.05
MIN_LINK_DIMENSION = 64
MAX_REPEAT_ROWS = 6


class UnionFind:
    def __init__(self, items):
        self.parent = {i: i for i in items}

    def find(self, x):
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a, b) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            if rb < ra:
                ra, rb = rb, ra
            self.parent[rb] = ra

    def groups(self) -> dict[str, list[str]]:
        out: dict[str, list[str]] = defaultdict(list)
        for item in self.parent:
            out[self.find(item)].append(item)
        return out


def _display_dims(info: ImageInfo) -> tuple[int, int] | None:
    if not info.width or not info.height:
        return None
    if info.exif_orientation in (5, 6, 7, 8):
        return info.height, info.width
    return info.width, info.height


def linkable(info: ImageInfo) -> bool:
    dims = _display_dims(info)
    if not info.decodable or not info.dhash or not info.ahash or dims is None:
        return False
    if min(dims) < MIN_LINK_DIMENSION:
        return False
    bits = bin(int(info.dhash, 16)).count("1")
    return 0.08 * 256 <= bits <= 0.92 * 256


def near_duplicate(a: ImageInfo, b: ImageInfo) -> bool:
    da, db = _display_dims(a), _display_dims(b)
    if da is None or db is None or not (a.dhash and b.dhash and a.ahash and b.ahash):
        return False
    ra, rb = da[0] / da[1], db[0] / db[1]
    if abs(ra - rb) / max(ra, rb) > ASPECT_TOLERANCE:
        return False
    return hamming(a.dhash, b.dhash) <= DHASH_MAX and hamming(a.ahash, b.ahash) <= AHASH_MAX


def compute_families(units: list[Unit]) -> tuple[dict[str, str], list[dict], dict[str, list[str]]]:
    """Return (row_id -> family_id, family descriptions, row_id -> notes)."""
    rows = [u for u in units if u.images or u.kind == "dicom_series"]
    row_notes: dict[str, list[str]] = defaultdict(list)
    if not rows:
        return {}, [], row_notes
    uf = UnionFind([u.row_id for u in rows])
    reasons: dict[tuple[str, str], set[str]] = defaultdict(set)

    sha_rows: dict[str, set[str]] = defaultdict(set)
    for u in rows:
        for img in u.images:
            sha_rows[img.sha256].add(u.row_id)
    decoration = {sha for sha, rs in sha_rows.items() if len(rs) > MAX_REPEAT_ROWS}

    candidates = []
    for u in rows:
        for img in u.images:
            if img.sha256 in decoration:
                row_notes[u.row_id].append(
                    f"image {img.index + 1} repeats on {len(sha_rows[img.sha256])} rows: ignored for family grouping (likely logo/decoration)"
                )
                continue
            if not linkable(img.info):
                continue
            candidates.append((u.row_id, img))

    def link(a: str, b: str, why: str) -> None:
        if a == b:
            return
        uf.union(a, b)
        reasons[tuple(sorted((a, b)))].add(why)

    by_sha: dict[str, list[str]] = defaultdict(list)
    for row_id, img in candidates:
        by_sha[img.sha256].append(row_id)
    for row_ids in by_sha.values():
        for other in row_ids[1:]:
            link(row_ids[0], other, "identical image bytes")
    for i in range(len(candidates)):
        ra, ia = candidates[i]
        for j in range(i + 1, len(candidates)):
            rb, ib = candidates[j]
            if ra == rb or ia.sha256 == ib.sha256:
                continue
            if near_duplicate(ia.info, ib.info):
                link(ra, rb, "near-identical images (perceptual hash)")

    by_key: dict[str, list[str]] = defaultdict(list)
    for u in rows:
        for key in u.group_keys:
            by_key[key].append(u.row_id)
    for key, row_ids in by_key.items():
        why = "same DICOM study" if key.startswith("study:") else "same DICOM patient"
        for other in row_ids[1:]:
            link(row_ids[0], other, why)

    row_family: dict[str, str] = {}
    families = []
    for _root, members in uf.groups().items():
        members = sorted(members)
        family_id = "fam-" + short_hash(members[0], 12)
        for m in members:
            row_family[m] = family_id
        why = sorted({w for pair, ws in reasons.items() if pair[0] in members for w in ws})
        families.append({"caseFamilyId": family_id, "rowIds": members, "reasons": why or ["single row"]})
    families.sort(key=lambda f: f["caseFamilyId"])
    return row_family, families, row_notes
