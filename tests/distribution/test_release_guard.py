"""Offline negative gates for ELUS360 release, registry and rollback."""
from __future__ import annotations

import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/elus360-distribution-guard.py"
SPEC = importlib.util.spec_from_file_location("elus_distribution_guard", SCRIPT)
assert SPEC and SPEC.loader
guard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guard)

SHA = "a" * 40
OLD_SHA = "b" * 40
MANIFEST_DIGEST = "sha256:" + "1" * 64
AMD_DIGEST = "sha256:" + "2" * 64


def valid_evidence():
    release = {
        "repository": guard.REPO,
        "tag_name": "v1.102.0",
        "sha": SHA,
        "draft": False,
        "prerelease": False,
        "contained_in_main": True,
        "approved": True,
        "published_at": "2026-11-06T10:00:00Z",
    }
    images = {}
    for name in guard.NAMES:
        images[name] = {
            "repository": f"{guard.NAMESPACE}/{name}",
            "source": guard.SOURCE,
            "revision": SHA,
            "version": "1.102.0",
            "digest": MANIFEST_DIGEST,
            "platforms": {
                "linux/amd64": {"digest": AMD_DIGEST, "revision": SHA},
            },
        }
    return release, {"repository": guard.REPO, "tag": "1.102.0", "images": images}


def valid_previous():
    return {
        "repository": guard.REPO,
        "revision": OLD_SHA,
        "pins": {n: f"{guard.NAMESPACE}/{n}@{AMD_DIGEST}" for n in guard.NAMES},
    }


class DistributionGates(unittest.TestCase):
    def test_synthetic_attestation_is_not_publication(self):
        release, manifest = valid_evidence()
        proof = guard.release_attestation(release, manifest, "v1.102.0", SHA)
        self.assertEqual(proof["verified_images"], "4")
        self.assertEqual(proof["sha"], SHA)

    def test_no_go_without_own_release(self):
        release, manifest = valid_evidence()
        release["published_at"] = None
        with self.assertRaisesRegex(guard.DistributionRejected, "publication"):
            guard.release_attestation(release, manifest, "v1.102.0", SHA)

    def test_reject_upstream_release_even_with_matching_tag(self):
        release, manifest = valid_evidence()
        release["repository"] = "melgarafael/DeskcommCRM"
        with self.assertRaisesRegex(guard.DistributionRejected, "foreign release"):
            guard.release_attestation(release, manifest, "v1.102.0", SHA)

    def test_reject_wrong_commit(self):
        release, manifest = valid_evidence()
        release["sha"] = OLD_SHA
        with self.assertRaisesRegex(guard.DistributionRejected, "commit mismatch"):
            guard.release_attestation(release, manifest, "v1.102.0", SHA)

    def test_reject_nonmain_tag(self):
        release, manifest = valid_evidence()
        release["contained_in_main"] = False
        with self.assertRaisesRegex(guard.DistributionRejected, "ancestry"):
            guard.release_attestation(release, manifest, "v1.102.0", SHA)

    def test_reject_unapproved_release(self):
        release, manifest = valid_evidence()
        release["approved"] = False
        with self.assertRaisesRegex(guard.DistributionRejected, "approval"):
            guard.release_attestation(release, manifest, "v1.102.0", SHA)

    def test_reject_draft_or_prerelease(self):
        for key in ("draft", "prerelease"):
            with self.subTest(key=key):
                release, manifest = valid_evidence()
                release[key] = True
                with self.assertRaisesRegex(guard.DistributionRejected, "unpublished"):
                    guard.release_attestation(release, manifest, "v1.102.0", SHA)

    def test_reject_mutable_or_nonnumeric_tag(self):
        for bad in ("latest", "stable", "main", "v1.102.0-rc.1", "v1.102.0+1", "v01.102.0"):
            with self.subTest(tag=bad):
                release, manifest = valid_evidence()
                with self.assertRaisesRegex(guard.DistributionRejected, "immutable"):
                    guard.release_attestation(release, manifest, bad, SHA)

    def test_reject_foreign_ghcr_namespace(self):
        release, manifest = valid_evidence()
        manifest["images"]["elus360-worker"]["repository"] = "ghcr.io/melgarafael/deskcomm-worker"
        with self.assertRaisesRegex(guard.DistributionRejected, "foreign image"):
            guard.release_attestation(release, manifest, "v1.102.0", SHA)

    def test_reject_missing_private_or_unreadable_image(self):
        release, manifest = valid_evidence()
        del manifest["images"]["elus360-scheduler"]
        with self.assertRaisesRegex(guard.DistributionRejected, "four-image"):
            guard.release_attestation(release, manifest, "v1.102.0", SHA)

    def test_reject_missing_or_malformed_digest(self):
        for bad in ("", "sha256:abc", None, "unknown"):
            with self.subTest(digest=bad):
                release, manifest = valid_evidence()
                manifest["images"]["elus360"]["digest"] = bad
                with self.assertRaisesRegex(guard.DistributionRejected, "digest"):
                    guard.release_attestation(release, manifest, "v1.102.0", SHA)

    def test_reject_missing_amd64_and_rogue_platform(self):
        release, manifest = valid_evidence()
        del manifest["images"]["elus360-voice-agent"]["platforms"]["linux/amd64"]
        with self.assertRaisesRegex(guard.DistributionRejected, "platform set"):
            guard.release_attestation(release, manifest, "v1.102.0", SHA)
        release, manifest = valid_evidence()
        manifest["images"]["elus360-voice-agent"]["platforms"]["linux/arm64"] = {
            "digest": "sha256:" + "3" * 64, "revision": SHA
        }
        with self.assertRaisesRegex(guard.DistributionRejected, "platform set"):
            guard.release_attestation(release, manifest, "v1.102.0", SHA)

    def test_reject_arm_only_manifest_even_when_integrity_valid(self):
        release, manifest = valid_evidence()
        manifest["images"]["elus360"]["platforms"] = {
            "linux/arm64": {"digest": AMD_DIGEST, "revision": SHA}
        }
        with self.assertRaisesRegex(guard.DistributionRejected, "platform set"):
            guard.release_attestation(release, manifest, "v1.102.0", SHA)

    def test_reject_platform_revision_drift(self):
        release, manifest = valid_evidence()
        manifest["images"]["elus360-worker"]["platforms"]["linux/amd64"]["revision"] = OLD_SHA
        with self.assertRaisesRegex(guard.DistributionRejected, "revision"):
            guard.release_attestation(release, manifest, "v1.102.0", SHA)

    def test_reject_image_version_drift(self):
        release, manifest = valid_evidence()
        manifest["images"]["elus360-scheduler"]["version"] = "1.94.0"
        with self.assertRaisesRegex(guard.DistributionRejected, "version mismatch"):
            guard.release_attestation(release, manifest, "v1.102.0", SHA)

    def test_reject_nonmatching_oci_source(self):
        release, manifest = valid_evidence()
        manifest["images"]["elus360"]["source"] = "https://github.com/melgarafael/DeskcommCRM"
        with self.assertRaisesRegex(guard.DistributionRejected, "OCI source"):
            guard.release_attestation(release, manifest, "v1.102.0", SHA)

    def test_rollback_is_only_a_plan(self):
        release, manifest = valid_evidence()
        proof = guard.release_attestation(release, manifest, "v1.102.0", SHA)
        before = valid_previous()
        snapshot = copy.deepcopy(before)
        plan = guard.rollback_plan(before, proof, "forward_compatible")
        self.assertEqual(before, snapshot)
        self.assertFalse(plan["auto_apply"])
        self.assertFalse(plan["database_rollback_performed"])
        self.assertTrue(plan["requires_separate_human_approval"])
        self.assertEqual(set(plan["restore_pins"]), set(guard.NAMES))

    def test_rollback_rejects_missing_previous_service(self):
        before = valid_previous()
        del before["pins"]["elus360-voice-agent"]
        with self.assertRaisesRegex(guard.DistributionRejected, "four services"):
            guard.rollback_plan(before, {"repository": guard.REPO, "sha": SHA, "verified_images": "4"},
                                "forward_compatible")

    def test_rollback_does_not_silently_return_to_upstream(self):
        before = valid_previous()
        before["pins"]["elus360"] = "ghcr.io/melgarafael/deskcommcrm@" + AMD_DIGEST
        with self.assertRaisesRegex(guard.DistributionRejected, "ELUS digest"):
            guard.rollback_plan(before, {"repository": guard.REPO, "sha": SHA, "verified_images": "4"},
                                "forward_compatible")

    def test_rollback_requires_database_strategy(self):
        with self.assertRaisesRegex(guard.DistributionRejected, "schema rollback"):
            guard.rollback_plan(valid_previous(),
                                {"repository": guard.REPO, "sha": SHA, "verified_images": "4"}, "")

    def test_cli_fails_closed_on_missing_artifacts(self):
        with tempfile.TemporaryDirectory() as tmp:
            proc = subprocess.run(
                [sys.executable, str(SCRIPT), "--release", str(Path(tmp) / "404.json"),
                 "--manifest", str(Path(tmp) / "private.json"),
                 "--tag", "v1.102.0", "--sha", SHA],
                text=True, capture_output=True, check=False,
            )
            self.assertEqual(proc.returncode, 3)
            self.assertIn("ELUS_DISTRIBUTION_NO_GO", proc.stderr)
            self.assertEqual(proc.stdout, "")

    def test_cli_success_has_no_side_effects(self):
        with tempfile.TemporaryDirectory() as tmp:
            release, manifest = valid_evidence()
            r = Path(tmp) / "release.json"
            m = Path(tmp) / "images.json"
            r.write_text(json.dumps(release))
            m.write_text(json.dumps(manifest))
            before = sorted(p.name for p in Path(tmp).iterdir())
            proc = subprocess.run([sys.executable, str(SCRIPT), "--release", str(r),
                                   "--manifest", str(m), "--tag", "v1.102.0", "--sha", SHA],
                                  text=True, capture_output=True, check=False)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertEqual(json.loads(proc.stdout)["status"], "verified_offline_only")
            self.assertEqual(before, sorted(p.name for p in Path(tmp).iterdir()))

if __name__ == "__main__":
    unittest.main()
