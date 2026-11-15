"""Fetch a Box folder tree into a local quarantine source directory (raw, untouched bytes).

For case archives the owner selected in Box. Each file is verified against Box's SHA-1. The
folder layout is kept, because intake groups images by case folder, and it stays inside the
git-ignored quarantine area. Output is counts only: no names, no paths.

Auth: a Box access token injected by the session's network proxy, or BOX_ACCESS_TOKEN.

  tools/ingestion/.venv/bin/python -I tools/ingestion/scripts/box_fetch_folder.py \
      --folder-id 123456 --dest quarantine/box-batch-1/src
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

API = "https://api.box.com/2.0"
DEFAULT_EXT = {"png", "jpg", "jpeg", "tif", "tiff", "dcm", "pptx", "pdf", "bmp", "gif"}


def get(url: str, raw: bool = False):
    req = urllib.request.Request(url)
    tok = os.environ.get("BOX_ACCESS_TOKEN")
    if tok:
        req.add_header("Authorization", f"Bearer {tok}")
    with urllib.request.urlopen(req, timeout=120) as r:  # follows the signed download redirect
        data = r.read()
    return data if raw else json.loads(data)


def items(folder_id: str):
    offset = 0
    while True:
        page = get(f"{API}/folders/{folder_id}/items?fields=id,type,name,size,sha1&limit=1000&offset={offset}")
        yield from page["entries"]
        offset += len(page["entries"])
        if offset >= page["total_count"] or not page["entries"]:
            return


def safe_part(name: str) -> str:
    bad = name in ("", ".", "..") or "/" in name or "\\" in name or "\x00" in name
    if bad:
        raise SystemExit("refusing an unsafe Box item name")
    return name


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--folder-id", required=True)
    ap.add_argument("--dest", type=Path, required=True)
    ap.add_argument("--max-files", type=int, default=2000)
    ap.add_argument("--ext", default=",".join(sorted(DEFAULT_EXT)))
    a = ap.parse_args()

    os.umask(0o077)
    dest = a.dest.resolve()
    # Refuse to write raw sources anywhere git would track.
    probe = subprocess.run(["git", "check-ignore", "-q", str(dest / "probe")], capture_output=True)
    if probe.returncode == 1:
        raise SystemExit("--dest is not git-ignored; raw sources must stay out of version control")
    exts = {e.strip().lower() for e in a.ext.split(",") if e.strip()}

    stack = [(a.folder_id, dest)]
    n = skipped = byte_total = 0
    while stack and n < a.max_files:
        fid, local = stack.pop()
        for it in items(fid):
            if it["type"] == "folder":
                stack.append((it["id"], local / safe_part(it["name"])))
            elif it["type"] == "file":
                name = safe_part(it["name"])
                if name.rsplit(".", 1)[-1].lower() not in exts:
                    skipped += 1
                    continue
                data = get(f"{API}/files/{it['id']}/content", raw=True)
                if it.get("sha1") and hashlib.sha1(data).hexdigest() != it["sha1"]:
                    raise SystemExit("checksum mismatch on a downloaded file; nothing further fetched")
                local.mkdir(parents=True, exist_ok=True)
                (local / name).write_bytes(data)
                n += 1
                byte_total += len(data)
                if n >= a.max_files:
                    break
    print(f"fetched {n} file(s), {byte_total / 1e6:.1f} MB, verified against Box SHA-1; skipped {skipped} other file(s)")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as e:
        sys.exit(f"Box API error {e.code}")
    except urllib.error.URLError as e:
        sys.exit(f"network error: {type(e.reason).__name__}")
