"""Preserve bounded synthetic test evidence in workflow logs, without paid artifact storage."""
import base64
import hashlib
import io
import json
from pathlib import Path
import re
import tarfile

root = Path(__file__).resolve().parents[1]
archive = io.BytesIO()
total = 0
count = 0
entries = []
with tarfile.open(fileobj=archive, mode="w:gz") as bundle:
    for directory in [root / ".verification", root / "apps/web/test-results"]:
        if not directory.exists():
            continue
        for path in sorted(directory.rglob("*")):
            if not path.is_file() or path.is_symlink() or path.suffix not in {".json", ".png", ".jpg", ".jpeg", ".md", ".log"}:
                continue
            data = path.read_bytes()
            if path.suffix not in {".png", ".jpg", ".jpeg"}:
                text = data.decode("utf-8")
                text = re.sub(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "[redacted-jwt]", text)
                text = re.sub(r"/turno/[a-f0-9]{32,128}", "/turno/[redacted]", text)
                text = re.sub(r"([?&]token=)[^\s\"'<>]+", r"\1[redacted]", text)
                data = text.encode()
            entries.append({"path": str(path.relative_to(root)), "bytes": len(data)})
            total += len(data)
            count += 1
            if total > 48 * 1024 ** 2 or count > 2000:
                raise RuntimeError("Evidence exceeded its explicit size budget; nothing was silently omitted.")
            member = tarfile.TarInfo(str(path.relative_to(root)))
            member.size = len(data)
            member.mode = 0o600
            bundle.addfile(member, io.BytesIO(data))
if count == 0:
    raise RuntimeError("No verification evidence was generated.")
data = archive.getvalue()
print("CITA_EVIDENCE_BUDGET " + json.dumps({"rawBytes": total, "compressedBytes": len(data), "files": count, "largest": sorted(entries, key=lambda row: row["bytes"], reverse=True)[:12]}))
if len(data) > 24 * 1024 ** 2:
    raise RuntimeError("Compressed evidence exceeded the workflow log budget.")
print("CITA_EVIDENCE_SHA256 " + hashlib.sha256(data).hexdigest())
encoded = base64.b64encode(data).decode("ascii")
for offset in range(0, len(encoded), 4096):
    print("CITA_EVIDENCE_CHUNK " + encoded[offset:offset + 4096])
print(f"CITA_EVIDENCE_COMPLETE {count} {total}")
