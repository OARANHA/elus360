"""Disposable tests of real _common.sh snapshot and rollback helpers."""
import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COMMON = ROOT / "hostgator-setup-kit" / "_common.sh"
AGENT = ROOT / "hostgator-setup-kit" / "agent.sh"
IMG_NS = next(line.split('"')[1] for line in COMMON.read_text().splitlines() if line.startswith('IMG_NS="'))
NAMES = {"APP": "elus360", "WORKER": "elus360-worker",
         "SCHEDULER": "elus360-scheduler", "VOICE_AGENT": "elus360-voice-agent"}

def pins(version, voice=True):
    out = {}
    for key, package in NAMES.items():
        if key == "VOICE_AGENT" and not voice:
            continue
        out[f"{key}_IMAGE"] = f"{IMG_NS}/{package}:{version}"
        out[f"{key}_PULL_POLICY"] = "missing"
    return out

def read_env(path):
    return dict(line.split("=", 1) for line in path.read_text().splitlines() if "=" in line)

class RollbackInTempdir(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.env_file = self.folder / ".env"
        self.old = {**pins("1.101.0"), "INTERNAL_SECRET": "test-no-real-secret"}
        self.write_env(self.old)

    def write_env(self, data):
        self.env_file.write_text("".join(f"{k}={v}\n" for k, v in data.items()))
        self.env_file.chmod(0o600)

    def shell(self, cmds):
        return subprocess.run(
            ["bash", "-c", 'source "$ELUS_COMMON"\n' + cmds],
            cwd=self.folder, env={**os.environ, "ELUS_COMMON": str(COMMON)},
            text=True, capture_output=True, check=False, timeout=15)

    def test_four_image_pins_restore_without_secret_loss(self):
        cmds = "armar_rollback_de_versao .env\n"
        for key, val in pins("1.102.0").items():
            cmds += f'set_env_var .env {key} "{val}"\n'
        cmds += "restaurar_versao_anterior\n"
        completed = self.shell(cmds)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(read_env(self.env_file), self.old)
        self.assertEqual(stat.S_IMODE(self.env_file.stat().st_mode), 0o600)
        self.assertIn("VOICE_AGENT_IMAGE", read_env(self.env_file))

    def test_missing_optional_voice_is_not_invented_during_restore(self):
        old = pins("1.101.0", voice=False)
        self.write_env(old)
        cmd = ('armar_rollback_de_versao .env\n'
               f'set_env_var .env VOICE_AGENT_IMAGE "{IMG_NS}/elus360-voice-agent:1.102.0"\n'
               'set_env_var .env VOICE_AGENT_PULL_POLICY missing\n'
               'restaurar_versao_anterior\n')
        result = self.shell(cmd)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(read_env(self.env_file), old)

    def test_disarm_preserves_new_version(self):
        cmd = ('armar_rollback_de_versao .env\n'
               f'set_env_var .env APP_IMAGE "{IMG_NS}/elus360:1.102.0"\n'
               'desarmar_rollback_de_versao\n'
               'restaurar_versao_anterior\n')
        result = self.shell(cmd)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(read_env(self.env_file)["APP_IMAGE"], f"{IMG_NS}/elus360:1.102.0")

    def test_snapshot_excludes_credentials(self):
        result = self.shell("armar_rollback_de_versao .env\n")
        self.assertEqual(result.returncode, 0, result.stderr)
        snap = self.folder / ".deskcomm-env-antes-do-update"
        self.assertTrue(snap.exists())
        self.assertNotIn("INTERNAL_SECRET", snap.read_text())
        self.assertEqual(len(snap.read_text().splitlines()), 8)

    def test_agent_rolls_back_optional_voice_without_local_build(self):
        src = AGENT.read_text()
        self.assertIn('PREV_VOICE_AGENT_IMAGE="$(dc images -q voice-agent', src)
        self.assertIn('ROLLBACK_ARGS+=(voice-agent)', src)
        self.assertIn('dc up -d --no-build', src)
        self.assertIn("Rollback parcial de imagens", src)
        self.assertIn("schema/banco NÃO revertido", src)

    def test_trap_restores_four_services_without_build(self):
        src = COMMON.read_text()
        self.assertIn("dc up -d --no-build app worker scheduler voice-agent", src)
        self.assertIn('CHAVES_DE_VERSAO="APP_IMAGE APP_PULL_POLICY', src)

if __name__ == "__main__":
    unittest.main()
