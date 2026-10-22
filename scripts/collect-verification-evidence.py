"""Recover a verified evidence archive from a downloaded GitHub Actions log ZIP."""
import base64
import hashlib
import io
from pathlib import Path, PurePosixPath
import re
import sys
import tarfile
import zipfile

if len(sys.argv) != 3:
    raise SystemExit("Usage: collect-verification-evidence.py workflow-logs.zip output-directory")
source = Path(sys.argv[1])
destination = Path(sys.argv[2]).resolve()
if destination.exists():
    raise SystemExit("Evidence destination must be new; existing results will not be overwritten.")
if source.stat().st_size > 64 * 1024 ** 2:
    raise SystemExit("Workflow logs exceed their bounded download size.")
with zipfile.ZipFile(source) as logs:
    candidates = []
    for member in logs.infolist():
        if member.file_size > 64 * 1024 ** 2 or not member.filename.endswith(".txt"):
            continue
        text = logs.read(member).decode("utf-8")
        digest = re.search(r"CITA_EVIDENCE_SHA256 ([a-f0-9]{64})", text)
        complete = re.search(r"CITA_EVIDENCE_COMPLETE (\d+) (\d+)", text)
        if digest and complete:
            encoded = "".join(re.findall(r"CITA_EVIDENCE_CHUNK ([A-Za-z0-9+/=]+)", text))
            data = base64.b64decode(encoded, validate=True)
            if len(data) > 24 * 1024 ** 2 or hashlib.sha256(data).hexdigest() != digest[1]:
                raise RuntimeError("Workflow evidence checksum mismatch.")
            candidates.append((digest[1], data))
    unique = {digest: data for digest, data in candidates}
    if len(unique) != 1:
        raise RuntimeError("A single complete verified evidence bundle is required.")
    digest, data = next(iter(unique.items()))
with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as bundle:
    members = bundle.getmembers()
    if len(members) > 2000 or sum(m.size for m in members) > 48 * 1024 ** 2:
        raise RuntimeError("Extracted evidence exceeded its size budget.")
    for member in members:
        path = PurePosixPath(member.name)
        if not member.isfile() or path.is_absolute() or ".." in path.parts:
            raise RuntimeError("Unsafe evidence archive member.")
        if not (member.name.startswith(".verification/") or member.name.startswith("apps/web/test-results/")):
            raise RuntimeError("Unexpected evidence path.")
    destination.mkdir(parents=True)
    for member in members:
        path = destination / member.name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(bundle.extractfile(member).read())
print(f"Recovered {len(members)} evidence files; SHA-256 {digest}")
