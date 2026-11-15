"""End-to-end checks: isolated-mode CLI, and no original file names anywhere in outputs."""

import json
import subprocess
import sys
from pathlib import Path

from conftest import find_row


def original_names(corpus):
    names = set()
    for path in corpus.src.rglob("*"):
        rel = path.relative_to(corpus.src)
        for part in rel.parts:
            names.add(part)
            names.add(Path(part).stem)
    names.discard(".DS_Store")
    names.discard("talks")  # a generic folder name, not identifying
    return {n for n in names if len(n) >= 6}


def test_no_original_filenames_in_outputs(pipeline, tmp_path):
    from ingest.cli import main as cli_main

    fam = find_row(pipeline.inventory, pipeline.corpus.sid("deck_a"), "slide 1")["suggestedCaseFamilyId"]
    pkg = tmp_path / "pkg"
    assert cli_main(["-q", "package", "--family", fam, "--inventory", str(pipeline.out / "inventory.json"),
                     "--derivatives", str(pipeline.deriv / "derivatives.json"), "--out", str(pkg)]) == 0
    texts = {
        "inventory.json": (pipeline.out / "inventory.json").read_text(),
        "inventory.csv": (pipeline.out / "inventory.csv").read_text(),
        "derivatives.json": (pipeline.deriv / "derivatives.json").read_text(),
        "case-import.json": (pkg / "case-import.json").read_text(),
    }
    names = original_names(pipeline.corpus)
    assert "Smith_John_MRN12345678_lecture" in names and "Doe-Jane-followup-talk.pptx" in names
    for label, text in texts.items():
        for name in names:
            assert name not in text, f"{name} leaked into {label}"
            assert name.lower() not in text.lower(), f"{name} leaked into {label} (case-insensitive)"
    # derivative and package file names are opaque too
    for path in [*pipeline.deriv.rglob("*"), *pkg.rglob("*")]:
        assert not any(n in path.name for n in names)


def test_isolated_mode_entry_point(pipeline, tmp_path):
    """The README tells owners to run `python -I -m ingest`; make sure that works."""
    res = subprocess.run([sys.executable, "-I", "-m", "ingest", "--version"], capture_output=True, text=True, cwd=tmp_path)
    assert res.returncode == 0 and "sim-ingest" in res.stdout
    out = tmp_path / "inv"
    res = subprocess.run(
        [sys.executable, "-I", "-m", "ingest", "inventory", str(pipeline.corpus.src), "--out", str(out)],
        capture_output=True, text=True, cwd=tmp_path,
    )
    assert res.returncode == 0, res.stderr
    combined = res.stdout + res.stderr
    for name in original_names(pipeline.corpus):
        assert name not in combined  # terminal output uses opaque ids only
    inv = json.loads((out / "inventory.json").read_text())
    assert inv["summary"]["rows"] == len(pipeline.inventory["rows"])


def test_outputs_are_private(pipeline):
    import stat

    for root in (pipeline.out, pipeline.deriv):
        assert stat.S_IMODE(root.stat().st_mode) == 0o700
        for p in root.rglob("*"):
            expected = 0o700 if p.is_dir() else 0o600
            assert stat.S_IMODE(p.stat().st_mode) == expected, p.name
