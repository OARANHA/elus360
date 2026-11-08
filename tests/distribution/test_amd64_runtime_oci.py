"""Offline, runtime regression tests for owner-approved AMD64-only distribution.

Uses the actual Bash OCI/installer helpers, disposable files and a fake Docker
binary. Does not access GHCR, GitHub, production files, Docker or a database.
"""
from __future__ import annotations

import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
MANIFESTOS = ROOT / "hostgator-setup-kit" / "_manifestos.sh"
COMMON = ROOT / "hostgator-setup-kit" / "_common.sh"
IMG_NS = next(line.split('"')[1] for line in COMMON.read_text().splitlines() if line.startswith('IMG_NS="'))

DOCKER_FAKE = r'''#!/usr/bin/env bash
printf '%s\n' "$*" >> "$ELUS_OCI_CALLS"
case " $* " in
  *" --raw "*)
    if [ "$ELUS_OCI_SIMPLE" = "1" ]; then
      printf '{"schemaVersion":2,"config":{"digest":"sha256:fake"}}\n'
    else
      printf '{"schemaVersion":2,"manifests":[{"mediaType":"application/vnd.oci.image.manifest.v1+json"}]}\n'
    fi
    ;;
  *" --format "*)
    case " $* " in
      *"ghcr.io/vendor/waha"*) printf '%s\n' "$ELUS_WAHA_PLATFORMS" ;;
      *) printf '%s\n' "$ELUS_OWN_PLATFORMS" ;;
    esac
    ;;
  *) exit 43 ;;
esac
'''


class AMD64RuntimeOCI(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        docker = self.bin / "docker"
        docker.write_text(DOCKER_FAKE)
        docker.chmod(0o755)
        self.calls = self.root / "oci-calls.log"
        self.calls.write_text("")

    def bash(self, body: str, **overrides) -> subprocess.CompletedProcess[str]:
        env = {
            **os.environ,
            "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
            "ELUS_OCI_CALLS": str(self.calls),
            "ELUS_MANIFESTOS": str(MANIFESTOS),
            "ELUS_COMMON": str(COMMON),
            "ELUS_OCI_SIMPLE": "0",
            "ELUS_OWN_PLATFORMS": "linux/amd64",
            "ELUS_WAHA_PLATFORMS": "linux/amd64\nlinux/arm64",
            **{k: str(v) for k, v in overrides.items()},
        }
        return subprocess.run(
            ["bash", "-c", "set -euo pipefail\n" + body],
            cwd=self.root, env=env, text=True, capture_output=True,
            check=False, timeout=10,
        )

    def preflight(self, **overrides):
        return self.bash(
            'source "$ELUS_MANIFESTOS"\n'
            'source "$ELUS_COMMON"\n'
            'ghcr_status() { printf 200; }\n'
            'preflight_imagens_crm 1.102.0 linux/amd64\n',
            **overrides,
        )

    def test_own_four_amd64_only_manifest_passes(self):
        result = self.preflight()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(self.calls.read_text().splitlines()), 8)

    def test_own_multiarch_manifest_is_rejected(self):
        result = self.preflight(ELUS_OWN_PLATFORMS="linux/amd64\nlinux/arm64")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ELUS_DISTRIBUTION_NO_GO", result.stderr)
        self.assertEqual(len(self.calls.read_text().splitlines()), 2)

    def test_own_arm_only_manifest_is_rejected(self):
        result = self.preflight(ELUS_OWN_PLATFORMS="linux/arm64")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ELUS_DISTRIBUTION_NO_GO", result.stderr)

    def test_duplicate_amd64_manifest_is_not_exclusive(self):
        result = self.preflight(ELUS_OWN_PLATFORMS="linux/amd64\nlinux/amd64")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ELUS_DISTRIBUTION_NO_GO", result.stderr)

    def test_single_manifest_for_amd64_is_accepted(self):
        result = self.preflight(ELUS_OCI_SIMPLE="1")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_upstream_waha_multiarch_remains_compatible(self):
        result = self.bash(
            'source "$ELUS_MANIFESTOS"\n'
            'manifesto_tem_plataforma ghcr.io/vendor/waha:fixed linux/amd64\n',
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_upstream_waha_missing_amd64_is_rejected(self):
        result = self.bash(
            'source "$ELUS_MANIFESTOS"\n'
            'manifesto_tem_plataforma ghcr.io/vendor/waha:fixed linux/amd64\n',
            ELUS_WAHA_PLATFORMS="linux/arm64",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("não oferece linux/amd64", result.stderr)

    def test_platform_helper_rejects_non_linux_x86(self):
        reject = self.bash(
            'source "$ELUS_MANIFESTOS"\n'
            'plataforma_oci_do_host x86_64 Darwin\n'
        )
        self.assertNotEqual(reject.returncode, 0)
        self.assertIn("ELUS_DISTRIBUTION_NO_GO", reject.stderr)
        self.assertEqual(self.calls.read_text(), "")

        accept = self.bash(
            'source "$ELUS_MANIFESTOS"\n'
            'plataforma_oci_do_host x86_64 Linux\n'
        )
        self.assertEqual(accept.returncode, 0, accept.stderr)
        self.assertEqual(accept.stdout.strip(), "linux/amd64")

    def test_gravar_imagens_preserves_custom_waha_secret_vapid_and_four_pins(self):
        envfile = self.root / ".env"
        envfile.write_text(
            "WAHA_IMAGE=vendor/waha-plus:fixed\n"
            "INTERNAL_SECRET=disposable-only\n"
            "VAPID_PUBLIC_KEY=previous-public\n"
            "VAPID_PRIVATE_KEY=previous-private\n"
        )
        envfile.chmod(0o600)
        result = self.bash(
            'source "$ELUS_COMMON"\n'
            'gravar_imagens .env 1.102.0\n'
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("command not found", result.stderr)
        parsed = dict(line.split("=", 1) for line in envfile.read_text().splitlines())
        self.assertEqual(parsed["WAHA_IMAGE"], "vendor/waha-plus:fixed")
        self.assertEqual(parsed["INTERNAL_SECRET"], "disposable-only")
        self.assertEqual(parsed["VAPID_PUBLIC_KEY"], "previous-public")
        self.assertEqual(parsed["VAPID_PRIVATE_KEY"], "previous-private")
        for key, image in (
            ("APP", "elus360"),
            ("WORKER", "elus360-worker"),
            ("SCHEDULER", "elus360-scheduler"),
            ("VOICE_AGENT", "elus360-voice-agent"),
        ):
            self.assertEqual(parsed[f"{key}_IMAGE"],
                             f"{IMG_NS}/{image}:1.102.0")
            self.assertEqual(parsed[f"{key}_PULL_POLICY"], "missing")
        self.assertEqual(stat.S_IMODE(envfile.stat().st_mode), 0o600)


if __name__ == "__main__":
    unittest.main()
