"""Exercise evidence recovery using disposable files, including hostile archives."""
import base64
import hashlib
import io
import json
import random
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest
import zipfile

SCRIPTS = Path(__file__).resolve().parent


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="cita-evidence-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "scripts").mkdir()
        shutil.copy(SCRIPTS / "package-verification-evidence.py", self.root / "scripts")

    def collect(self, content, name="result"):
        logs = self.root / (name + ".zip")
        with zipfile.ZipFile(logs, "w") as bundle:
            bundle.writestr("job.txt", content)
        return subprocess.run(["python3", str(SCRIPTS / "collect-verification-evidence.py"),
                               str(logs), str(self.root / name)], capture_output=True, text=True)

    def test_round_trip_redacts_credentials_and_preserves_failed_status(self):
        (self.root / ".verification").mkdir()
        payload = {"ok": False, "token": "eyJabc.def.ghi", "link": "/turno/" + "a" * 64}
        (self.root / ".verification/failed.json").write_text(json.dumps(payload))
        jpeg = b"\xff\xd8\xff\xe0synthetic-binary-screenshot\xff\xd9"
        (self.root / ".verification/synthetic.jpg").write_bytes(jpeg)
        packed = subprocess.run(["python3", str(self.root / "scripts/package-verification-evidence.py")],
                                capture_output=True, text=True, check=True).stdout
        result = self.collect(packed)
        self.assertEqual(result.returncode, 0, result.stderr)
        recovered = json.loads((self.root / "result/.verification/failed.json").read_text())
        self.assertIs(recovered["ok"], False)
        self.assertEqual(recovered["token"], "[redacted-jwt]")
        self.assertEqual(recovered["link"], "/turno/[redacted]")
        self.assertEqual((self.root / "result/.verification/synthetic.jpg").read_bytes(), jpeg)
        self.assertNotEqual(self.collect(packed).returncode, 0, "must not overwrite prior evidence")
        corrupted = packed.replace("CITA_EVIDENCE_CHUNK ", "CITA_EVIDENCE_CHUNK A", 1)
        self.assertNotEqual(self.collect(corrupted, "corrupt").returncode, 0)
        self.assertFalse((self.root / "corrupt").exists())

    def test_large_bounded_binary_evidence_survives_round_trip(self):
        (self.root / ".verification").mkdir()
        # Deliberately incompressible synthetic bytes exercise the old 8 MiB
        # failure without a browser, network or native image dependency.
        data = random.Random(455).randbytes(9 * 1024 ** 2)
        (self.root / ".verification/synthetic.png").write_bytes(data)
        packed = subprocess.run(["python3", str(self.root / "scripts/package-verification-evidence.py")],
                                capture_output=True, text=True, check=True).stdout
        result = self.collect(packed)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / "result/.verification/synthetic.png").read_bytes(), data)
        self.assertIn("CITA_EVIDENCE_BUDGET", packed)

    def test_traversal_is_rejected_before_any_file_is_extracted(self):
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode="w:gz") as bundle:
            for name in [".verification/valid.json", ".verification/../../escaped.json"]:
                member = tarfile.TarInfo(name)
                member.size = 2
                bundle.addfile(member, io.BytesIO(b"{}"))
        archive = data.getvalue()
        content = "CITA_EVIDENCE_SHA256 " + hashlib.sha256(archive).hexdigest() + "\n"
        content += "CITA_EVIDENCE_CHUNK " + base64.b64encode(archive).decode() + "\n"
        content += "CITA_EVIDENCE_COMPLETE 2 4\n"
        self.assertNotEqual(self.collect(content).returncode, 0)
        self.assertFalse((self.root / "result").exists())
        self.assertFalse((self.root / "escaped.json").exists())

    def test_three_profiles_preserve_all_bounded_evidence(self):
        for profile in ["integration", "integration-artifact", "integration-rollback"]:
            directory = self.root / ".verification" / "runs" / "owned-run" / profile
            directory.mkdir(parents=True)
            (directory / "synthetic.log").write_text("x" * (12 * 1024 ** 2))
        packed = subprocess.run(["python3", str(self.root / "scripts/package-verification-evidence.py")],
                                capture_output=True, text=True, check=True).stdout
        result = self.collect(packed)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(list((self.root / "result").rglob("synthetic.log"))), 3)

    def test_evidence_still_rejects_an_excessive_payload(self):
        (self.root / ".verification").mkdir()
        with (self.root / ".verification/too-large.log").open("wb") as stream:
            stream.truncate(49 * 1024 ** 2)
        result = subprocess.run(["python3", str(self.root / "scripts/package-verification-evidence.py")],
                                capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("CITA_EVIDENCE_COMPLETE", result.stdout)

    def test_absent_evidence_cannot_be_packaged_as_success(self):
        result = subprocess.run(["python3", str(self.root / "scripts/package-verification-evidence.py")],
                                capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("CITA_EVIDENCE_COMPLETE", result.stdout)
        self.assertNotEqual(self.collect("unfinished log").returncode, 0)


if __name__ == "__main__":
    unittest.main()
