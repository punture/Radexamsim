"""Quarantine: untouched copies named by SHA-256, restricted permissions, manifest mapping."""

import hashlib
import json
import stat

import pytest

from ingest.cli import main as cli_main
from ingest.quarantine import run_quarantine
from ingest.util import IngestError


def mode(path):
    return stat.S_IMODE(path.stat().st_mode)


def test_quarantine_permissions_and_names(pipeline):
    q = pipeline.qdir
    assert mode(q) == 0o700
    dirs = [p for p in q.rglob("*") if p.is_dir()]
    files = [p for p in q.rglob("*") if p.is_file()]
    assert dirs and files
    assert all(mode(d) == 0o700 for d in dirs), [oct(mode(d)) for d in dirs]
    assert all(mode(f) == 0o600 for f in files), [(f.name, oct(mode(f))) for f in files]
    objects = [f for f in files if "objects" in f.parts]
    for obj in objects:
        digest = hashlib.sha256(obj.read_bytes()).hexdigest()
        assert obj.name.split(".")[0] == digest  # named by SHA-256 of the exact bytes


def test_manifest_maps_sha_to_original_paths(pipeline):
    corpus = pipeline.corpus
    manifest = json.loads((pipeline.qdir / "manifest.json").read_text())
    assert manifest["format"] == "sim-ingest-quarantine@1"
    by_path = {p: sha for sha, e in manifest["files"].items() for p in e["originalRelativePaths"]}
    for key in ("deck_a", "deck_b", "pdf", "tiff", "mr0", "jpeg_dicom"):
        rel = corpus.files[key].relative_to(corpus.src).as_posix()
        assert by_path[rel] == hashlib.sha256(corpus.files[key].read_bytes()).hexdigest()
        stored = pipeline.qdir / manifest["files"][by_path[rel]]["storedAs"]
        assert stored.read_bytes() == corpus.files[key].read_bytes()  # untouched copy
    assert ".DS_Store" not in by_path  # OS clutter is not a source
    assert (pipeline.qdir / "README-RESTRICTED.txt").is_file()


def test_quarantine_is_idempotent(pipeline, capsys):
    before = json.loads((pipeline.qdir / "manifest.json").read_text())
    stats = run_quarantine(pipeline.corpus.src, pipeline.qdir)
    after = json.loads((pipeline.qdir / "manifest.json").read_text())
    assert stats["copied"] == 0 and stats["alreadyPresent"] == stats["files"]
    assert before["files"].keys() == after["files"].keys()


def test_quarantine_refuses_inside_source(corpus, tmp_path):
    with pytest.raises(IngestError):
        run_quarantine(corpus.src, corpus.src / "q")
    assert cli_main(["-q", "quarantine", str(corpus.src), "--quarantine", str(corpus.src / "q")]) == 1
    assert not (corpus.src / "q").exists()


def test_warns_when_quarantine_is_tracked_by_git(corpus, tmp_path):
    import shutil
    import subprocess

    if not shutil.which("git"):
        pytest.skip("git not installed")
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    (repo / ".gitignore").write_text("quarantine/\n")
    ignored = run_quarantine(corpus.src, repo / "quarantine" / "q1")
    tracked = run_quarantine(corpus.src, repo / "q2")
    assert not any("git" in w for w in ignored["warnings"])
    assert any("NOT git-ignored" in w for w in tracked["warnings"])
    synced = run_quarantine(corpus.src, tmp_path / "Dropbox" / "q3")
    assert any("cloud-sync" in w for w in synced["warnings"])
