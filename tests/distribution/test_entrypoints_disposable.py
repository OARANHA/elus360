"""Functional no-side-effects gates on the REAL installer/updater with fake tools.

All subprocesses run in TemporaryDirectory; never use Docker, GitHub or DB.
The fakes record their calls, making a mutation BEFORE release attestation visible.
"""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
INSTALL = ROOT / "hostgator-setup-kit" / "install.sh"
UPDATE = ROOT / "hostgator-setup-kit" / "update.sh"

GIT_FAKE = r'''#!/usr/bin/env bash
printf 'git:%s\n' "$*" >> "$ELUS_CALLS"
case "$1" in
  config) printf '%s\n' "$ELUS_ORIGIN" ;;
  ls-remote) printf '%s\trefs/tags/v1.102.0\n' "$ELUS_REMOTE_SHA" ;;
  fetch) exit 47 ;;
  *) exit 8 ;;
esac
'''
CURL_FAKE = r'''#!/usr/bin/env bash
printf 'curl:%s\n' "$*" >> "$ELUS_CALLS"
[ "$ELUS_MODE" != "404" ] || exit 22
case "$*" in
  *"/releases/latest"*)
    [ "$ELUS_MODE" != "no_latest" ] || exit 22
    printf '{\n "tag_name": "v1.102.0"\n}\n'
    ;;
  *"/releases/tags/"*)
    printf '{\n "tag_name": "v1.102.0",\n "draft": %s,\n "prerelease": %s,\n "published_at": "2026-11-06T23:00:00Z"\n}\n' "$ELUS_DRAFT" "$ELUS_PRERELEASE"
    ;;
  *"/compare/main..."*)
    printf '{\n "status": "%s"\n}\n' "$ELUS_COMPARE"
    ;;
  *) exit 13 ;;
esac
'''
BLOCK_FAKE = r'''#!/usr/bin/env bash
printf '%s:%s\n' "$(basename "$0")" "$*" >> "$ELUS_CALLS"
exit 42
'''


class DisposableEntrypoints(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = self.root / "project"
        self.project.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        (self.project / "docker-compose.prod.yml").write_text("services:\n  app:\n    image: none\n")
        self.env_path = self.project / ".env"
        self.env_initial = (
            "SINGLE_SERVER=1\n"
            "APP_IMAGE=ghcr.io/oaranha/elus360:1.101.0\n"
            "SUPABASE_DB_URL=postgresql://none/no-database\n"
            "INTERNAL_SECRET=test-only\n"
        )
        self.env_path.write_text(self.env_initial)
        self.calls = self.root / "calls.log"
        self.calls.write_text("")
        for name, source in (
            ("git", GIT_FAKE), ("curl", CURL_FAKE),
            ("docker", BLOCK_FAKE), ("crontab", BLOCK_FAKE),
        ):
            path = self.bin / name
            path.write_text(source)
            path.chmod(0o755)
        self.base_env = {
            **os.environ,
            "PATH": f"{self.bin}{os.pathsep}{os.environ['PATH']}",
            "ELUS_CALLS": str(self.calls),
            "ELUS_ORIGIN": "https://github.com/OARANHA/elus360.git",
            "ELUS_REMOTE_SHA": "a" * 40,
            "ELUS_MODE": "valid",
            "ELUS_DRAFT": "false",
            "ELUS_PRERELEASE": "false",
            "ELUS_COMPARE": "behind",
            # Avoid invoking any real single-server configuration:
            "SINGLE_SERVER": "1",
            "GIT_TERMINAL_PROMPT": "0",
        }

    def run_script(self, script: Path, *args: str, **overrides):
        env = {**self.base_env, **{k: str(v) for k, v in overrides.items()}}
        return subprocess.run(
            ["bash", str(script), *args], cwd=self.project, env=env,
            text=True, capture_output=True, timeout=25, check=False,
        )

    def assert_no_mutation_before_proof(self, result):
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ELUS_DISTRIBUTION_NO_GO", result.stdout + result.stderr)
        self.assertEqual(self.env_path.read_text(), self.env_initial)
        self.assertFalse((self.project / ".deskcomm-update-diagnostico.log").exists())
        self.assertFalse((self.project / ".deskcomm-banco.log").exists())
        self.assertFalse((self.project / ".update-vigia").exists())
        self.assertFalse((self.project / ".deskcomm-update-versao-anterior").exists())
        calls = self.calls.read_text().splitlines()
        for call in calls:
            self.assertFalse(call.startswith(("docker:", "crontab:", "git:fetch", "git:clone")),
                             f"side effect before attestation: {call}")

    def test_updater_404_before_cron_gotrue_and_env(self):
        result = self.run_script(UPDATE, "--to", "v1.102.0", ELUS_MODE="404")
        self.assert_no_mutation_before_proof(result)
        self.assertIn("curl:", self.calls.read_text())

    def test_updater_draft_release_has_no_side_effect(self):
        result = self.run_script(UPDATE, "--to", "v1.102.0", ELUS_DRAFT="true")
        self.assert_no_mutation_before_proof(result)

    def test_updater_prerelease_has_no_side_effect(self):
        result = self.run_script(UPDATE, "--to", "v1.102.0", ELUS_PRERELEASE="true")
        self.assert_no_mutation_before_proof(result)

    def test_updater_unmerged_tag_has_no_side_effect(self):
        result = self.run_script(UPDATE, "--to", "v1.102.0", ELUS_COMPARE="ahead")
        self.assert_no_mutation_before_proof(result)

    def test_updater_foreign_origin_does_not_call_api(self):
        result = self.run_script(UPDATE, "--to", "v1.102.0",
                                 ELUS_ORIGIN="https://github.com/melgarafael/DeskcommCRM.git")
        self.assert_no_mutation_before_proof(result)
        self.assertNotIn("curl:", self.calls.read_text())

    def test_updater_invalid_tag_has_no_side_effect(self):
        result = self.run_script(UPDATE, "--to", "stable")
        self.assert_no_mutation_before_proof(result)

    def test_updater_latest_404_fails_without_mutation(self):
        result = self.run_script(UPDATE, ELUS_MODE="no_latest")
        self.assert_no_mutation_before_proof(result)

    def test_updater_missing_to_value_fails_before_git_fetch(self):
        result = self.run_script(UPDATE, "--to")
        self.assert_no_mutation_before_proof(result)

    def test_updater_bypassed_endpoint_is_rejected_without_http(self):
        result = self.run_script(UPDATE, "--to", "v1.102.0",
                                 DESKCOMM_RELEASES_LATEST_URL="https://example.invalid/fake")
        self.assert_no_mutation_before_proof(result)
        self.assertNotIn("curl:", self.calls.read_text())

    def test_installer_without_release_does_not_clone_or_mutate(self):
        result = self.run_script(INSTALL, "--yes", ELUS_MODE="404")
        self.assert_no_mutation_before_proof(result)

    def test_installer_unmerged_release_does_not_clone_or_mutate(self):
        result = self.run_script(INSTALL, "--yes", ELUS_COMPARE="diverged")
        self.assert_no_mutation_before_proof(result)

    def test_installer_foreign_repository_does_not_call_http(self):
        result = self.run_script(INSTALL, "--yes",
                                 REPO_URL="https://github.com/melgarafael/DeskcommCRM.git")
        self.assert_no_mutation_before_proof(result)
        self.assertNotIn("curl:", self.calls.read_text())

    def test_installer_release_override_has_no_side_effect(self):
        result = self.run_script(INSTALL, "--yes",
                                 DESKCOMM_RELEASES_LATEST_URL="https://example.invalid/fake")
        self.assert_no_mutation_before_proof(result)

    def test_installer_tag_object_missing_has_no_side_effect(self):
        result = self.run_script(INSTALL, "--yes", ELUS_REMOTE_SHA="")
        self.assert_no_mutation_before_proof(result)


if __name__ == "__main__":
    unittest.main()
