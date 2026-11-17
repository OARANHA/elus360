"""Offline regression for isolated schema rehearsal input gate."""
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/elus360-isolated-rehearsal-plan.py"
spec = importlib.util.spec_from_file_location("elus_rehearsal", SCRIPT)
assert spec and spec.loader
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class RehearsalInputGate(unittest.TestCase):
    def test_plan_never_claims_replay_or_database_access(self):
        run = subprocess.run([sys.executable, str(SCRIPT), "--mode", "plan"],
                             cwd=ROOT, capture_output=True, text=True, check=False)
        self.assertEqual(run.returncode, 0, run.stderr)
        info = json.loads(run.stdout)
        self.assertEqual(info["status"], "PLAN_ONLY_NO_REPLAY")
        self.assertEqual(info["db_connections"], 0)
        self.assertFalse(info["replay_executed"])
        self.assertEqual(info["catalog_contract"], 32)
        self.assertEqual(len(info["known_migrations_to_review"]), 7)
        self.assertEqual(len(info["baseline_sha256"]), 64)

    def test_validate_fails_closed_without_all_inputs(self):
        run = subprocess.run([sys.executable, str(SCRIPT), "--mode", "validate"],
                             cwd=ROOT, capture_output=True, text=True, check=False)
        self.assertEqual(run.returncode, 3)
        self.assertIn("ELUS_REHEARSAL_NO_GO", run.stderr)

    def test_only_private_custom_snapshot_accepted(self):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / "schema.dump"
            file.write_bytes(b"PGDMP" + bytes(2048))
            info = mod.validate_snapshot(file)
            self.assertEqual(info["bytes"], 2053)
            self.assertEqual(len(info["sha256"]), 64)
            file.write_bytes(b"invalid" * 300)
            with self.assertRaises(mod.NoGo):
                mod.validate_snapshot(file)

    def test_catalog_requires_exact_32_unique_objects(self):
        pair = sorted(mod.catalog_contract())
        self.assertEqual(len(pair), 32)
        data = [{"kind": k, "label": v, "present": i < 3}
                for i, (k, v) in enumerate(pair)]
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / "catalog.json"
            file.write_text(json.dumps(data), encoding="utf-8")
            result = mod.validate_catalog(file)
            self.assertEqual((result["present"], result["absent"]), (3, 29))
            data[0] = data[1].copy()
            file.write_text(json.dumps(data), encoding="utf-8")
            with self.assertRaises(mod.NoGo):
                mod.validate_catalog(file)

    def test_no_credentials_or_ddl_execution(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", source)
        self.assertNotIn("docker run", source)
        self.assertNotIn("pg_restore -", source)
        self.assertIn("INPUTS_VALIDATED_RESTORE_NOT_EXECUTED", source)

if __name__ == "__main__":
    unittest.main()
