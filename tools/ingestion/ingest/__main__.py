"""Entry point for ``python -I -m ingest <command>``."""

import sys

from ingest.cli import main

if __name__ == "__main__":
    sys.exit(main())
