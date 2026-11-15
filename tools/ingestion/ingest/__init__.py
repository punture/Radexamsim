"""sim-ingest: restricted, local ingestion and de-identification tool for teaching cases.

The tool never approves anything. It can only bring material to privacy status
"checked" (automated checks done) or leave it in "quarantine"; the case owner
approves in the web app.
"""

TOOL_NAME = "sim-ingest"
__version__ = "0.1.0"
