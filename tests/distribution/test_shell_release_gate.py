"""Bash release gate with synthetic GitHub API; no network or mutable systems."""
from __future__ import annotations
import os
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COMMON = ROOT / "hostgator-setup-kit" / "_common.sh"
UPDATER = ROOT / "hostgator-setup-kit" / "update.sh"
INSTALLER = ROOT / "hostgator-setup-kit" / "install.sh"
TAG = "a" * 40

SHELL = r'''
source "$ELUS_COMMON"
git() {
  case "$1" in
    config) printf '%s\n' "${ELUS_TEST_ORIGIN}" ;;
    rev-parse) printf '%s\n' "${ELUS_TEST_LOCAL}" ;;
    ls-remote) printf '%s\trefs/tags/v1.102.0\n' "${ELUS_TEST_REMOTE}" ;;
    *) return 4 ;;
  esac
}
curl() {
  if [ "${ELUS_TEST_HTTP_FAIL:-0}" = "1" ]; then return 22; fi
  case "$*" in
    *"/releases/tags/"*)
      printf '{\n "tag_name": "v1.102.0",\n "draft": %s,\n "prerelease": %s,\n "published_at": "2026-11-06T13:30:00Z"\n}\n' "$ELUS_TEST_DRAFT" "$ELUS_TEST_PRE" ;;
    *"/compare/main..."*)
      printf '{\n "status": "%s"\n}\n' "$ELUS_TEST_STATUS" ;;
    *) return 23 ;;
  esac
}
elus360_release_tag_comprovada "$ELUS_TEST_TAG"
'''


def call_gate(**changes):
    env = {
        **os.environ,
        "ELUS_COMMON": str(COMMON),
        "ELUS_TEST_ORIGIN": "https://github.com/OARANHA/elus360.git",
        "ELUS_TEST_LOCAL": TAG,
        "ELUS_TEST_REMOTE": TAG,
        "ELUS_TEST_DRAFT": "false",
        "ELUS_TEST_PRE": "false",
        "ELUS_TEST_STATUS": "behind",
        "ELUS_TEST_TAG": "v1.102.0",
    }
    env.update({k: str(v) for k, v in changes.items()})
    return subprocess.run(["bash", "-c", SHELL], env=env, cwd=ROOT,
                          text=True, capture_output=True, check=False)


class ReleaseGateShell(unittest.TestCase):
    def test_valid_synthetic_tag(self):
        self.assertEqual(call_gate().returncode, 0)

    def test_identical_with_main_also_valid(self):
        self.assertEqual(call_gate(ELUS_TEST_STATUS="identical").returncode, 0)

    def test_other_repository_rejected(self):
        self.assertEqual(call_gate(ELUS_TEST_ORIGIN="https://github.com/melgarafael/DeskcommCRM.git").returncode, 1)

    def test_tag_object_mismatch_rejected(self):
        self.assertEqual(call_gate(ELUS_TEST_REMOTE="b" * 40).returncode, 1)

    def test_draft_rejected(self):
        self.assertEqual(call_gate(ELUS_TEST_DRAFT="true").returncode, 1)

    def test_prerelease_rejected(self):
        self.assertEqual(call_gate(ELUS_TEST_PRE="true").returncode, 1)

    def test_not_in_main_rejected(self):
        for status in ("ahead", "diverged", ""):
            with self.subTest(status=status):
                self.assertEqual(call_gate(ELUS_TEST_STATUS=status).returncode, 1)

    def test_github_release_404_rejected(self):
        self.assertEqual(call_gate(ELUS_TEST_HTTP_FAIL="1").returncode, 1)

    def test_no_mutable_or_prerelease_tag(self):
        for tag in ("latest", "stable", "main", "v1.102.0-beta"):
            with self.subTest(tag=tag):
                self.assertEqual(call_gate(ELUS_TEST_TAG=tag).returncode, 1)

    def test_missing_origin_rejected(self):
        self.assertEqual(call_gate(ELUS_TEST_ORIGIN="").returncode, 1)

    def test_updater_gates_before_mutation(self):
        source = UPDATER.read_text()
        origin = source.index('elus360_origem_confiavel "$(git config')
        cron = source.index("setup_update_agent_cron", origin)
        target = source.index('elus360_release_tag_comprovada "$TARGET_TAG"')
        backup = source.index('step "Backup de segurança', target)
        self.assertLess(origin, cron)
        self.assertLess(target, backup)

    def test_installer_has_no_fallback(self):
        source = INSTALLER.read_text()
        self.assertIn('VERSAO_ALVO="$(ultima_release_estavel)"', source)
        self.assertIn('|| ! trio_publicado "$VERSAO_ALVO"', source)
        self.assertNotIn('VERSAO_ALVO="latest"', source)
        self.assertIn("ELUS_DISTRIBUTION_NO_GO", source)

if __name__ == "__main__":
    unittest.main()
